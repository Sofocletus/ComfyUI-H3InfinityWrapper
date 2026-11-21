# ComfyUI-H3InfinityWrapper

A [ComfyUI](https://github.com/comfyanonymous/ComfyUI) custom node suite that wraps **[Herrgott's H3 Infinite Continuation Suite](https://github.com/MisterX014/herrgotts-h3-infinite-continuation-suite)** to unlock **Lead-In** and **Bridge** video generation workflows using MiniMax H3's native Masked AV inpainting.

## Features

### Core Wrapper Nodes
- **H3 Infinite Wrapper Start** — Generate the first clip in a continuation chain
- **H3 Infinite Wrapper Continue** — Chain clips together seamlessly (Clip 1 → Clip 2 → Clip 3…)
- **H3 Infinite Wrapper Stitch Saved Chain** — Stitch all saved clips into one continuous video
- **H3 Infinite Latent Combine** — Combine latents for batch processing

### Lead-In & Bridge Support *(Custom Extensions)*
- **Lead-In Mode** — Generate a video that blends seamlessly *into the start* of an existing video (reverse continuation)
- **Bridge Mode** — Insert a seamless transition *between two* existing videos
- **H3 Infinite Insert Video** node (`insert_video.py`) — Single-node interface for both Lead-In and Bridge workflows

### Advanced Fixes
- **Phase-0 Forward Snapping** — Aligns tail-lock to clean 17-frame / 5-token VAE boundaries, eliminating causal VAE bleed and micro-jump glitches
- **Stale Pre-Head Crossfade Fix** — Detects Bridge → Continue seams and disables stale pre-head crossfades & luminance matching that cause visible flashes
- **Synthetic Handover Output** — Generates v1.4-compatible handover dicts automatically, no extra nodes needed

## Installation

### Prerequisites
- [ComfyUI](https://github.com/comfyanonymous/ComfyUI) installed and running
- A MiniMax H3 API key or local GGUF model access (depends on your inference backend)

### Install the Wrapper

```bash
# Clone into your ComfyUI custom_nodes directory
cd ComfyUI/custom_nodes
git clone https://github.com/Sofocletus/ComfyUI-H3InfinityWrapper.git
cd ComfyUI-H3InfinityWrapper
```

### Apply Herrgott Suite Patches

The wrapper modifies two files in the original Herrgott suite (`__init__.py` and `nodes.py`) to support Lead-In/Bridge seam handling:

1. **Back up** your existing `__init__.py` and `nodes.py`:
   ```bash
   cd ComfyUI/custom_nodes/herrgotts-h3-infinite-continuation-suite
   cp __init__.py __init__.py.bak
   cp nodes.py nodes.py.bak
   ```

2. **Copy** the patched files from this repo:
   ```bash
   cd ComfyUI-H3InfinityWrapper/herrgotts-h3-infinite-continuation-suite
   cp __init__.py ../herrgotts-h3-infinite-continuation-suite/
   cp nodes.py ../herrgotts-h3-infinite-continuation-suite/
   cp insert_video.py ../herrgotts-h3-infinite-continuation-suite/
   ```

3. **Restart ComfyUI**

> ⚠️ **Important:** All modifications in `nodes.py` are gated on `masked_av_stitch_policy == "insert_video_exact_tail_trim"`. Standard Start and Continue chains bypass these patches entirely — they behave identically to stock Herrgott v1.4. Your backup is always safe to restore.

### Latent Loader Requirement (Bridge Mode)

For Bridge Mode to automatically detect a following clip's `head_context_frames`, your latent loader node must read `"head_context_frames"` from `.safetensors` metadata and attach it to the latent dict:
```python
latent["h3_head_context_frames"] = int(metadata.get("head_context_frames", 0))
```

The `H3InfinityWrapper_ProjectLoadLatent` node in this wrapper suite handles this automatically.

## Sample Workflows

Example workflow JSON files are provided in the [`workflows/`](workflows/) directory:

| Workflow | Description | Model Type |
|---|---|---|
| `api_start.json` | Start a new continuation chain | Default |
| `api_continue.json` | Continue from an existing clip | Default |
| `api_lead.json` | Generate a Lead-In clip before an existing video | Default |
| `api_bridge.json` | Insert a Bridge between two clips | Default |
| `api_stitch.json` | Stitch all clips into one video | Default |
| `*_GGUF.json` | Same workflows configured for local GGUF models | GGUF |
| `*_Safetensors.json` | Same workflows configured for Safetensor models | Safetensors |

Load any `.json` file directly in ComfyUI (drag-and-drop or use the Load workflow button).

## Custom Modifications

For a detailed technical explanation of all custom patches, see:
📄 [`docs/Herrgott's Infinite Continuation Suite - Custom modification.md`](docs/Herrgott%27s%20Infinite%20Continuation%20Suite%20-%20Custom%20modification.md)

Key changes include:
1. **New `insert_video.py`** — Adds the `H3InfiniteInsertVideo` node for Lead-In and Bridge operations
2. **Modified `__init__.py`** — Registers the new node with ComfyUI
3. **Modified `nodes.py`** — Three targeted patches in V11 base classes:
   - Disable stale pre-head crossfade at Bridge → Continue seams
   - Phase-0 head trim override for causal VAE alignment
   - Skip luminance matching on insert seams

## Directory Structure

```
ComfyUI-H3InfinityWrapper/
├── __init__.py                      # Main entry point, registers nodes & API routes
├── H3InfinityWrapper_api_routes.py  # Custom API endpoints for ComfyUI server
├── H3InfinityWrapper_nodes.py       # Core wrapper node definitions
├── H3InfinityWrapper_latentCombine.py # Latent combine utility node
├── web/                             # Frontend assets (JS, CSS) served to browser
│   ├── main.js                      # Entry point for frontend
│   ├── ExecutionEngine.js           # Workflow execution logic
│   ├── StateManager.js              # Application state management
│   ├── UI_*.js                     # Panel components
│   └── style.css                   # Styling
├── herrgotts-h3-infinite-continuation-suite/  # Patched Herrgott suite files to copy
│   ├── __init__.py                  # Modified entry point
│   ├── nodes.py                     # Modified node definitions (seam handling patches)
│   ├── insert_video.py              # New Insert Video node
│   └── README.txt                   # Instructions for applying patches
├── workflows/                       # Sample workflow JSON files
├── docs/                            # Technical documentation
└── README.md                        # This file
```

## Credits

- **[Herrgott's H3 Infinite Continuation Suite](https://github.com/MisterX014/herrgotts-h3-infinite-continuation-suite)** by [MisterX014](https://github.com/MisterX014) — The foundation this wrapper builds upon
- **[ComfyUI](https://github.com/comfyanonymous/ComfyUI)** by [comfyanonymous](https://github.com/comfyanonymous) — The visual node-based UI for Stable Diffusion

## License

This project is licensed under the **MIT License**. See [`LICENSE`](LICENSE) for details.

The modified `herrgotts-h3-infinite-continuation-suite/` files incorporate code from Herrgott's H3 Infinite Continuation Suite and are provided as patches to be applied to an existing installation.