H3InfinityWrapper_IngestVideo
A new standalone ComfyUI node H3InfinityWrapper_IngestVideo (H3 Wrapper - Ingest & Conform Video, in H3InfinityWrapper_ingest.py) is now registered in ComfyUI-H3InfinityWrapper. It conforms any external video to MiniMax H3 v1.4 specs (24 fps, center-crop with no black bars, max 30s, downward-trimmed to H3's 51k+39 or 17k+5 grid, stereo audio conformed or silence-padded) and encodes it into a native H3 AV NestedTensor latent.

1. Node Signature
Class / Node Type: H3InfinityWrapper_IngestVideo

OUTPUT_NODE = True (executes standalone without needing downstream save nodes)

Required Inputs:

Input	Type	Default / Constraints	Notes
video_path	STRING	""	Absolute path to source video file
video_vae	VAE	—	MiniMax H3 Video VAE
audio_vae	VAE	—	MiniMax H3 Audio VAE
width	INT	864 (step 32)	Target project width (center-cropped, never letterboxed)
height	INT	480 (step 32)	Target project height
start_seconds	FLOAT	0.0	Optional trim start offset
max_duration	FLOAT	30.0 (max 30.0)	Hard-capped at 30s for H3
grid_snap	ENUM	"Exact AV (51k+39)"	Options: "Exact AV (51k+39)", "Video Grid (17k+5)". Auto-falls back to 17k+5 if source < 39 frames
output_folder	STRING	"h3_ingested"	Absolute path, or relative to ComfyUI/output. Leave "" to skip disk export
filename	STRING	""	Base name without extension. Leave "" to reuse source filename
Outputs (by index):

0: latent (LATENT — NestedTensor((video, audio)), h3_head_context_frames = 0)

1: images (IMAGE)

2: audio (AUDIO)

3: handover (H3_CONTINUOUS_HANDOVER — clean v1.4 handover, landing_tail_frames = 0)

4: latent_path (STRING)

5: video_path (STRING)

6: json_path (STRING)

7: ingest_info (STRING)

2. Files Written to Disk (when output_folder is non-empty)
<output_folder>/<filename>.mp4 — 24 fps H.264 + AAC conformed preview video

<output_folder>/<filename>.safetensors — H3 h3_continuous_av_v8 latent with embedded handover_json and head_context_frames: "0" (directly loadable by H3InfinityWrapper_ProjectLoadLatent and H3ContinuousLoadLatent)

<output_folder>/<filename>_data.json — Metadata including original_filename, original_path, width, height, fps, frame_count, duration_seconds, trimmed_frames, snap_mode, has_source_audio, video_latent_shape, audio_latent_shape, and short_clip_audio_warning (bool, true if frame_count < 39).

3. Integration Patterns for the Agent
Option A — Standalone api_ingest.json (Recommended):

Load MiniMax H3 Video VAE + Audio VAE → wire into H3InfinityWrapper_IngestVideo.

Pass video_path, project width/height, output_folder, and filename via the API route.

File naming note: IngestVideo writes <filename>.mp4, <filename>.safetensors, and <filename>_data.json. If ingesting directly into a Project Manager Take_X folder that expects {prefix}preview.mp4, {prefix}latent.safetensors, and {prefix}take_data.json, either:

Rename/map the 3 files in the API route after execution, or

Set output_folder: "" on IngestVideo and wire its outputs into H3InfinityWrapper_ProjectTakeOutput (latent, handover, head_context_frames=0) and H3InfinityWrapper_SavePreviewVideo (images, audio).

Short-Clip Warning:

Check short_clip_audio_warning in <filename>_data.json (or frame_count < 39). If true, warn the user in the UI that continuing from this clip requires < 39 context frames (e.g., 22f), which introduces ~8.3 ms audio rounding at the seam.

Downstream Compatibility:

The saved .safetensors works directly with H3ContinuousContinueV14, H3InfiniteInsertVideo (Lead-In & Bridge), and H3InfinityWrapper_HybridStitcher.