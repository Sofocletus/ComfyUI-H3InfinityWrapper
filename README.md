# ComfyUI-H3InfinityWrapper

A [ComfyUI](https://github.com/comfyanonymous/ComfyUI) custom node suite that wraps **[Herrgott's H3 Infinite Continuation Suite](https://github.com/MisterX014/herrgotts-h3-infinite-continuation-suite)** to unlock **Lead-In** and **Bridge** video generation workflows using MiniMax H3's native Masked AV inpainting.

## Features

### Core Wrapper Nodes
- **H3 Infinite Wrapper Start** — Generate the first clip in a continuation chain
- **H3 Infinite Wrapper Continue** — Chain clips together seamlessly (Clip 1 → Clip 2 → Clip 3…)
- **H3 Infinite Wrapper Stitch Saved Chain** — Stitch all saved clips into one continuous video

### Initial setup
    Type or paste a folder path into the Project text input at the top-center of the Project Manager, all files will be stored in that folder, the node will store all the parameters so opening a project folder again will restore the shots, takes and all project settings.

### Use guideline
- Select the workflow you want to use, workflows are stored in custom_nodes/ComfyUI-H3InfiniteWrapper/, the Project Manager uses 5 workflows, api_bridge, api_continue, api_lead, api_start and api_stitch.
    The node reads the prefix of each workflow and dynamically loads and executes the correct workflow depending on the generation mode, the workflows without a prefix appear as the "Default" workflow.
    If you want to create your own workflow you must create a version of each of the four types (bridge, continue, lead and start) and give each one the same prefix in the form of "_customName", for example api_bridge_example, api_continue_example, api_lead_example, api_start_example; it will appear as "Example" in the workflows list.
    When you save your own workflows use the File>Export(API) method.
- Select the Minimax model you want to use, note that the API workflow  H3 Wrapper - Settings Payload API has outputs for UNET_MODEL and DIFFUSION_MODEL, use the first one with a GGUF model loader and the second for safetensors models, the Project Manager will then only show you one or the other according to the API workflow's choice. *Do not mix GGUF and safetensors models in the workflows*.
- Select Sampler, Scheduler, steps, the video size and Global LoRA if you want to use it (it applies to all shots when generating), don't change this settings between shots.
- You can set a Global Prompt that will remain active for every shot you generate, you can change it for different shots.
- On the right panel you can type your prompt, add start/end images being mindful that different generation modes use either a star, end, and start and end images. A first image in a Continue shot will (should?) be ignored when generation.
- You get two LoRAs that you can apply independently in every shot.
- Set the frame length, keep in mind the shot will be shorter than this because of the context frames at the start, end, or both ends of the shot.
- You can create multiple shots and generate them all in one go if you check "All in Timeline".
- Create a starting shot, use the "< New Shot" or "New Shot >" buttons to add another shot before or after. When generating you will see a live preview as it generates.
- After a the generation is finished you can play the video in the timeline, you'll see a new Take in the bottom gallery and a tree graph at the bottom right, you can create multiple takes of the same shot, the branching graph will show you how they connect through the different timelines. It's AI video creation meets Choose Your Own Adventure situation.
- You can Ctrl + Right click to enable/disable takes to build the branch you want to stitch, you can stitch multiple branches at the same time with the "All Branches" option enabled.
- All files are saved in the project folder, you will see folders with a date and time folder name, each one is a Shot as shown in the Project Manager, inside each Shot folder you can find the individual Take folders, containing a video preview, the AV latent and a take_data.json.
- Stitched branches are saved in the project's root folder.

### Generation modes supported
    The Project Manager will automatically select the generation mode according to the position of the shot you create or re-generate.
- First shot in a sequence will use **Start Mode**.
- Creating a new shot after another uses the **Continue Mode**.
- Creating or re-generating a shot before the starting shot activates the **Lead-In Mode**, it generates a video that blends seamlessly *into the start* of the next video.
- If you create or re-generate a shot between two existing shots the **Bridge Mode** is used, it inserts a seamless transition *between two* existing videos



## Installation

### Prerequisites
- [ComfyUI](https://github.com/comfyanonymous/ComfyUI) installed and running
- KJNodes (https://github.com/kijai/ComfyUI-KJNodes/tree/main) for the live preview when generating, using the taeh3.safetensors model (https://huggingface.co/Kijai/MiniMax-H3-TAE/tree/main/vae_approx)
- ComfyUI-Spectrum-MiniMax-H3 (https://github.com/xmarre/ComfyUI-Spectrum-MiniMax-H3) is used by the example API workflows.
- The API workflows in custom_nodes\ComfyUI-H3InfinityWrapper\workflows may contain other custom nodes that need to be installed, verify that those workflows have no errors before using the Project Manager.

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