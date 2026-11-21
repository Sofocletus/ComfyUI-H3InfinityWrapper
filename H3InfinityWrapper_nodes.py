import os
import json
import torch
import sys
from safetensors.torch import load_file as st_load, save_file as st_save
from safetensors import safe_open
import comfy.nested_tensor
import nodes
import folder_paths
import comfy.samplers
import comfy.sd
import comfy.utils
from PIL import Image, ImageOps
import numpy as np

def get_h3_funcs():
    h3_save_class = nodes.NODE_CLASS_MAPPINGS.get("H3ContinuousSaveLatent")
    if h3_save_class is None:
        raise RuntimeError("H3 Infinity Wrapper Error: Base Herrgott H3 nodes not found in ComfyUI!")
    
    h3_module = sys.modules[h3_save_class.__module__]
    return (
        getattr(h3_module, "_streams_from_latent"),
        getattr(h3_module, "pixel_frames")
    )

def get_strict_model_list(folder_name):
    paths = folder_paths.get_folder_paths(folder_name)
    if not paths:
        paths = [os.path.join(folder_paths.models_dir, folder_name)]
        
    valid_exts = {'.safetensors', '.pt', '.ckpt', '.gguf', '.bin'}
    results = []
    
    for base_path in paths:
        normalized_base = os.path.normpath(base_path)
        if os.path.basename(normalized_base).lower() != folder_name.lower():
            continue 
            
        if not os.path.exists(base_path):
            continue
            
        for root, dirs, files in os.walk(base_path):
            for file in files:
                if os.path.splitext(file)[1].lower() in valid_exts:
                    rel_path = os.path.relpath(os.path.join(root, file), base_path)
                    results.append(rel_path.replace("\\", "/"))
                    
    return sorted(list(set(results)))

# ==============================================================================
# UI NODES
# ==============================================================================

class H3InfinityWrapper_ProjectManager:
    """The master node that hosts the custom NLE Timeline Interface."""
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {},
            "hidden": {
                "unique_id": "UNIQUE_ID",
            }
        }
    RETURN_TYPES = ()
    FUNCTION = "do_nothing"
    CATEGORY = "H3 API Wrappers"

    def do_nothing(self, **kwargs):
        return ()

class H3InfinityWrapper_Controller:
    """The original Boilerplate Node - retained for development and raw testing."""
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "project_name": ("STRING", {"default": "My_First_Film"}),
                "mode": (["Start", "Continue", "Lead", "Bridge", "Stitch"], {"default": "Start"}),
                "shot_number": ("INT", {"default": 1, "min": 1, "max": 9999}),
                "take_number": ("INT", {"default": 1, "min": 1, "max": 9999}),
                "prompt": ("STRING", {"multiline": True, "default": "A cat walking on a street..."}),
                "width": ("INT", {"default": 864, "step": 32}),
                "height": ("INT", {"default": 480, "step": 32}),
                "duration": ("FLOAT", {"default": 5.0, "step": 0.1}),
                "seed": ("INT", {"default": 123456789}),
                "steps": ("INT", {"default": 12, "min": 1, "max": 100}),
                "scheduler": (comfy.samplers.SCHEDULER_NAMES, ),
                "sampler_name": (comfy.samplers.KSAMPLER_NAMES, ),
                "context_frames": ("INT", {"default": 39, "min": 0, "max": 100}),
                "unet_model": (get_strict_model_list("unet"), ),
                "diffusion_model": (get_strict_model_list("diffusion_models"), ),
                "active_1": ("BOOLEAN", {"default": True}),
                "lora_1": (get_strict_model_list("loras"), ),
                "lora_strength_1": ("FLOAT", {"default": 1.0, "step": 0.05}),
                "active_2": ("BOOLEAN", {"default": True}),
                "lora_2": (get_strict_model_list("loras"), ),
                "lora_strength_2": ("FLOAT", {"default": 1.0, "step": 0.05}),
                "first_frame_path": ("STRING", {"default": ""}),
                "last_frame_path": ("STRING", {"default": ""}),
            }
        }
    RETURN_TYPES = ()
    FUNCTION = "do_nothing"
    CATEGORY = "H3 API Wrappers"

    def do_nothing(self, **kwargs):
        return ()


# ==============================================================================
# PAYLOAD & LOGIC NODES
# ==============================================================================

class H3InfinityWrapper_SettingsPayload:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "steps": ("INT", {"default": 12, "min": 1, "max": 100}),
                "scheduler": (comfy.samplers.SCHEDULER_NAMES, ),
                "sampler_name": (comfy.samplers.KSAMPLER_NAMES, ),
                "context_frames": ("INT", {"default": 39, "min": 0, "max": 100}),
                "unet_model": (get_strict_model_list("unet"), ),
                "diffusion_model": (get_strict_model_list("diffusion_models"), ),
                "active_1": ("BOOLEAN", {"default": True}),
                "lora_1": (get_strict_model_list("loras"), ),
                "lora_strength_1": ("FLOAT", {"default": 1.0, "step": 0.05}),
                "active_2": ("BOOLEAN", {"default": True}),
                "lora_2": (get_strict_model_list("loras"), ),
                "lora_strength_2": ("FLOAT", {"default": 1.0, "step": 0.05}),
                "first_frame_path": ("STRING", {"default": ""}),
                "last_frame_path": ("STRING", {"default": ""}),
            },
            "optional": {
                "global_lora_active": ("BOOLEAN", {"default": False}),
                "global_lora": (get_strict_model_list("loras"), ),
                "global_lora_strength": ("FLOAT", {"default": 1.0, "min": -10.0, "max": 10.0, "step": 0.05}),
            }
        }
        
    RETURN_TYPES = ("INT", "*", "*", "*", "*", "*", "BOOLEAN", "*", "FLOAT", "BOOLEAN", "*", "FLOAT", "IMAGE", "IMAGE", "BOOLEAN", "*", "FLOAT")
    RETURN_NAMES = ("STEPS", "SCHEDULER", "SAMPLER_NAME", "CONTEXT_FRAMES", "UNET_MODEL", "DIFFUSION_MODEL", "ACTIVE_1", "LORA_1", "LORA_STRENGTH_1", "ACTIVE_2", "LORA_2", "LORA_STRENGTH_2", "FIRST_FRAME", "LAST_FRAME", "GLOBAL_LORA_ACTIVE", "GLOBAL_LORA", "GLOBAL_LORA_STRENGTH")
    FUNCTION = "dispatch"
    CATEGORY = "H3 API Wrappers"

    def load_image(self, path):
        if not path or not os.path.exists(path):
            return None
        try:
            i = Image.open(path)
            i = ImageOps.exif_transpose(i)
            image = i.convert("RGB")
            image = np.array(image).astype(np.float32) / 255.0
            image = torch.from_numpy(image)[None,]
            return image
        except Exception as e:
            print(f"H3 Wrapper Error loading image {path}: {e}")
            return None 

    def dispatch(self, steps, scheduler, sampler_name, context_frames, unet_model, diffusion_model, active_1, lora_1, lora_strength_1, active_2, lora_2, lora_strength_2, first_frame_path, last_frame_path, global_lora_active=False, global_lora="", global_lora_strength=1.0):
        img1 = self.load_image(first_frame_path)
        img2 = self.load_image(last_frame_path)
        return (steps, scheduler, sampler_name, context_frames, unet_model, diffusion_model, active_1, lora_1, lora_strength_1, active_2, lora_2, lora_strength_2, img1, img2, global_lora_active, global_lora, global_lora_strength)

class H3InfinityWrapper_ProjectPayload:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "prompt": ("STRING", {"multiline": True, "default": ""}),
                "width": ("INT", {"default": 864}),
                "height": ("INT", {"default": 480}),
                "duration": ("FLOAT", {"default": 5.0}),
                "seed": ("INT", {"default": 0}),
                "load_path": ("STRING", {"default": ""}),
                "take_dir": ("STRING", {"default": ""}),
                "stitch_paths_json": ("STRING", {"default": "[]"}),
                "stitch_mp4_path": ("STRING", {"default": ""}),
                "latent_prefix": ("STRING", {"default": ""}),
                "filename_prefix": ("STRING", {"default": ""}),
            },
            "optional": {
                "next_load_path": ("STRING", {"default": ""}),
            }
        }
        
    RETURN_TYPES = ("STRING", "INT", "INT", "FLOAT", "INT", "STRING", "STRING", "STRING", "STRING", "STRING", "STRING", "STRING", "STRING", "STRING")
    RETURN_NAMES = ("PROMPT", "WIDTH", "HEIGHT", "DURATION", "SEED", "LOAD_PATH", "TAKE_DIR", "LATENT_PATH", "PREVIEW_PATH", "STITCH_PATHS", "STITCH_MP4", "LATENT_PREFIX", "FILENAME_PREFIX", "NEXT_LOAD_PATH")
    FUNCTION = "dispatch"
    CATEGORY = "H3 API Wrappers"

    def dispatch(self, prompt, width, height, duration, seed, load_path, take_dir, stitch_paths_json, stitch_mp4_path, latent_prefix="", filename_prefix="", next_load_path=""):
        latent_path = ""
        preview_path = ""
        
        if take_dir:
            parts = os.path.normpath(take_dir).split(os.sep)
            if len(parts) >= 2 and parts[-1].startswith("Take_"):
                shot_folder = parts[-2]
                take_str = parts[-1].lower().replace("_", "")
                if shot_folder.startswith("Shot_"):
                    shot_str = shot_folder.lower().replace("_", "")
                else:
                    shot_str = shot_folder.lower()
                prefix = f"{shot_str}_{take_str}_"
            else:
                prefix = ""
                
            latent_path = os.path.join(take_dir, f"{prefix}latent.safetensors")
            preview_path = os.path.join(take_dir, f"{prefix}preview.mp4")
            
        return (prompt, width, height, duration, seed, load_path, take_dir, latent_path, preview_path, stitch_paths_json, stitch_mp4_path, latent_prefix, filename_prefix, next_load_path)

class H3InfinityWrapper_SwitchableLoRA:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "model": ("MODEL",),
                "active": ("BOOLEAN", {"default": True}),
                "lora_name": (get_strict_model_list("loras"), ),
                "strength_model": ("FLOAT", {"default": 1.0, "min": -10.0, "max": 10.0, "step": 0.01}),
            }
        }

    RETURN_TYPES = ("MODEL",)
    FUNCTION = "apply_lora"
    CATEGORY = "H3 API Wrappers"

    def apply_lora(self, model, active, lora_name, strength_model):
        if not active or strength_model == 0:
            print(f"[H3 Wrapper] Switchable LoRA bypassed (active={active}, strength={strength_model})")
            return (model,)

        lora_path = folder_paths.get_full_path("loras", lora_name)
        if lora_path is None:
            print(f"[H3 Wrapper Error] LoRA '{lora_name}' not found. Bypassing.")
            return (model,)

        print(f"[H3 Wrapper] Loading Switchable LoRA: {lora_name}")
        lora = comfy.utils.load_torch_file(lora_path, safe_load=True)
        model_lora, _ = comfy.sd.load_lora_for_models(model, None, lora, strength_model, 0)
        return (model_lora,)

class H3InfinityWrapper_ProjectLoadLatent:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"absolute_latent_path": ("STRING", {"default": ""})}}
    
    RETURN_TYPES = ("LATENT", "H3_CONTINUOUS_HANDOVER", "STRING")
    RETURN_NAMES = ("latent", "handover", "info")
    FUNCTION = "load"
    CATEGORY = "H3 API Wrappers"

    def load(self, absolute_latent_path):
        _, pixel_frames = get_h3_funcs()
        if not os.path.exists(absolute_latent_path):
            raise FileNotFoundError(f"Project Load failed: Path not found {absolute_latent_path}")
            
        tensors = st_load(absolute_latent_path, device="cpu")
        video, audio = tensors["video"], tensors["audio"]
        frame_count = pixel_frames(video.shape[2])

        metadata = {}
        with safe_open(absolute_latent_path, framework="pt", device="cpu") as f:
            metadata = f.metadata() or {}

        raw_head = metadata.get("head_context_frames", 0)
        try:
            head_context_frames = max(0, int(raw_head))
        except (TypeError, ValueError):
            head_context_frames = 0

        latent = {
            "samples": comfy.nested_tensor.NestedTensor((video, audio)),
            "h3_head_context_frames": head_context_frames,
        }

        handover = {"available": False, "frame_count": frame_count}
        if raw := metadata.get("handover_json"):
            parsed = json.loads(raw)
            parsed.update({"available": True, "frame_count": frame_count})
            handover = parsed

        info = f"Loaded {frame_count} frames from {os.path.basename(os.path.dirname(absolute_latent_path))}"
        return (latent, handover, info)

class H3InfinityWrapper_ProjectTakeOutput:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "latent_path": ("STRING", {"default": ""}),
                "latent": ("LATENT",),
                "prompt": ("STRING", {"default": ""}),
                "duration": ("FLOAT", {"default": 5.0}),
                "seed": ("INT", {"default": 0}),
            },
            "optional": {
                "handover": ("H3_CONTINUOUS_HANDOVER",),
                "head_context_frames": ("INT", {"default": 0}),
            }
        }
    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("latent_path",)
    FUNCTION = "save_latent_and_data"
    OUTPUT_NODE = True
    CATEGORY = "H3 API Wrappers"

    def save_latent_and_data(self, latent_path, latent, prompt, duration, seed, handover=None, head_context_frames=0):
        _streams_from_latent, pixel_frames = get_h3_funcs()
        
        take_dir = os.path.dirname(latent_path)
        os.makedirs(take_dir, exist_ok=True)
        
        base_name = os.path.basename(latent_path) 
        prefix = base_name.replace("latent.safetensors", "") 

        take_data_path = os.path.join(take_dir, f"{prefix}take_data.json")
        take_data = {}
        if os.path.exists(take_data_path):
            try:
                with open(take_data_path, "r") as f:
                    take_data = json.load(f)
            except Exception:
                take_data = {}

        take_data.update({
            "prompt": prompt,
            "duration": duration,
            "seed": seed,
            "head_context_frames": head_context_frames
        })
        with open(take_data_path, "w") as f:
            json.dump(take_data, f, indent=4)

        video, audio = _streams_from_latent(latent)
        video_cpu, audio_cpu = video.detach().cpu().contiguous(), audio.detach().cpu().contiguous()
        frame_count = pixel_frames(video_cpu.shape[2])
        
        metadata = {
            "format": "h3_continuous_av_v8",
            "frame_count": str(frame_count),
            "head_context_frames": str(max(0, int(head_context_frames))),
            "video_shape": json.dumps(list(video_cpu.shape)),
            "audio_shape": json.dumps(list(audio_cpu.shape)),
        }
        if isinstance(handover, dict) and handover.get("available"):
            clean = dict(handover)
            clean["frame_count"] = frame_count
            metadata["handover_json"] = json.dumps(clean, separators=(",", ":"), sort_keys=True)

        st_save({"video": video_cpu, "audio": audio_cpu}, latent_path, metadata=metadata)
        return (latent_path,)

class H3InfinityWrapper_SavePreviewVideo:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "preview_path": ("STRING", {"default": ""}),
                "images": ("IMAGE",),
                "fps": ("INT", {"default": 24}),
            },
            "optional": {
                "audio": ("AUDIO",),
            }
        }
    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("preview_path",)
    FUNCTION = "save_video"
    OUTPUT_NODE = True
    CATEGORY = "H3 API Wrappers"

    def save_video(self, preview_path, images, fps=24, audio=None):
        if not preview_path:
            return ("",)

        os.makedirs(os.path.dirname(preview_path), exist_ok=True)
        
        try:
            import av
            import numpy as np
            
            container = av.open(preview_path, mode='w')
            video_stream = container.add_stream('h264', rate=fps)
            video_stream.width = images.shape[2]
            video_stream.height = images.shape[1]
            video_stream.pix_fmt = 'yuv420p'
            
            frames = (images.cpu().numpy() * 255.0).clip(0, 255).astype(np.uint8)
            
            for i in range(frames.shape[0]):
                frame = av.VideoFrame.from_ndarray(frames[i], format='rgb24')
                for packet in video_stream.encode(frame):
                    container.mux(packet)
            for packet in video_stream.encode():
                container.mux(packet)
                
            container.close()
            print(f"H3 Wrapper: Saved preview.mp4 to {preview_path}")
            
        except Exception as e:
            print(f"H3 Wrapper Error saving preview video: {e}")

        return (preview_path,)


NODE_CLASS_MAPPINGS = {
    "H3InfinityWrapper_ProjectManager": H3InfinityWrapper_ProjectManager,
    "H3InfinityWrapper_Controller": H3InfinityWrapper_Controller,
    "H3InfinityWrapper_ProjectPayload": H3InfinityWrapper_ProjectPayload,
    "H3InfinityWrapper_SettingsPayload": H3InfinityWrapper_SettingsPayload,
    "H3InfinityWrapper_SwitchableLoRA": H3InfinityWrapper_SwitchableLoRA,
    "H3InfinityWrapper_ProjectLoadLatent": H3InfinityWrapper_ProjectLoadLatent,
    "H3InfinityWrapper_ProjectTakeOutput": H3InfinityWrapper_ProjectTakeOutput,
    "H3InfinityWrapper_SavePreviewVideo": H3InfinityWrapper_SavePreviewVideo,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "H3InfinityWrapper_ProjectManager": "H3 Wrapper - Project Manager (UI)",
    "H3InfinityWrapper_Controller": "H3 Wrapper - Boilerplate Controller",
    "H3InfinityWrapper_ProjectPayload": "H3 Wrapper - Project Payload API",
    "H3InfinityWrapper_SettingsPayload": "H3 Wrapper - Settings Payload API",
    "H3InfinityWrapper_SwitchableLoRA": "H3 Wrapper - Switchable LoRA (Model Only)",
    "H3InfinityWrapper_ProjectLoadLatent": "H3 Wrapper - Project Load Latent",
    "H3InfinityWrapper_ProjectTakeOutput": "H3 Wrapper - Unified Take Output",
    "H3InfinityWrapper_SavePreviewVideo": "H3 Wrapper - Save Preview Video",
}