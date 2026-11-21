"""H3 Infinite Insert Video: Native Masked AV Lead-In & Bridge Node.

Supports two workflows in a single node:
  1. Lead-In Mode (next_latent only):
     Locks the tail of the generated clip to the opening of `next_latent`
     (video + audio) and generates a seamless lead-in before it.
  2. Insert / Bridge Mode (previous_latent + next_latent):
     Locks the head to the freeze-safe handover of `previous_latent` AND locks
     the tail to the next clean phase-0 boundary of `next_latent` (snapping
     forward past any saved `h3_head_context_frames` so there is zero causal
     VAE bleed from the old preceding clip).
"""

import logging
import torch
import comfy.nested_tensor

from .latent_math import (
    FPS,
    AUDIO_HZ,
    pixel_frames,
    latent_boundaries,
    step_offsets,
    masked_av_audio_context_plan,
    is_exact_masked_av_context,
)
from .nodes import (
    H3ContinuousStart,
    RELEASE_VERSION,
    _QWEN_REFERENCE_TOOLTIP,
    _require_masked_av_support,
    _streams_from_latent,
    _apply_audio_context_feather,
)
from .qwen_guides import (
    DynamicQwenReferenceInputs,
    collect_qwen_reference_entries,
    format_picture_map,
)
from .release_utils import duration_to_requested_frames

_LOG = logging.getLogger("h3_continuous")


def _snap_up_exact_av_grid(frames: int, min_frames: int = 90) -> int:
    """Snap a frame count upward onto H3's exact joint 24fps / 40Hz grid (51k + 39)."""
    n = max(int(frames), int(min_frames), 39)
    if (n - 39) % 51 != 0:
        n = 39 + (((n - 39) // 51) + 1) * 51
    if not is_exact_masked_av_context(n):
        raise RuntimeError(f"Internal exact AV grid snap failed for {frames} -> {n}")
    return n


def _video_steps_for_av_context(frame_count: int) -> int:
    """Exact H3 video latent steps for any 17k+5 context length (22, 39, 90, ...)."""
    n = int(frame_count)
    if n < 5 or (n - 5) % 17 != 0:
        raise ValueError(
            f"h3_insert: context_frames must lie on H3's 17k+5 grid (22, 39, 90, 141, 192), got {n}"
        )
    return 2 + 5 * ((n - 5) // 17)


def _audio_steps_for_av_context(frame_count: int) -> int:
    """40 Hz audio latent ticks for a context length."""
    return int(round(int(frame_count) * AUDIO_HZ / FPS))


def _phase_aligned_head_slice(
    video_latent_t: int,
    context_frames: int,
    *,
    ideal_last_frame: int | None = None,
    desired_tail_frames: int | None = None,
):
    """Select a phase-0 -> phase-2 source run for any 17k+5 context (including 22f)."""
    video_latent_t = int(video_latent_t)
    n = int(context_frames)
    context_steps = _video_steps_for_av_context(n)
    boundaries = latent_boundaries(video_latent_t)
    previous_frame_count = boundaries[-1]

    if ideal_last_frame is not None:
        ideal_last_frame = max(n - 1, min(previous_frame_count - 1, int(ideal_last_frame)))
        desired_end_exclusive = ideal_last_frame + 1
    else:
        desired_tail_frames = max(0, int(desired_tail_frames or 0))
        desired_end_exclusive = max(n, previous_frame_count - desired_tail_frames)

    end_t = None
    for candidate in range(video_latent_t, context_steps - 1, -1):
        if candidate % 5 != 2:
            continue
        if boundaries[candidate] <= desired_end_exclusive:
            start = candidate - context_steps
            if start >= 0 and start % 5 == 0:
                end_t = candidate
                break
    if end_t is None:
        raise ValueError(
            f"h3_insert: previous_latent has no phase-aligned {n}f context before the handover cutoff"
        )

    start_t = end_t - context_steps
    return {
        "start_t": start_t,
        "end_t": end_t,
        "context_steps": context_steps,
        "offsets": step_offsets(context_steps),
        "source_start_frame": boundaries[start_t],
        "source_end_frame": boundaries[end_t],
        "previous_frame_count": previous_frame_count,
        "actual_context_frames": n,
    }


def _apply_audio_tail_feather(mask: torch.Tensor, audio_steps: int, feather_ticks: int) -> torch.Tensor:
    """Optionally feather the leading edge of a protected tail audio block."""
    audio_steps = int(audio_steps)
    feather = max(0, min(int(feather_ticks), audio_steps))
    total = int(mask.shape[-1])
    tail_start = total - audio_steps
    hard_start = tail_start + feather

    if hard_start < total:
        mask[..., hard_start:] = 0.0
    if feather > 0:
        i = torch.arange(1, feather + 1, device=mask.device, dtype=mask.dtype)
        ramp = 0.5 + 0.5 * torch.cos(torch.pi * i / float(feather))
        shape = [1] * mask.ndim
        shape[-1] = feather
        mask[..., tail_start:hard_start] = ramp.view(*shape)
    return mask


def _build_synthetic_tail_handover(
    frame_count: int,
    landing_tail_frames: int,
    next_clip_head_override: int = 0,
) -> dict:
    """Build a v1.4-compatible handover dict so downstream stitchers / take outputs
    automatically trim the exact protected tail overlap and (when snapped forward
    to phase 0) override the next clip's head trim to match.
    """
    frame_count = int(frame_count)
    tail = max(0, int(landing_tail_frames))
    end_frame = frame_count - 1 - tail
    return {
        "available": True,
        "frame_count": frame_count,
        "freeze_detected": False,
        "freeze_start_frame": -1,
        "ideal_handover_end_frame": end_frame,
        "handover_end_frame": end_frame,
        "landing_tail_frames": tail,
        "legacy_landing_tail_frames": tail,
        "next_clip_head_override": max(0, int(next_clip_head_override)),
        "confidence": 1.0,
        "safety_mode": "fixed",
        "no_lock_fallback_applied": False,
        "no_lock_fallback_reason": "insert_video_protected_tail",
        "masked_av_source_policy": "safe_handover_window",
        "masked_av_detector_desired_end_frame": end_frame,
        "masked_av_cutoff_loss_frames": 0,
        "masked_av_stitch_policy": "insert_video_exact_tail_trim",
        "masked_av_render_safety_applied": False,
        "masked_av_render_safety_frames": 0,
        "phase_aligned_cutoff_loss_frames": 0,
        "phase_aligned_context_extension_frames": 0,
        "release_version": RELEASE_VERSION,
        "version": 12,
    }


class H3InfiniteInsertVideo:
    @classmethod
    def INPUT_TYPES(cls):
        required = {
            "clip": ("CLIP",),
            "vae": ("VAE",),
            "prompt": ("STRING", {"multiline": True, "dynamicPrompts": True}),
            "width": ("INT", {"default": 1344, "min": 32, "max": 8192, "step": 32}),
            "height": ("INT", {"default": 768, "min": 32, "max": 8192, "step": 32}),
            "duration": ("FLOAT", {
                "default": 5.0, "min": 1.0, "max": 150.0, "step": 0.1,
                "tooltip": "Duration in seconds at 24 fps. Interpreted according to Duration Mode and snapped to H3's exact 51k+39 AV grid.",
            }),
            "tail_context_frames": (["22", "39", "90", "141", "192"], {
                "default": "39",
                "tooltip": "Number of frames from next_latent to lock into the tail. 39 (~1.625s) is exact AV; 22 (~0.92s) is video-exact with ~8.3ms audio rounding.",
            }),
            "head_context_frames": (["22", "39", "90", "141", "192"], {
                "default": "39",
                "tooltip": "Used only in Bridge Mode (when previous_latent is connected). Number of frames from previous_latent to lock into the head.",
            }),
            "duration_mode": (["Net New Content", "Total Generation"], {
                "default": "Net New Content",
                "tooltip": "Net New Content targets this much newly generated body after protected head/tail overlaps are trimmed. Total Generation targets the whole clip length.",
            }),
            "audio_tail_carryover": (["Full Previous Tail", "Match Video Handover"], {
                "default": "Full Previous Tail",
                "tooltip": "Bridge Mode only: protect previous_latent's remaining audio tail beyond its visual handover (clamped so it never overlaps next_latent's audio).",
            }),
            "audio_feather_ticks": ("INT", {
                "default": 0, "min": 0, "max": 256, "step": 1, "advanced": True,
                "tooltip": "Keep 0 for hard audio protection. Nonzero values add a short half-cosine mask ramp at the protected audio seams.",
            }),
            "ref_image_size": (["match", "max"], {"default": "match"}),
        }
        optional = DynamicQwenReferenceInputs(
            {
                "next_latent": ("LATENT", {
                    "tooltip": "Target second video's AV latent. Automatically snaps forward past next_latent['h3_head_context_frames'] to a clean phase-0 boundary.",
                }),
                "previous_latent": ("LATENT", {
                    "tooltip": "Optional preceding video's AV latent. Connect together with next_latent to generate a seamless bridge between two clips.",
                }),
                "previous_handover": ("H3_CONTINUOUS_HANDOVER", {
                    "tooltip": "Optional freeze-safe handover metadata for previous_latent. If omitted in Bridge Mode, slices from the very end of previous_latent.",
                }),
                "first_frame": ("IMAGE", {
                    "tooltip": "Optional First Frame keyframe (used only when previous_latent is NOT connected).",
                }),
                "qwen_reference_1": ("IMAGE", {"tooltip": "Qwen Reference 1. " + _QWEN_REFERENCE_TOOLTIP}),
            },
            tooltip=_QWEN_REFERENCE_TOOLTIP,
        )
        return {"required": required, "optional": optional}

    RETURN_TYPES = ("CONDITIONING", "LATENT", "INT", "INT", "H3_CONTINUOUS_HANDOVER", "STRING", "STRING")
    RETURN_NAMES = (
        "positive",
        "latent",
        "actual_head_context_frames",
        "actual_tail_context_frames",
        "handover",
        "insert_info",
        "picture_map",
    )
    FUNCTION = "build"
    CATEGORY = "Herrgotts H3 Infinite Continuation Suite"
    DESCRIPTION = (
        "Native Masked AV lead-in and bridge generator. Connect next_latent alone to generate a "
        "lead-in video that blends seamlessly into the start of next_latent, or connect both "
        "previous_latent and next_latent to insert a seamless bridge between them."
    )

    def build(
        self,
        clip,
        vae,
        prompt,
        width,
        height,
        duration,
        tail_context_frames="39",
        head_context_frames="39",
        duration_mode="Net New Content",
        audio_tail_carryover="Full Previous Tail",
        audio_feather_ticks=0,
        ref_image_size="match",
        next_latent=None,
        previous_latent=None,
        previous_handover=None,
        first_frame=None,
        qwen_reference_1=None,
        **kwargs,
    ):
        if next_latent is None and previous_latent is None:
            raise ValueError(
                "H3 Infinite Insert Video requires at least `next_latent` (Lead-In Mode) "
                "or both `previous_latent` and `next_latent` (Bridge Mode)."
            )

        comfy_version = _require_masked_av_support()

        has_prev = previous_latent is not None
        has_next = next_latent is not None

        head_ctx = int(head_context_frames) if has_prev else 0
        tail_ctx = int(tail_context_frames) if has_next else 0

        # Compute total frame count on H3's exact 51k+39 AV grid.
        requested_frames = duration_to_requested_frames(duration)
        min_required_total = head_ctx + tail_ctx + 17
        if duration_mode == "Net New Content":
            desired_total = requested_frames + head_ctx + tail_ctx
        else:
            desired_total = requested_frames
        frame_count = _snap_up_exact_av_grid(desired_total, min_frames=min_required_total)

        # Qwen references & optional first_frame (only when head is not latent-locked).
        qwen_entries = collect_qwen_reference_entries(qwen_reference_1, kwargs)
        qwen_references = [image for _, image in qwen_entries]
        qwen_indices = [index for index, _ in qwen_entries]
        use_first_frame = first_frame if (not has_prev and first_frame is not None) else None

        picture_map = format_picture_map(
            first_frame=use_first_frame is not None,
            last_frame=False,
            qwen_reference_count=len(qwen_references),
            continuation=has_prev,
            qwen_reference_indices=qwen_indices,
        )

        # Build base conditioning and empty target AV latent.
        cond, target_latent = H3ContinuousStart.build(
            self,
            clip,
            vae,
            prompt,
            width,
            height,
            frame_count,
            use_first_frame,
            None,
            ref_image_size=ref_image_size,
            reference_image=None,
            qwen_references=qwen_references,
        )

        target_video, target_audio = _streams_from_latent(target_latent)
        out_video = target_video.clone()
        out_audio = target_audio.clone()

        video_mask = torch.ones(
            (1, 1, int(out_video.shape[2]), int(out_video.shape[3]), int(out_video.shape[4])),
            device=out_video.device,
            dtype=torch.float32,
        )
        audio_mask = torch.ones(
            (1, 1, int(out_audio.shape[2]), int(out_audio.shape[3])),
            device=out_audio.device,
            dtype=torch.float32,
        )

        info_parts = [
            f"mode={'bridge' if (has_prev and has_next) else ('lead_in' if has_next else 'continue')}",
            f"ComfyUI {comfy_version}",
            f"total {frame_count}f ({frame_count / FPS:.3f}s)",
        ]

        # --- 1. Anchor TAIL to a clean phase-0 boundary of next_latent ---
        tail_audio_steps = 0
        next_clip_head_override = 0
        if has_next:
            next_video, next_audio = _streams_from_latent(next_latent)
            self._validate_geometry(next_video, next_audio, out_video, out_audio, label="next_latent")

            tail_video_steps = _video_steps_for_av_context(tail_ctx)
            tail_audio_steps = _audio_steps_for_av_context(tail_ctx)

            # Snap next_head_offset FORWARD to the next H3 phase-0 boundary (17k frames / 5k tokens)
            # so the tail lock begins on a fresh 17-frame causal VAE group with zero bleed from
            # next_latent's old head_context_frames (e.g., 0 -> 0, 22 -> 34, 39 -> 51, 90 -> 102).
            next_head_offset = max(0, int(next_latent.get("h3_head_context_frames", 0) or 0))
            phase0_group = (next_head_offset + 16) // 17
            next_v_start = phase0_group * 5
            snapped_start_frame = phase0_group * 17
            next_clip_head_override = snapped_start_frame

            next_v_end = next_v_start + tail_video_steps
            next_a_start = _audio_steps_for_av_context(snapped_start_frame)
            next_a_end = next_a_start + tail_audio_steps

            if int(next_video.shape[2]) < next_v_end or int(next_audio.shape[-1]) < next_a_end:
                raise ValueError(
                    f"h3_insert: next_latent is too short for tail_context_frames={tail_ctx} "
                    f"starting at phase-0 frame {snapped_start_frame} "
                    f"(needs {next_v_end}v/{next_a_end}a, got {int(next_video.shape[2])}v/{int(next_audio.shape[-1])}a)"
                )

            out_video[:, :, -tail_video_steps:] = next_video[:1, :, next_v_start:next_v_end].to(
                device=out_video.device, dtype=out_video.dtype
            )
            out_audio[..., -tail_audio_steps:] = next_audio[:1, ..., next_a_start:next_a_end].to(
                device=out_audio.device, dtype=out_audio.dtype
            )
            video_mask[:, :, -tail_video_steps:] = 0.0
            _apply_audio_tail_feather(audio_mask, tail_audio_steps, audio_feather_ticks)

            info_parts.append(
                f"tail_lock={tail_ctx}f (next {next_v_start}:{next_v_end}v [phase 0], "
                f"{next_a_start}:{next_a_end}a; next_head={next_head_offset}f -> phase0_snap={snapped_start_frame}f)"
            )

        # --- 2. Anchor HEAD to the freeze-safe end of previous_latent (Bridge Mode) ---
        if has_prev:
            prev_video, prev_audio = _streams_from_latent(previous_latent)
            self._validate_geometry(prev_video, prev_audio, out_video, out_audio, label="previous_latent")
            previous_frame_count = pixel_frames(prev_video.shape[2])

            if isinstance(previous_handover, dict) and previous_handover.get("available"):
                safe_end = int(previous_handover.get("handover_end_frame", previous_frame_count - 1))
                sl = _phase_aligned_head_slice(
                    prev_video.shape[2], head_ctx, ideal_last_frame=safe_end
                )
            else:
                sl = _phase_aligned_head_slice(
                    prev_video.shape[2], head_ctx, desired_tail_frames=0
                )

            head_video_steps = int(sl["context_steps"])
            head_ctx = int(sl["actual_context_frames"])

            audio_plan = masked_av_audio_context_plan(
                prev_audio.shape[-1],
                sl["source_start_frame"],
                sl["source_end_frame"],
                sl["previous_frame_count"],
                audio_tail_carryover,
            )
            a0 = int(audio_plan["start_tick"])
            a1 = int(audio_plan["end_tick"])
            head_audio_steps = int(audio_plan["audio_steps"])

            max_head_audio = int(out_audio.shape[-1]) - tail_audio_steps - 1
            if head_audio_steps > max_head_audio:
                head_audio_steps = max_head_audio
                a1 = a0 + head_audio_steps

            out_video[:, :, :head_video_steps] = prev_video[:1, :, sl["start_t"]:sl["end_t"]].to(
                device=out_video.device, dtype=out_video.dtype
            )
            out_audio[..., :head_audio_steps] = prev_audio[:1, ..., a0:a1].to(
                device=out_audio.device, dtype=out_audio.dtype
            )
            video_mask[:, :, :head_video_steps] = 0.0
            _apply_audio_context_feather(audio_mask, head_audio_steps, audio_feather_ticks)

            info_parts.append(
                f"head_lock={head_ctx}f (prev {sl['start_t']}:{sl['end_t']}v, {a0}:{a1}a)"
            )

        new_body_frames = frame_count - head_ctx - tail_ctx
        info_parts.append(f"new_body={new_body_frames}f ({new_body_frames / FPS:.3f}s)")

        out_latent = dict(target_latent)
        out_latent["samples"] = comfy.nested_tensor.NestedTensor((out_video, out_audio))
        out_latent["noise_mask"] = comfy.nested_tensor.NestedTensor((video_mask, audio_mask))

        synthetic_handover = _build_synthetic_tail_handover(
            frame_count, tail_ctx, next_clip_head_override=next_clip_head_override
        )
        info = " | ".join(info_parts)
        _LOG.info("h3_insert: %s", info)

        return (cond, out_latent, head_ctx, tail_ctx, synthetic_handover, info, picture_map)

    @staticmethod
    def _validate_geometry(src_video, src_audio, dst_video, dst_audio, label="source"):
        if int(src_video.shape[0]) != 1 or int(src_audio.shape[0]) != 1:
            raise ValueError(f"h3_insert: {label} currently supports batch size 1")
        if tuple(src_video.shape[1:2] + src_video.shape[3:]) != tuple(
            dst_video.shape[1:2] + dst_video.shape[3:]
        ):
            raise ValueError(
                f"h3_insert: {label} video geometry {tuple(src_video.shape)} does not match target {tuple(dst_video.shape)}"
            )
        if tuple(src_audio.shape[1:3]) != tuple(dst_audio.shape[1:3]):
            raise ValueError(
                f"h3_insert: {label} audio geometry {tuple(src_audio.shape)} does not match target {tuple(dst_audio.shape)}"
            )


NODE_CLASS_MAPPINGS = {
    "H3InfiniteInsertVideo": H3InfiniteInsertVideo,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "H3InfiniteInsertVideo": "H3 Infinite Insert Video",
}