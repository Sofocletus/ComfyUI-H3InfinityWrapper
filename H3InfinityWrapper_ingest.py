"""H3 Infinity Wrapper: External Video Conform & AV Latent Ingest Node.

Conforms any external video file to MiniMax H3's native v1.4 requirements:
- Framerate: 24 fps (timestamp-synced to audio)
- Resolution: Exact width x height (multiples of 32) via center-crop (never black bars)
- Length: Capped at 30.0s, trimmed (never padded) to H3's 51k+39 or 17k+5 grid
- Audio: Resampled to Audio VAE's native rate, stereo, exact frame-matched length (or silence if missing)
- Output: H3 AV NestedTensor LATENT + v1.4 H3_CONTINUOUS_HANDOVER metadata
- Disk Export: [filename].mp4, [filename].safetensors, and [filename]_data.json
"""

import os
import json
import logging
import numpy as np
import torch
import av
from safetensors.torch import save_file as st_save

import comfy.nested_tensor
import comfy.utils
import folder_paths

_LOG = logging.getLogger("h3_infinity_wrapper")

H3_FPS = 24.0
MAX_H3_DURATION_SECONDS = 30.0


def _snap_down_frame_count(available_frames: int, grid_snap: str) -> tuple[int, str]:
    """Trim available_frames downward to a legal H3 frame count (never pads)."""
    n = int(available_frames)
    if n < 5:
        raise ValueError(
            f"H3 Ingest: video has only {n} frames at 24 fps (minimum 5 frames required)."
        )

    if grid_snap == "Exact AV (51k+39)":
        if n >= 39:
            snapped = 39 + ((n - 39) // 51) * 51
            return snapped, "exact_av_51k_plus_39"
        # Automatic fallback for short clips (< 39 frames / < 1.625s)
        snapped = 5 + ((n - 5) // 17) * 17
        return snapped, "short_clip_fallback_17k_plus_5"

    # Video Grid (17k+5)
    snapped = 5 + ((n - 5) // 17) * 17
    return snapped, "video_grid_17k_plus_5"


def _decode_video_24fps(
    video_path: str,
    start_seconds: float,
    max_duration: float,
) -> list[np.ndarray]:
    """Decode video frames conformed to 24 fps using timestamp sampling."""
    start_sec = max(0.0, float(start_seconds))
    max_dur = min(MAX_H3_DURATION_SECONDS, max(0.25, float(max_duration)))
    end_sec = start_sec + max_dur
    max_frames = int(round(max_dur * H3_FPS))

    frames: list[np.ndarray] = []
    with av.open(video_path) as container:
        if not container.streams.video:
            raise ValueError(f"H3 Ingest: no video stream found in {video_path}")
        vstream = container.streams.video[0]
        vstream.thread_type = "AUTO"
        time_base = float(vstream.time_base)

        if start_sec > 0.0:
            seek_ts = int(start_sec / time_base)
            container.seek(seek_ts, stream=vstream, backward=True, any_frame=False)

        next_target_t = start_sec
        last_rgb = None
        frame_step = 1.0 / H3_FPS

        for packet in container.demux(vstream):
            for frame in packet.decode():
                pts = frame.pts
                t = float(pts * time_base) if pts is not None else (
                    len(frames) * frame_step + start_sec
                )
                if t < start_sec - frame_step:
                    continue

                rgb = frame.to_ndarray(format="rgb24")

                # Fill any 24fps slots up to the current frame's timestamp
                while next_target_t <= t + (frame_step * 0.5) and len(frames) < max_frames:
                    if next_target_t > end_sec + 1e-6:
                        break
                    use_current = (
                        last_rgb is None
                        or abs(t - next_target_t) <= abs((t - frame_step) - next_target_t)
                    )
                    frames.append(rgb if use_current else last_rgb)
                    next_target_t += frame_step

                last_rgb = rgb
                if len(frames) >= max_frames or t >= end_sec:
                    break
            if len(frames) >= max_frames or next_target_t >= end_sec:
                break

    if not frames:
        raise ValueError(
            f"H3 Ingest: decoded 0 frames from {video_path} (start_seconds={start_sec})"
        )
    return frames


def _decode_audio_conformed(
    video_path: str,
    start_seconds: float,
    target_samples: int,
    sample_rate: int,
) -> tuple[torch.Tensor, bool]:
    """Decode and resample audio to stereo float32 [1, 2, target_samples].
    Returns (waveform, has_source_audio).
    """
    start_sec = max(0.0, float(start_seconds))
    duration_sec = target_samples / float(sample_rate)
    end_sec = start_sec + duration_sec

    chunks: list[np.ndarray] = []
    has_audio = False

    with av.open(video_path) as container:
        if container.streams.audio:
            has_audio = True
            astream = container.streams.audio[0]
            time_base = float(astream.time_base)
            resampler = av.AudioResampler(
                format="fltp", layout="stereo", rate=int(sample_rate)
            )

            if start_sec > 0.0:
                seek_ts = int(start_sec / time_base)
                container.seek(seek_ts, stream=astream, backward=True, any_frame=False)

            collected = 0
            for packet in container.demux(astream):
                for frame in packet.decode():
                    pts = frame.pts
                    t = float(pts * time_base) if pts is not None else start_sec
                    frame_dur = frame.samples / float(frame.sample_rate or sample_rate)
                    if t + frame_dur < start_sec:
                        continue

                    resampled_frames = resampler.resample(frame)
                    if not isinstance(resampled_frames, list):
                        resampled_frames = [resampled_frames]

                    for rf in resampled_frames:
                        if rf is None:
                            continue
                        arr = rf.to_ndarray()  # [2, samples] for fltp stereo
                        if arr.ndim == 1:
                            arr = np.stack([arr, arr], axis=0)

                        # Trim leading samples if packet started before start_sec
                        if t < start_sec and collected == 0:
                            skip = int(round((start_sec - t) * sample_rate))
                            if skip >= arr.shape[-1]:
                                continue
                            arr = arr[:, skip:]

                        chunks.append(arr)
                        collected += arr.shape[-1]

                    if collected >= target_samples or t >= end_sec + 0.5:
                        break
                if collected >= target_samples:
                    break

    if chunks:
        audio_np = np.concatenate(chunks, axis=-1).astype(np.float32)
    else:
        audio_np = np.zeros((2, target_samples), dtype=np.float32)

    # Fit exact sample count (trim or zero-pad tail)
    cur = audio_np.shape[-1]
    if cur > target_samples:
        audio_np = audio_np[:, :target_samples]
    elif cur < target_samples:
        pad = np.zeros((2, target_samples - cur), dtype=np.float32)
        audio_np = np.concatenate([audio_np, pad], axis=-1)

    waveform = torch.from_numpy(np.ascontiguousarray(audio_np)).unsqueeze(0)  # [1, 2, samples]
    return waveform, has_audio


def _encode_audio_latent(audio_vae, waveform: torch.Tensor, sample_rate: int) -> torch.Tensor:
    """Encode stereo waveform [1, 2, samples] with ComfyUI's MiniMax H3 Audio VAE."""
    try:
        latent = audio_vae.encode(waveform.movedim(1, -1))
    except TypeError:
        latent = audio_vae.encode({"waveform": waveform, "sample_rate": sample_rate})

    if isinstance(latent, dict) and "samples" in latent:
        latent = latent["samples"]
    if latent.ndim == 3:
        latent = latent.unsqueeze(0)
    return latent


def _build_ingest_handover(frame_count: int) -> dict:
    """Build a clean v1.4 H3_CONTINUOUS_HANDOVER dict with zero freeze tail."""
    end_frame = int(frame_count) - 1
    return {
        "available": True,
        "frame_count": int(frame_count),
        "freeze_detected": False,
        "freeze_start_frame": -1,
        "ideal_handover_end_frame": end_frame,
        "handover_end_frame": end_frame,
        "landing_tail_frames": 0,
        "legacy_landing_tail_frames": 0,
        "confidence": 1.0,
        "safety_mode": "fixed",
        "no_lock_fallback_applied": False,
        "no_lock_fallback_reason": "external_video_ingest_clean_end",
        "masked_av_source_policy": "safe_handover_window",
        "masked_av_detector_desired_end_frame": end_frame,
        "masked_av_cutoff_loss_frames": 0,
        "masked_av_stitch_policy": "external_video_ingest",
        "masked_av_render_safety_applied": False,
        "masked_av_render_safety_frames": 0,
        "phase_aligned_cutoff_loss_frames": 0,
        "phase_aligned_context_extension_frames": 0,
        "release_version": "1.4.0",
        "version": 12,
    }


def _save_conformed_mp4(
    out_path: str,
    images: torch.Tensor,
    waveform: torch.Tensor,
    sample_rate: int,
    fps: int = 24,
) -> None:
    """Save conformed RGB images + stereo audio to an H.264/AAC MP4."""
    container = av.open(out_path, mode="w")
    try:
        vstream = container.add_stream("h264", rate=int(fps))
        vstream.width = int(images.shape[2])
        vstream.height = int(images.shape[1])
        vstream.pix_fmt = "yuv420p"

        astream = None
        audio_np = None
        if waveform is not None and waveform.shape[-1] > 0:
            w = waveform[0] if waveform.ndim == 3 else waveform
            if w.ndim == 1:
                w = w.unsqueeze(0)
            if w.shape[0] > 2:
                w = w[:2]
            layout = "mono" if w.shape[0] == 1 else "stereo"
            audio_np = np.ascontiguousarray(
                w.detach().cpu().float().clamp(-1.0, 1.0).numpy()
            )
            astream = container.add_stream("aac", rate=int(sample_rate))
            astream.layout = layout

        frames_u8 = (images.detach().cpu().numpy() * 255.0).clip(0, 255).astype(np.uint8)
        for i in range(frames_u8.shape[0]):
            vframe = av.VideoFrame.from_ndarray(frames_u8[i], format="rgb24")
            for packet in vstream.encode(vframe):
                container.mux(packet)
        for packet in vstream.encode():
            container.mux(packet)

        if astream is not None and audio_np is not None:
            chunk_size = 1024
            total_samples = audio_np.shape[1]
            layout = "mono" if audio_np.shape[0] == 1 else "stereo"
            for start in range(0, total_samples, chunk_size):
                chunk = np.ascontiguousarray(audio_np[:, start:start + chunk_size])
                aframe = av.AudioFrame.from_ndarray(chunk, format="fltp", layout=layout)
                aframe.sample_rate = int(sample_rate)
                aframe.pts = start
                for packet in astream.encode(aframe):
                    container.mux(packet)
            for packet in astream.encode():
                container.mux(packet)
    finally:
        container.close()


class H3InfinityWrapper_IngestVideo:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "video_path": ("STRING", {
                    "default": "",
                    "tooltip": "Absolute path to the external video file to conform and encode.",
                }),
                "video_vae": ("VAE", {"tooltip": "MiniMax H3 Video VAE."}),
                "audio_vae": ("VAE", {"tooltip": "MiniMax H3 Audio VAE."}),
                "width": ("INT", {"default": 864, "min": 32, "max": 8192, "step": 32}),
                "height": ("INT", {"default": 480, "min": 32, "max": 8192, "step": 32}),
                "start_seconds": ("FLOAT", {
                    "default": 0.0, "min": 0.0, "max": 36000.0, "step": 0.1,
                    "tooltip": "Start offset in seconds within the source video.",
                }),
                "max_duration": ("FLOAT", {
                    "default": 30.0, "min": 0.25, "max": 30.0, "step": 0.1,
                    "tooltip": "Maximum duration to ingest in seconds (hard-capped at 30.0s for MiniMax H3).",
                }),
                "grid_snap": (["Exact AV (51k+39)", "Video Grid (17k+5)"], {
                    "default": "Exact AV (51k+39)",
                    "tooltip": "Exact AV (51k+39) gives zero audio drift and clean 39f Masked AV continuation. Video Grid (17k+5) trims fewer frames (auto-used if clip is under 39 frames).",
                }),
                "output_folder": ("STRING", {
                    "default": "h3_ingested",
                    "tooltip": "Folder to save [filename].mp4, [filename].safetensors, and [filename]_data.json. Relative paths save under ComfyUI/output; leave empty to skip saving.",
                }),
                "filename": ("STRING", {
                    "default": "",
                    "tooltip": "Base filename without extension. Leave empty to reuse the source video's filename.",
                }),
            }
        }

    RETURN_TYPES = ("LATENT", "IMAGE", "AUDIO", "H3_CONTINUOUS_HANDOVER", "STRING", "STRING", "STRING", "STRING")
    RETURN_NAMES = ("latent", "images", "audio", "handover", "latent_path", "video_path", "json_path", "ingest_info")
    FUNCTION = "ingest"
    OUTPUT_NODE = True
    CATEGORY = "H3 API Wrappers"
    DESCRIPTION = (
        "Conforms an external video to 24 fps, center-crops to exact width x height "
        "(never black bars), trims to H3's latent grid (max 30s), encodes both Video "
        "and Audio VAEs into a native H3 v1.4 AV NestedTensor latent, and saves "
        "[filename].mp4, [filename].safetensors, and [filename]_data.json."
    )

    def ingest(
        self,
        video_path: str,
        video_vae,
        audio_vae,
        width: int,
        height: int,
        start_seconds: float = 0.0,
        max_duration: float = 30.0,
        grid_snap: str = "Exact AV (51k+39)",
        output_folder: str = "h3_ingested",
        filename: str = "",
    ):
        src_path = (video_path or "").strip().strip('"').strip("'")
        if not src_path or not os.path.isfile(src_path):
            raise FileNotFoundError(f"H3 Ingest: video file not found: {src_path!r}")

        width = int(width)
        height = int(height)
        if width % 32 != 0 or height % 32 != 0:
            raise ValueError(f"H3 Ingest: width ({width}) and height ({height}) must be multiples of 32.")

        # 1. Decode video conformed to 24 fps (capped at 30s)
        raw_frames = _decode_video_24fps(src_path, start_seconds, max_duration)
        decoded_count = len(raw_frames)

        # 2. Snap frame count downward to H3 grid (never pad/repeat frames)
        frame_count, snap_mode = _snap_down_frame_count(decoded_count, grid_snap)
        raw_frames = raw_frames[:frame_count]

        # 3. Convert to tensor [N, H, W, 3] and center-crop to target width x height (no black bars)
        np_stack = np.stack(raw_frames, axis=0).astype(np.float32) / 255.0
        images = torch.from_numpy(np_stack)
        if int(images.shape[1]) != height or int(images.shape[2]) != width:
            samples = images.movedim(-1, 1)  # [N, C, H, W]
            samples = comfy.utils.common_upscale(samples, width, height, "lanczos", "center")
            images = samples.movedim(1, -1).contiguous()

        # 4. Conform audio to Audio VAE's native sample rate & exact video duration
        sr = int(getattr(audio_vae, "audio_sample_rate", getattr(audio_vae, "audio_sample_rate_input", 44100)))
        target_samples = int(round((frame_count / H3_FPS) * sr))
        waveform, has_audio = _decode_audio_conformed(src_path, start_seconds, target_samples, sr)
        audio = {"waveform": waveform, "sample_rate": sr}

        # 5. Encode Video + Audio VAEs and pack into H3 NestedTensor
        video_latent = video_vae.encode(images)
        if isinstance(video_latent, dict) and "samples" in video_latent:
            video_latent = video_latent["samples"]
        if video_latent.ndim == 4:
            video_latent = video_latent.unsqueeze(0)

        audio_latent = _encode_audio_latent(audio_vae, waveform, sr)

        latent = {
            "samples": comfy.nested_tensor.NestedTensor((video_latent, audio_latent)),
            "h3_head_context_frames": 0,
        }

        # 6. Build v1.4 handover metadata
        handover = _build_ingest_handover(frame_count)
        duration_seconds = round(frame_count / H3_FPS, 4)

        # 7. Save outputs to disk if output_folder is provided
        saved_latent_path = ""
        saved_video_path = ""
        saved_json_path = ""

        folder_clean = (output_folder or "").strip().strip('"').strip("'")
        if folder_clean:
            if os.path.isabs(folder_clean):
                out_dir = folder_clean
            else:
                out_dir = os.path.join(folder_paths.get_output_directory(), folder_clean)
            os.makedirs(out_dir, exist_ok=True)

            base_name = (filename or "").strip()
            if not base_name:
                base_name = os.path.splitext(os.path.basename(src_path))[0]
            else:
                # Strip accidental extension if user provided one
                root, ext = os.path.splitext(base_name)
                if ext.lower() in {".mp4", ".mov", ".mkv", ".safetensors", ".json"}:
                    base_name = root

            saved_video_path = os.path.join(out_dir, f"{base_name}.mp4")
            saved_latent_path = os.path.join(out_dir, f"{base_name}.safetensors")
            saved_json_path = os.path.join(out_dir, f"{base_name}_data.json")

            # Save conformed MP4
            _save_conformed_mp4(saved_video_path, images, waveform, sr, fps=int(H3_FPS))

            # Save H3 v1.4/v8 safetensors latent
            video_cpu = video_latent.detach().cpu().contiguous()
            audio_cpu = audio_latent.detach().cpu().contiguous()
            st_metadata = {
                "format": "h3_continuous_av_v8",
                "release_version": "1.4.0",
                "fps": str(int(H3_FPS)),
                "frame_count": str(frame_count),
                "head_context_frames": "0",
                "video_shape": json.dumps(list(video_cpu.shape)),
                "audio_shape": json.dumps(list(audio_cpu.shape)),
                "handover_json": json.dumps(handover, separators=(",", ":"), sort_keys=True),
            }
            st_save({"video": video_cpu, "audio": audio_cpu}, saved_latent_path, metadata=st_metadata)

            # Save [filename]_data.json
            data_payload = {
                "source_type": "ingested_external_video",
                "original_filename": os.path.basename(src_path),
                "original_path": src_path,
                "saved_video_path": saved_video_path,
                "saved_latent_path": saved_latent_path,
                "width": width,
                "height": height,
                "fps": H3_FPS,
                "frame_count": frame_count,
                "duration_seconds": duration_seconds,
                "start_seconds": float(start_seconds),
                "max_duration": float(max_duration),
                "decoded_frames_before_snap": decoded_count,
                "trimmed_frames": decoded_count - frame_count,
                "grid_snap": grid_snap,
                "snap_mode": snap_mode,
                "has_source_audio": has_audio,
                "audio_sample_rate": sr,
                "head_context_frames": 0,
                "video_latent_shape": list(video_cpu.shape),
                "audio_latent_shape": list(audio_cpu.shape),
                "short_clip_audio_warning": frame_count < 39,
            }
            with open(saved_json_path, "w", encoding="utf-8") as f:
                json.dump(data_payload, f, indent=4)

        warning = " | WARNING: <39 frames (use 22f context; ~8.3ms audio seam rounding)" if frame_count < 39 else ""
        save_note = f" | saved -> {saved_latent_path}" if saved_latent_path else " | save=skipped"
        info = (
            f"ingested {os.path.basename(src_path)} | {frame_count}f ({duration_seconds:.3f}s @ 24fps; "
            f"trimmed {decoded_count - frame_count}f via {snap_mode}) | "
            f"{width}x{height} center-crop | audio={'source' if has_audio else 'silence'} @ {sr}Hz | "
            f"video_latent={tuple(video_latent.shape)} | audio_latent={tuple(audio_latent.shape)}"
            f"{save_note}{warning}"
        )
        _LOG.info("H3 Ingest: %s", info)
        return (
            latent,
            images,
            audio,
            handover,
            saved_latent_path,
            saved_video_path,
            saved_json_path,
            info,
        )


NODE_CLASS_MAPPINGS = {
    "H3InfinityWrapper_IngestVideo": H3InfinityWrapper_IngestVideo,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "H3InfinityWrapper_IngestVideo": "H3 Wrapper - Ingest & Conform Video",
}