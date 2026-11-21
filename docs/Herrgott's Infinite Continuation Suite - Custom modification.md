# Herrgott's H3 Infinite Continuation Suite — Custom Modifications

This document details the additions and patches made to **Herrgott's H3 Infinite Continuation Suite** (`v1.4.0`) to support generating **Lead-In** videos (blending seamlessly into the start of an existing video) and **Bridge** videos (inserting a seamless transition between two existing videos) using MiniMax H3's native Masked AV inpainting.

---

## 1. Why the Original Code Had to Be Changed

The stock Herrgott v1.4 suite is designed strictly for **forward-only continuation** (Clip 1 → Clip 2 → Clip 3). Supporting Lead-In and Bridge workflows exposed three technical limitations in the stock pipeline:

1. **No Tail-Anchored or Dual-Anchored Masking**
   * Stock `H3ContinuousContinueV14` only locks the **head** of a target latent to the tail of a preceding clip (`video_mask[:, :, :steps] = 0.0`).
   * Generating a Lead-In or Bridge clip requires locking the **tail** of the target latent to the opening of a following clip (`next_latent`), and in Bridge Mode, locking **both** the head and the tail simultaneously.

2. **Stale Pre-Head Crossfade Flash (Bridge → Continue Seams)**
   * When a following clip (`Clip C`) was originally generated in Continue mode from an earlier clip (`Clip A`), its first `head_context_frames` (e.g., frames `0–38`) contain `Clip A`'s ending—not the new bridge (`Clip B`).
   * Stock `H3ContinuousStitchSavedChainV11` and `H3ContinuousSeamlessJoinV11` reach backward into `Clip C`'s discarded head to perform a 4-frame video crossfade (and optional luminance match). On a Bridge → Continue seam, this pulls 4 stale frames from `Clip A` into the transition, causing a visible flash.

3. **Causal Video VAE Bleed at Non-Phase-0 Boundaries**
   * MiniMax H3's Video VAE is **causal** and decodes in 5-token / 17-frame groups (`1, 4, 4, 4, 4` pixel frames).
   * A standard `39`-frame head context ends at token `12` (**phase 2**), in the middle of a 17-frame VAE group. Cutting directly at frame `39` mismatches the causal VAE history between the Bridge and `Clip C`, causing a 2–3 frame darkening glitch and micro-jump.
   * To eliminate causal VAE bleed, the Bridge's tail lock must snap **forward** to the next clean **phase-0** boundary on `Clip C` (e.g., `22 → 34`, `39 → 51`, `90 → 102`), and the stitcher must trim `Clip C`'s head to that exact snapped frame instead of its original saved `head_context_frames`.

---

## 2. Summary of Changes

### A. New File: `insert_video.py`
Adds the **`H3InfiniteInsertVideo`** node (`"H3 Infinite Insert Video"`).

* **Dual-Mode Operation:**
  * **Lead-In Mode (`next_latent` only):** Locks the tail of the generated AV latent to the opening of `next_latent`. Supports an optional `first_frame` image.
  * **Bridge Mode (`previous_latent` + `next_latent`):** Locks the head to the freeze-safe handover of `previous_latent` and locks the tail to `next_latent` simultaneously (ignoring `first_frame` automatically).
* **Flexible Context Sizes:** Supports `22`, `39`, `90`, `141`, and `192` frames for both `head_context_frames` and `tail_context_frames`.
* **Phase-0 Forward Snapping:** Reads `next_latent.get("h3_head_context_frames", 0)` and snaps it forward to the next `17k`-frame / `5k`-token phase-0 boundary (`phase0_group = (next_head_offset + 16) // 17`). Slices `next_latent`'s video and 40 Hz audio from that clean boundary so zero causal VAE bleed or old-clip loopback occurs.
* **Synthetic Handover Output:** Outputs a v1.4-compatible `handover` dict directly (removing the need for `H3ContinuousAnalyzeHandoverV14` on Lead-In/Bridge clips) containing:
  * `"masked_av_stitch_policy": "insert_video_exact_tail_trim"`
  * `"landing_tail_frames": tail_ctx`
  * `"next_clip_head_override": snapped_start_frame`

---

### B. Modified File: `__init__.py`
Registers `H3InfiniteInsertVideo` with ComfyUI inside the existing `if __package__:` guard:

```python
if __package__:
    from .nodes import NODE_CLASS_MAPPINGS, NODE_DISPLAY_NAME_MAPPINGS
    from .insert_video import (
        NODE_CLASS_MAPPINGS as INSERT_NODE_CLASS_MAPPINGS,
        NODE_DISPLAY_NAME_MAPPINGS as INSERT_NODE_DISPLAY_NAME_MAPPINGS,
    )
    NODE_CLASS_MAPPINGS.update(INSERT_NODE_CLASS_MAPPINGS)
    NODE_DISPLAY_NAME_MAPPINGS.update(INSERT_NODE_DISPLAY_NAME_MAPPINGS)

C. Modified File: nodes.py

All edits in nodes.py are marked with # [CUSTOM PATCH: H3InfiniteInsertVideo] and live in the V11 base classes (which H3ContinuousSeamlessJoinV14 and H3ContinuousStitchSavedChainV14 inherit from).
1. H3ContinuousSeamlessJoinV11.join — Disable Stale Pre-Head Crossfade & Luminance Match

    What it does: Checks whether previous_handover has masked_av_stitch_policy == "insert_video_exact_tail_trim".

    Effect: Forces video_crossfade_frames = 0 and luminance_match = False at that specific seam so the joiner never pulls stale pre-head frames from the next clip. Audio de-click crossfade (15 ms) remains active.

2. H3ContinuousStitchSavedChainV11.stitch — Phase-0 Head Trim Override

    Location: Immediately after head, head_source = resolve_saved_head_context(metadata, clip_index, previous_handover).

    What it does: Checks if previous_handover has masked_av_stitch_policy == "insert_video_exact_tail_trim" and next_clip_head_override > 0.

    Effect: Overrides the current clip's head trim to next_clip_head_override (e.g., 51 instead of 39) and logs head_source = "insert_video_phase0_override". This aligns the stitched cut to the exact phase-0 frame the Bridge was generated to land on, without modifying the next clip's saved .safetensors file.

3. H3ContinuousStitchSavedChainV11.stitch — Disable Stale Pre-Head Crossfade & Luminance Match

    Location: Inside the else: (offset > 0) seam-joining block, right before luminance estimation and vn calculation.

    What it does: Checks is_insert_seam using masked_av_stitch_policy == "insert_video_exact_tail_trim".

    Effect: Forces seam_vfade = 0 and seam_luma_match = False for that seam only, preventing any 4-frame flash from the next clip's discarded head while keeping normal crossfades intact on all other seams in the chain.

3. Impact on Existing Workflows

None. Every modification in nodes.py is strictly gated on:
Python

str(previous_handover.get("masked_av_stitch_policy", "")) == "insert_video_exact_tail_trim"

This policy value is only produced by H3InfiniteInsertVideo. Standard Start and Continue chains bypass all three patches and execute identically to stock Herrgott v1.4.
4. External Wrapper Requirement

For Bridge Mode to detect a following clip's original head_context_frames automatically, the latent loader node (H3InfinityWrapper_ProjectLoadLatent in the separate wrapper suite) must read "head_context_frames" from the .safetensors metadata and attach it to the returned latent dict:
Python

latent["h3_head_context_frames"] = int(metadata.get("head_context_frames", 0))