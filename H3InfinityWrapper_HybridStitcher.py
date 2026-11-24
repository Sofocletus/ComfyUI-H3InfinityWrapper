"""H3 Infinity Wrapper — Hybrid Streaming Stitcher.

Self-contained, memory-bounded PyAV stitcher for mixed timelines:
  - Standalone shots (hard cuts, full clip)
  - Continuous segments (seamless v1.4 Masked AV joins)
  - Bridge / Lead-In clips (automatic phase-0 head override + 0f video crossfade)

Accepts `stitch_paths_json` as either:
  1. Explicit manifest objects (recommended):
     [
       {"path": "/abs/clip1.safetensors", "join_from_prev": false, "trim_tail": false},
       {"path": "/abs/clip2.safetensors", "join_from_prev": false, "trim_tail": true},
       {"path": "/abs/clip3.safetensors", "join_from_prev": true,  "trim_tail": false}
     ]
  2. Plain path strings (backward-compatible continuous chain):
     ["/abs/clip1.safetensors", "/abs/clip2.safetensors"]
"""

import json
import logging
import os

import torch
from safetensors import safe_open
from safetensors.torch import load_file as st_load

import comfy.model_management
import folder_paths

_LOG = logging.getLogger("h3_wrapper_hybrid_stitcher")
FPS = 24.0
LUMINANCE_ANALYSIS_FRAMES = 4


# ---------------------------------------------------------------------------
# Self-contained H3 math & AV blending helpers (no Herrgott imports required)
# ---------------------------------------------------------------------------

def _pixel_frames(video_latent_t: int) -> int:
    """Exact MiniMax H3 pixel frame count for a given video latent temporal length.
    H3 groups 5 latent tokens into 17 frames with strides (1, 4, 4, 4, 4).
    """
    t = int(video_latent_t)
    if t <= 0:
        return 0
    groups, rem = divmod(t, 5)
    return groups * 17 + (0 if rem == 0 else 1 + 4 * (rem - 1))


def _read_safetensors_metadata(path: str):
    metadata = {}
    try:
        with safe_open(path, framework="pt", device="cpu") as f:
            metadata = f.metadata() or {}
    except Exception as exc:
        _LOG.warning("h3_hybrid_stitch: could not read metadata from %s: %s", path, exc)

    handover = None
    raw = metadata.get("handover_json")
    if raw:
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, dict):
                parsed["available"] = True
                handover = parsed
        except Exception as exc:
            _LOG.warning("h3_hybrid_stitch: invalid handover_json in %s: %s", path, exc)
    return metadata, handover


def _decode_saved_av(video_vae, audio_vae, video_latent: torch.Tensor, audio_latent: torch.Tensor):
    images = video_vae.decode(video_latent)
    if len(images.shape) == 5:
        images = images.reshape(-1, images.shape[-3], images.shape[-2], images.shape[-1])
    if images.ndim != 4:
        raise ValueError(f"h3_hybrid_stitch: unexpected decoded video shape {tuple(images.shape)}")

    waveform = audio_vae.decode(audio_latent).movedim(-1, 1)
    std = torch.std(waveform, dim=[1, 2], keepdim=True) * 5.0
    std[std < 1.0] = 1.0
    waveform = waveform / std
    sr = int(getattr(audio_vae, "audio_sample_rate_output", getattr(audio_vae, "audio_sample_rate", 44100)))
    return images, {"waveform": waveform, "sample_rate": sr}


def _fit_audio_length(waveform: torch.Tensor, want_samples: int) -> torch.Tensor:
    want = max(0, int(want_samples))
    cur = int(waveform.shape[-1])
    if cur == want:
        return waveform
    if cur > want:
        return waveform[..., :want]
    pad = torch.zeros(
        (*waveform.shape[:-1], want - cur),
        device=waveform.device,
        dtype=waveform.dtype,
    )
    return torch.cat((waveform, pad), dim=-1)


def _frame_trimmed_audio(audio: dict, frame_count: int, head: int, tail: int, fps: float = FPS) -> torch.Tensor:
    waveform = audio["waveform"]
    sr = int(audio["sample_rate"])
    head_samples = int(round(head / float(fps) * sr))
    kept_frames = max(0, int(frame_count) - int(head) - int(tail))
    want_samples = int(round(kept_frames / float(fps) * sr))
    sliced = waveform[..., head_samples:] if head_samples < waveform.shape[-1] else waveform[..., :0]
    return _fit_audio_length(sliced, want_samples)


def _blend_video_overlap(prev_tail: torch.Tensor, next_overlap: torch.Tensor) -> torch.Tensor:
    n = int(prev_tail.shape[0])
    if n <= 0:
        return prev_tail
    alpha = torch.linspace(
        1.0 / (n + 1), n / (n + 1), n, device=prev_tail.device, dtype=prev_tail.dtype
    ).view(n, 1, 1, 1)
    return prev_tail * (1.0 - alpha) + next_overlap * alpha


def _blend_audio_overlap(prev_tail: torch.Tensor, next_overlap: torch.Tensor) -> torch.Tensor:
    n = int(prev_tail.shape[-1])
    if n <= 0:
        return prev_tail
    t = torch.linspace(0.0, 1.0, n, device=prev_tail.device, dtype=prev_tail.dtype)
    fade_in = 0.5 - 0.5 * torch.cos(torch.pi * t)
    fade_out = 1.0 - fade_in
    shape = [1] * (prev_tail.ndim - 1) + [n]
    return prev_tail * fade_out.view(*shape) + next_overlap * fade_in.view(*shape)


def _apply_audio_edge_fade(waveform: torch.Tensor, fade_samples: int, fade_in: bool = False, fade_out: bool = False) -> torch.Tensor:
    n = min(max(0, int(fade_samples)), int(waveform.shape[-1]))
    if n <= 0 or (not fade_in and not fade_out):
        return waveform
    out = waveform.clone()
    ramp = torch.linspace(0.0, 1.0, n, device=out.device, dtype=out.dtype)
    shape = [1] * (out.ndim - 1) + [n]
    if fade_in:
        out[..., :n] = out[..., :n] * ramp.view(*shape)
    if fade_out:
        out[..., -n:] = out[..., -n:] * torch.flip(ramp, dims=[0]).view(*shape)
    return out


def _mean_luma(frames: torch.Tensor) -> float:
    rgb = frames[..., :3].float()
    luma = 0.2126 * rgb[..., 0] + 0.7152 * rgb[..., 1] + 0.0722 * rgb[..., 2]
    return float(luma.mean().item())


def _estimate_luminance_gain(
    prev_frames: torch.Tensor,
    next_frames: torch.Tensor,
    max_correction_percent: float = 10.0,
) -> tuple[float, float, bool]:
    prev_y = _mean_luma(prev_frames)
    next_y = _mean_luma(next_frames)
    if next_y < 1e-4:
        return 1.0, 1.0, False
    measured = prev_y / next_y
    max_delta = max(0.0, float(max_correction_percent)) / 100.0
    lo, hi = 1.0 - max_delta, 1.0 + max_delta
    applied = max(lo, min(hi, measured))
    return applied, measured, (applied != measured)


def _apply_rgb_gain(frames: torch.Tensor, gain: float) -> torch.Tensor:
    if abs(float(gain) - 1.0) < 1e-5 or int(frames.shape[0]) == 0:
        return frames
    return (frames * float(gain)).clamp(0.0, 1.0)


def _apply_luminance_gain_fade(frames: torch.Tensor, gain: float, fade_frames: int) -> tuple[torch.Tensor, int]:
    n = min(max(0, int(fade_frames)), int(frames.shape[0]))
    if n <= 0 or abs(float(gain) - 1.0) < 1e-5:
        return frames, 0
    out = frames.clone()
    gains = torch.linspace(float(gain), 1.0, n, device=out.device, dtype=out.dtype).view(n, 1, 1, 1)
    out[:n] = (out[:n] * gains).clamp(0.0, 1.0)
    return out, n


def _parse_manifest(stitch_paths_json: str) -> list[dict]:
    try:
        raw = json.loads(stitch_paths_json or "[]")
    except Exception as exc:
        raise ValueError(f"h3_hybrid_stitch: invalid stitch_paths_json: {exc}") from exc

    if not isinstance(raw, list) or len(raw) == 0:
        raise ValueError("h3_hybrid_stitch: stitch_paths_json must be a non-empty JSON list")

    items = []
    for idx, entry in enumerate(raw):
        if isinstance(entry, str):
            items.append({
                "path": entry.strip(),
                "join_from_prev": idx > 0,
                "trim_tail": None,
            })
        elif isinstance(entry, dict):
            path = str(entry.get("path", "")).strip()
            if not path:
                raise ValueError(f"h3_hybrid_stitch: manifest item {idx} is missing 'path'")
            items.append({
                "path": path,
                "join_from_prev": bool(entry.get("join_from_prev", False)) if idx > 0 else False,
                "trim_tail": entry.get("trim_tail", None),
            })
        else:
            raise ValueError(f"h3_hybrid_stitch: unsupported manifest entry at index {idx}: {type(entry)!r}")

    for idx, item in enumerate(items):
        if item["trim_tail"] is None:
            item["trim_tail"] = (idx + 1 < len(items)) and bool(items[idx + 1]["join_from_prev"])
        else:
            item["trim_tail"] = bool(item["trim_tail"])
    return items


def _resolve_tail_trim(frame_count: int, handover: dict | None, trim_tail: bool) -> int:
    if not trim_tail:
        return 0
    if not isinstance(handover, dict) or not handover.get("available"):
        return 0
    meta_frames = int(handover.get("frame_count", frame_count))
    if meta_frames != int(frame_count):
        _LOG.warning(
            "h3_hybrid_stitch: handover frame_count %s != latent %s; skipping tail trim",
            meta_frames, frame_count,
        )
        return 0
    end_frame = int(handover.get("handover_end_frame", frame_count - 1))
    return max(0, int(frame_count) - (end_frame + 1))


# ---------------------------------------------------------------------------
# ComfyUI Node
# ---------------------------------------------------------------------------

class H3InfinityWrapper_HybridStitcher:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "video_vae": ("VAE", {"tooltip": "MiniMax H3 Video VAE."}),
                "audio_vae": ("VAE", {"tooltip": "MiniMax H3 Audio VAE."}),
                "stitch_paths_json": ("STRING", {
                    "forceInput": True,
                    "tooltip": "JSON list of manifest objects ({path, join_from_prev, trim_tail}) or plain file paths.",
                }),
                "stitch_mp4_path": ("STRING", {
                    "forceInput": True,
                    "tooltip": "Output MP4 path (absolute, or relative to ComfyUI/output).",
                }),
                "video_crossfade_frames": ("INT", {
                    "default": 4, "min": 0, "max": 16, "step": 1,
                    "tooltip": "Video crossfade on seamless Continue joins. Automatically forced to 0 on hard cuts and Bridge seams.",
                }),
                "audio_crossfade_ms": ("FLOAT", {
                    "default": 15.0, "min": 0.0, "max": 100.0, "step": 1.0,
                    "tooltip": "Audio crossfade (ms) on seamless Continue/Bridge joins.",
                }),
                "hard_cut_audio_fade_ms": ("FLOAT", {
                    "default": 5.0, "min": 0.0, "max": 50.0, "step": 1.0,
                    "tooltip": "Short anti-click audio fade (ms) applied at hard-cut boundaries. Set 0 for raw hard cuts.",
                }),
                "luminance_match": ("BOOLEAN", {
                    "default": False,
                    "tooltip": "Fallback only. Keep OFF for v1.4 Native Masked AV unless a brightness seam appears. Automatically disabled on hard cuts and Bridge seams.",
                }),
                "luminance_fade_frames": ("INT", {
                    "default": 16, "min": 0, "max": 96, "step": 1,
                    "tooltip": "Frames over which luminance correction fades back to native brightness. Ignored when luminance_match is off.",
                }),
                "max_luminance_correction_percent": ("FLOAT", {
                    "default": 10.0, "min": 0.0, "max": 25.0, "step": 0.5,
                    "tooltip": "Safety clamp for automatic brightness correction. Ignored when luminance_match is off.",
                }),
                "crf": ("INT", {
                    "default": 18, "min": 0, "max": 51, "step": 1,
                    "tooltip": "H.264 quality (lower = higher quality).",
                }),
            }
        }

    RETURN_TYPES = ("STRING", "STRING")
    RETURN_NAMES = ("video_path", "stitch_info")
    FUNCTION = "stitch"
    OUTPUT_NODE = True
    CATEGORY = "H3 Infinity Wrapper"
    DESCRIPTION = (
        "Memory-bounded streaming MP4 stitcher for hybrid H3 timelines. Mixes standalone "
        "hard-cut shots, continuous segments, and Bridge/Lead-In clips in a single pass."
    )

    def stitch(
        self,
        video_vae,
        audio_vae,
        stitch_paths_json="[]",
        stitch_mp4_path="",
        video_crossfade_frames=4,
        audio_crossfade_ms=15.0,
        hard_cut_audio_fade_ms=5.0,
        luminance_match=False,
        luminance_fade_frames=16,
        max_luminance_correction_percent=10.0,
        crf=18,
    ):
        try:
            import av
            import numpy as np
            from fractions import Fraction
        except Exception as exc:
            raise RuntimeError("h3_hybrid_stitch: PyAV and NumPy are required") from exc

        manifest = _parse_manifest(stitch_paths_json)

        out_path = (stitch_mp4_path or "").strip().strip('"').strip("'")
        if not out_path:
            folder, filename, counter, _, _ = folder_paths.get_save_image_path(
                "video/H3_Hybrid_Stitched", folder_paths.get_output_directory()
            )
            os.makedirs(folder, exist_ok=True)
            out_path = os.path.join(folder, f"{filename}_{int(counter):05d}_.mp4")
        else:
            if not os.path.isabs(out_path):
                out_path = os.path.join(folder_paths.get_output_directory(), out_path)
            os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)

        requested_vfade = max(0, int(video_crossfade_frames))
        requested_afade_ms = max(0.0, float(audio_crossfade_ms))
        hard_cut_fade_ms = max(0.0, float(hard_cut_audio_fade_ms))
        requested_luma_match = bool(luminance_match)
        requested_luma_fade = max(0, int(luminance_fade_frames))
        requested_luma_max_pct = max(0.0, float(max_luminance_correction_percent))
        video_boundary_hold = max(
            requested_vfade,
            LUMINANCE_ANALYSIS_FRAMES if requested_luma_match else 0,
        )

        output = None
        vstream = None
        astream = None
        video_written = 0
        audio_written = 0
        sr = None
        channels = None
        layout = None

        pending_video = None
        pending_audio = None
        previous_handover = None
        logical_frames = 0
        logical_audio_samples = 0
        clip_summaries = []

        def write_video(frames):
            nonlocal video_written
            if frames is None or int(frames.shape[0]) == 0:
                return
            for frame_tensor in frames:
                img = (frame_tensor * 255).clamp(0, 255).byte().detach().cpu().numpy()
                frame = av.VideoFrame.from_ndarray(np.ascontiguousarray(img), format="rgb24")
                frame = frame.reformat(format="yuv420p")
                frame.pts = video_written
                frame.time_base = Fraction(1, int(FPS))
                for packet in vstream.encode(frame):
                    output.mux(packet)
                video_written += 1

        def write_audio(wave):
            nonlocal audio_written
            if wave is None or int(wave.shape[-1]) == 0:
                return
            arr = wave[0].float().detach().cpu().contiguous().numpy()
            frame = av.AudioFrame.from_ndarray(np.ascontiguousarray(arr), format="fltp", layout=layout)
            frame.sample_rate = sr
            frame.pts = audio_written
            frame.time_base = Fraction(1, sr)
            for packet in astream.encode(frame):
                output.mux(packet)
            audio_written += int(wave.shape[-1])

        try:
            total_clips = len(manifest)
            for idx, item in enumerate(manifest):
                path = item["path"]
                if not os.path.isfile(path):
                    raise FileNotFoundError(f"h3_hybrid_stitch: clip {idx + 1} not found: {path}")

                join_from_prev = bool(item["join_from_prev"]) and idx > 0
                next_joins_from_here = (idx + 1 < total_clips) and bool(manifest[idx + 1]["join_from_prev"])
                trim_tail = bool(item["trim_tail"])

                tensors = st_load(path, device="cpu")
                if "video" not in tensors or "audio" not in tensors:
                    raise ValueError(f"h3_hybrid_stitch: clip {idx + 1} lacks video/audio tensors: {path}")
                video_latent, audio_latent = tensors["video"], tensors["audio"]
                frame_count = _pixel_frames(video_latent.shape[2])

                metadata, handover = _read_safetensors_metadata(path)
                if handover is not None:
                    handover["frame_count"] = frame_count

                # Always trim saved head_context_frames so old overlap never leaks,
                # and honor Bridge phase-0 override on seamless Bridge joins.
                try:
                    head = max(0, int(metadata.get("head_context_frames", 0) or 0))
                except (TypeError, ValueError):
                    head = 0
                head_source = "metadata"

                is_insert_seam = (
                    join_from_prev
                    and isinstance(previous_handover, dict)
                    and str(previous_handover.get("masked_av_stitch_policy", "")) == "insert_video_exact_tail_trim"
                )
                if is_insert_seam and int(previous_handover.get("next_clip_head_override", 0) or 0) > 0:
                    head = int(previous_handover["next_clip_head_override"])
                    head_source = "insert_video_phase0_override"

                tail = _resolve_tail_trim(frame_count, handover, trim_tail)
                if head + tail >= frame_count:
                    raise ValueError(
                        f"h3_hybrid_stitch: clip {idx + 1} head({head}) + tail({tail}) >= frames({frame_count})"
                    )

                images, audio = _decode_saved_av(video_vae, audio_vae, video_latent, audio_latent)
                if int(images.shape[0]) != frame_count:
                    raise ValueError(
                        f"h3_hybrid_stitch: clip {idx + 1} decoded {int(images.shape[0])}f != expected {frame_count}f"
                    )
                wave = audio["waveform"]
                clip_sr = int(audio["sample_rate"])
                clip_channels = int(wave.shape[1])

                if output is None:
                    h, w = int(images.shape[1]), int(images.shape[2])
                    if w % 2 or h % 2:
                        raise ValueError(f"h3_hybrid_stitch: H.264 requires even dimensions, got {w}x{h}")
                    sr = clip_sr
                    channels = clip_channels
                    if channels not in (1, 2):
                        raise ValueError(f"h3_hybrid_stitch: supports mono/stereo audio, got {channels} channels")
                    layout = "mono" if channels == 1 else "stereo"
                    output = av.open(out_path, mode="w", options={"movflags": "use_metadata_tags+faststart"})
                    vstream = output.add_stream("h264", rate=Fraction(int(FPS), 1))
                    vstream.codec_context.max_b_frames = 0
                    vstream.codec_context.time_base = Fraction(1, int(FPS))
                    vstream.width = w
                    vstream.height = h
                    vstream.pix_fmt = "yuv420p"
                    vstream.options = {"crf": str(int(crf))}
                    astream = output.add_stream("aac", rate=sr, layout=layout)
                else:
                    if (int(images.shape[2]), int(images.shape[1])) != (vstream.width, vstream.height):
                        raise ValueError(f"h3_hybrid_stitch: clip {idx + 1} resolution differs from clip 1")
                    if clip_sr != sr or clip_channels != channels:
                        raise ValueError(f"h3_hybrid_stitch: clip {idx + 1} audio format differs from clip 1")

                end = frame_count - tail if tail else frame_count
                body_images = images[head:end]
                body_audio = _frame_trimmed_audio(audio, frame_count, head, tail, FPS)

                base_body_frames = int(frame_count - head - tail)
                target_total_frames = logical_frames + base_body_frames
                target_total_samples = int(round(target_total_frames / float(FPS) * sr))
                want_body_samples = max(0, target_total_samples - logical_audio_samples)
                body_audio = _fit_audio_length(body_audio, want_body_samples)
                logical_frames = target_total_frames
                logical_audio_samples = target_total_samples

                hard_fade_samples = int(round(hard_cut_fade_ms / 1000.0 * sr))
                an_req = int(round(requested_afade_ms / 1000.0 * sr))

                effective_vfade = 0
                effective_afade = 0
                luma_gain = 1.0
                luma_note = "off"
                seam_type = "start"

                # --- Incoming seam handling ---
                if idx > 0:
                    if not join_from_prev:
                        seam_type = "hard_cut"
                        if pending_video is not None and int(pending_video.shape[0]) > 0:
                            write_video(pending_video)
                        if pending_audio is not None and int(pending_audio.shape[-1]) > 0:
                            write_audio(_apply_audio_edge_fade(pending_audio, hard_fade_samples, fade_out=True))
                        pending_video = None
                        pending_audio = None
                        if hard_fade_samples > 0:
                            body_audio = _apply_audio_edge_fade(body_audio, hard_fade_samples, fade_in=True)
                    else:
                        seam_type = "bridge_join" if is_insert_seam else "seamless_join"
                        seam_vfade = 0 if is_insert_seam else requested_vfade
                        seam_luma = False if is_insert_seam else requested_luma_match

                        if seam_luma and pending_video is not None and head > 0:
                            luma_n = min(LUMINANCE_ANALYSIS_FRAMES, head, int(pending_video.shape[0]))
                            if luma_n > 0:
                                luma_gain, luma_meas, luma_clamped = _estimate_luminance_gain(
                                    pending_video[-luma_n:],
                                    images[head - luma_n:head].detach().cpu().to(pending_video.dtype),
                                    max_correction_percent=requested_luma_max_pct,
                                )
                                body_images, luma_faded = _apply_luminance_gain_fade(
                                    body_images, luma_gain, requested_luma_fade
                                )
                                luma_note = (
                                    f"gain {luma_gain:.4f} (meas {luma_meas:.4f}, "
                                    f"fade {luma_faded}f, clamped={'yes' if luma_clamped else 'no'})"
                                )

                        vn = min(seam_vfade, head, int(pending_video.shape[0]) if pending_video is not None else 0)
                        if pending_video is not None:
                            if int(pending_video.shape[0]) > vn:
                                write_video(pending_video[:-vn] if vn else pending_video)
                            if vn > 0:
                                prev_tail = pending_video[-vn:]
                                next_overlap = images[head - vn:head].detach().cpu().to(prev_tail.dtype)
                                if seam_luma:
                                    next_overlap = _apply_rgb_gain(next_overlap, luma_gain)
                                write_video(_blend_video_overlap(prev_tail, next_overlap))

                        head_samples = int(round(head / float(FPS) * sr))
                        an = min(an_req, head_samples, int(pending_audio.shape[-1]) if pending_audio is not None else 0)
                        if pending_audio is not None:
                            if int(pending_audio.shape[-1]) > an:
                                write_audio(pending_audio[..., :-an] if an else pending_audio)
                            if an > 0:
                                prev_tail_a = pending_audio[..., -an:]
                                next_overlap_a = wave[..., head_samples - an:head_samples].detach().cpu().to(prev_tail_a.dtype)
                                write_audio(_blend_audio_overlap(prev_tail_a, next_overlap_a))

                        effective_vfade = vn
                        effective_afade = an

                # --- Outgoing body & buffer handling ---
                if next_joins_from_here:
                    hold_v = min(video_boundary_hold, int(body_images.shape[0]))
                    hold_a = min(an_req, int(body_audio.shape[-1]))
                    write_video(body_images[:-hold_v] if hold_v else body_images)
                    pending_video = body_images[-hold_v:].detach().cpu() if hold_v else body_images[:0].detach().cpu()
                    write_audio(body_audio[..., :-hold_a] if hold_a else body_audio)
                    pending_audio = body_audio[..., -hold_a:].detach().cpu() if hold_a else body_audio[..., :0].detach().cpu()
                else:
                    is_last = idx == total_clips - 1
                    if not is_last and hard_fade_samples > 0:
                        body_audio = _apply_audio_edge_fade(body_audio, hard_fade_samples, fade_out=True)
                    write_video(body_images)
                    write_audio(body_audio)
                    pending_video = None
                    pending_audio = None

                clip_summaries.append(
                    f"clip {idx + 1} [{seam_type}]: head {head} ({head_source}), tail {tail}, "
                    f"join {effective_vfade}f/{round(effective_afade / sr * 1000.0, 1) if sr else 0}ms, luma {luma_note}"
                )
                previous_handover = handover if next_joins_from_here else None

                del tensors, video_latent, audio_latent, images, audio, wave, body_images, body_audio
                comfy.model_management.soft_empty_cache()

            if pending_video is not None:
                write_video(pending_video)
            if pending_audio is not None:
                write_audio(pending_audio)

            for packet in vstream.encode(None):
                output.mux(packet)
            for packet in astream.encode(None):
                output.mux(packet)
            output.close()
            output = None
        except BaseException:
            if output is not None:
                try:
                    output.close()
                except Exception:
                    pass
            if os.path.exists(out_path):
                try:
                    os.remove(out_path)
                except Exception:
                    pass
            raise

        info = (
            f"hybrid stitch complete | {total_clips} clips | {video_written} frames @ {FPS:g}fps | "
            f"audio {audio_written} samples @ {sr}Hz | " + " ; ".join(clip_summaries)
        )
        _LOG.info("h3_hybrid_stitch: %s", info)
        return (out_path, info)


NODE_CLASS_MAPPINGS = {
    "H3InfinityWrapper_HybridStitcher": H3InfinityWrapper_HybridStitcher,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "H3InfinityWrapper_HybridStitcher": "H3 Wrapper - Hybrid Stitcher",
}