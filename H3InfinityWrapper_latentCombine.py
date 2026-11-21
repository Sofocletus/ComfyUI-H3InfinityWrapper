"""Combine separate MiniMax H3 Video and Audio latents into a Nested AV Latent."""

import torch
import comfy.nested_tensor

FRAME_PER_TOKEN = (1, 4, 4, 4, 4)
FPS = 24.0
AUDIO_HZ = 40.0


def _pixel_frames(latent_t: int) -> int:
    return sum(FRAME_PER_TOKEN[k % 5] for k in range(int(latent_t)))


class H3InfinityWrapper_LatentCombine:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "video_latent": ("LATENT", {
                    "tooltip": "Video latent encoded with minimax_h3_video_vae_fp16 (shape [B, 24, T, H/16, W/16]).",
                }),
            },
            "optional": {
                "audio_latent": ("LATENT", {
                    "tooltip": "Optional audio latent encoded with minimax_h3_audio_vae_fp32 (shape [B, 32, 2, T_a]). If omitted, a silent audio latent matching the video duration is created.",
                }),
            },
        }

    RETURN_TYPES = ("LATENT", "INT", "INT", "INT")
    RETURN_NAMES = ("av_latent", "frame_count", "video_steps", "audio_steps")
    FUNCTION = "combine"
    CATEGORY = "Herrgotts H3 Infinite Continuation Suite"
    DESCRIPTION = (
        "Packs a standard VAEEncode video latent and optional VAEEncodeAudio audio latent "
        "into a MiniMax H3 Nested AV Latent compatible with H3 Infinite Insert Video and Continue nodes."
    )

    def combine(self, video_latent, audio_latent=None):
        if not isinstance(video_latent, dict) or "samples" not in video_latent:
            raise ValueError("H3InfinityWrapper_LatentCombine: expected a LATENT dict with 'samples'")

        v = video_latent["samples"]
        if hasattr(v, "unbind"):
            v = v.unbind()[0]
        if v.ndim == 4:
            v = v.unsqueeze(0)
        if v.ndim != 5:
            raise ValueError(f"H3InfinityWrapper_LatentCombine: expected 5D video latent, got {tuple(v.shape)}")

        batch_size = int(v.shape[0])
        vt = int(v.shape[2])
        frame_count = _pixel_frames(vt)
        expected_at = round((frame_count / FPS) * AUDIO_HZ)

        if audio_latent is not None:
            if not isinstance(audio_latent, dict) or "samples" not in audio_latent:
                raise ValueError("H3InfinityWrapper_LatentCombine: audio_latent must be a LATENT dict with 'samples'")
            a = audio_latent["samples"]
            if hasattr(a, "unbind"):
                parts = a.unbind()
                a = parts[1] if len(parts) > 1 else parts[0]
            if a.ndim == 3:
                a = a.unsqueeze(0)
            if a.ndim != 4:
                raise ValueError(f"H3InfinityWrapper_LatentCombine: expected 4D audio latent, got {tuple(a.shape)}")
            a = a.to(device=v.device, dtype=v.dtype)

            # Align audio ticks to exact video duration (trim or zero-pad if off by rounding).
            cur_at = int(a.shape[-1])
            if cur_at > expected_at:
                a = a[..., :expected_at]
            elif cur_at < expected_at:
                pad = torch.zeros(
                    (a.shape[0], a.shape[1], a.shape[2], expected_at - cur_at),
                    device=a.device,
                    dtype=a.dtype,
                )
                a = torch.cat((a, pad), dim=-1)
        else:
            a = torch.zeros(
                (batch_size, 32, 2, expected_at),
                device=v.device,
                dtype=v.dtype,
            )

        out = {"samples": comfy.nested_tensor.NestedTensor((v.contiguous(), a.contiguous()))}
        return (out, frame_count, vt, int(a.shape[-1]))


NODE_CLASS_MAPPINGS = {
    "H3InfinityWrapper_LatentCombine": H3InfinityWrapper_LatentCombine,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "H3InfinityWrapper_LatentCombine": "H3 Wrapper - Combine AV Latent",
}