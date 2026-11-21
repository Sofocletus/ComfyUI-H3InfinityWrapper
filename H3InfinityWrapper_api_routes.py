from aiohttp import web
import json
import os
import re
import shutil
import traceback
import asyncio
import folder_paths
import comfy.samplers
import base64

from .H3InfinityWrapper_nodes import get_strict_model_list

# --- GLOBALS & CONSTANTS ---
NODE_ROOT = os.path.dirname(__file__)
UI_STATE_PATH = os.path.join(NODE_ROOT, "ui_state.json")
PROJECTS_ROOT = os.path.join(folder_paths.get_output_directory(), "H3_Projects")
COMFY_OUTPUT_DIR = folder_paths.get_output_directory()
TEMPLATES_ROOT = os.path.join(NODE_ROOT, "workflows")

TEMP_STITCH_REL = "_tempStitch"
TEMP_STITCHED_REL = "_tempStitched"
TEMP_STITCH_ABS = os.path.join(COMFY_OUTPUT_DIR, TEMP_STITCH_REL)
TEMP_STITCHED_ABS = os.path.join(COMFY_OUTPUT_DIR, TEMP_STITCHED_REL)

VALID_INSERT_CONTEXTS = [22, 39, 90, 141, 192]
PROJECT_LOCKS = {}

def resolve_project_path(raw_project):
    raw_project = str(raw_project).strip()
    if not raw_project:
        raw_project = "DefaultProject"
        
    if os.path.isabs(raw_project) or (len(raw_project) > 1 and raw_project[1] == ":"):
        project_dir = os.path.normpath(raw_project)
        project_name = os.path.basename(project_dir)
    else:
        project_name = os.path.basename(raw_project.replace("\\", "/").rstrip("/"))
        project_dir = os.path.join(PROJECTS_ROOT, project_name)
        
    return project_name, project_dir

def safe_get_model(value, folder_name):
    val = str(value).strip() if value is not None else ""
    lst = get_strict_model_list(folder_name)
    if not val or val == "None" or (lst and val not in lst):
        return lst[0] if lst else ""
    return val

def make_shot_prefix(shot_id, take_num):
    """Build file prefix for both legacy Shot_001 and timestamp 261120_17145 IDs."""
    s_id = str(shot_id or "").strip()
    if s_id.startswith("Shot_"):
        shot_str = s_id.lower().replace("_", "")
    else:
        shot_str = s_id.lower()
    return f"{shot_str}_take{int(take_num):03d}_"

def resolve_latent_path(project_dir, shot_id, take_num):
    """Locate the .safetensors latent for (shot_id, take_num) on disk."""
    if not shot_id or take_num is None:
        return ""
    take_dir = os.path.join(project_dir, str(shot_id), f"Take_{int(take_num):03d}")
    if not os.path.isdir(take_dir):
        return ""
    expected = os.path.join(take_dir, f"{make_shot_prefix(shot_id, take_num)}latent.safetensors")
    if os.path.exists(expected):
        return expected
    for fname in os.listdir(take_dir):
        if fname.lower().endswith(".safetensors"):
            return os.path.join(take_dir, fname)
    return ""

def snap_insert_context_frames(val):
    """Snap context_frames to H3InfiniteInsertVideo's valid dropdown values."""
    try:
        n = int(val)
    except (TypeError, ValueError):
        return "39"
    closest = min(VALID_INSERT_CONTEXTS, key=lambda x: abs(x - n))
    return str(closest)

def inject_settings_payload(node, data):
    """Populate a H3InfinityWrapper_SettingsPayload node from request data."""
    inputs = node["inputs"]
    inputs["steps"] = int(data.get("steps", 12))
    inputs["scheduler"] = str(data.get("scheduler", "normal"))
    inputs["sampler_name"] = str(data.get("sampler_name", "euler"))
    inputs["context_frames"] = int(data.get("context_frames", 39))
    inputs["first_frame_path"] = str(data.get("first_frame_path", "")).strip()
    inputs["last_frame_path"] = str(data.get("last_frame_path", "")).strip()

    inputs["unet_model"] = safe_get_model(data.get("unet_model"), "unet")
    inputs["diffusion_model"] = safe_get_model(data.get("diffusion_model"), "diffusion_models")

    inputs["active_1"] = bool(data.get("active_1", False)) and data.get("lora_1") not in (None, "", "None")
    inputs["lora_1"] = safe_get_model(data.get("lora_1"), "loras")
    inputs["lora_strength_1"] = float(data.get("lora_strength_1", 0.0))

    inputs["active_2"] = bool(data.get("active_2", False)) and data.get("lora_2") not in (None, "", "None")
    inputs["lora_2"] = safe_get_model(data.get("lora_2"), "loras")
    inputs["lora_strength_2"] = float(data.get("lora_strength_2", 0.0))

    inputs["global_lora_active"] = bool(data.get("global_lora_active", False)) and data.get("global_lora") not in (None, "", "None")
    inputs["global_lora"] = safe_get_model(data.get("global_lora"), "loras")
    inputs["global_lora_strength"] = float(data.get("global_lora_strength", 1.0))

def detect_workflow_model_type(workflow_path):
    """Inspect SettingsPayload links: slot 4 = UNET_MODEL, slot 5 = DIFFUSION_MODEL."""
    try:
        with open(workflow_path, "r") as f:
            wf = json.load(f)
        settings_ids = {
            str(nid) for nid, node in wf.items()
            if isinstance(node, dict) and node.get("class_type") == "H3InfinityWrapper_SettingsPayload"
        }
        if not settings_ids:
            return "diffusion"

        uses_unet = False
        uses_diff = False
        for node in wf.values():
            if not isinstance(node, dict):
                continue
            for val in (node.get("inputs") or {}).values():
                if isinstance(val, list) and len(val) >= 2 and str(val[0]) in settings_ids:
                    if val[1] == 4:
                        uses_unet = True
                    elif val[1] == 5:
                        uses_diff = True

        if uses_unet and not uses_diff:
            return "unet"
        if uses_diff and not uses_unet:
            return "diffusion"
        return "unet" if uses_unet else "diffusion"
    except Exception:
        return "diffusion"

def discover_workflows():
    """Find paired start/continue workflows and optional lead/bridge companions."""
    if not os.path.isdir(TEMPLATES_ROOT):
        return []

    files = set(os.listdir(TEMPLATES_ROOT))
    workflows = []
    seen = set()

    if "api_start.json" in files and "api_continue.json" in files:
        workflows.append({
            "name": "Default",
            "model_type": detect_workflow_model_type(os.path.join(TEMPLATES_ROOT, "api_start.json")),
            "has_lead": "api_lead.json" in files or "api_lead_default.json" in files,
            "has_bridge": "api_bridge.json" in files or "api_bridge_default.json" in files,
        })
        seen.add("default")

    for fname in sorted(files):
        m = re.match(r"^api_start_(.+)\.json$", fname)
        if not m:
            continue
        suffix = m.group(1)
        if f"api_continue_{suffix}.json" not in files:
            continue
        display_name = "Default" if suffix.lower() == "default" else suffix
        if display_name.lower() in seen:
            continue
        seen.add(display_name.lower())
        workflows.append({
            "name": display_name,
            "model_type": detect_workflow_model_type(os.path.join(TEMPLATES_ROOT, fname)),
            "has_lead": f"api_lead_{suffix}.json" in files or (display_name == "Default" and "api_lead.json" in files),
            "has_bridge": f"api_bridge_{suffix}.json" in files or (display_name == "Default" and "api_bridge.json" in files),
        })

    return workflows

def resolve_workflow_template(mode, workflow_name):
    mode_lower = mode.lower()
    if mode_lower == "stitch":
        return os.path.join(TEMPLATES_ROOT, "api_stitch.json")

    wf_name = str(workflow_name or "Default").strip()
    if wf_name.lower() == "default":
        plain = os.path.join(TEMPLATES_ROOT, f"api_{mode_lower}.json")
        if os.path.exists(plain):
            return plain
        suffixed = os.path.join(TEMPLATES_ROOT, f"api_{mode_lower}_default.json")
        if os.path.exists(suffixed):
            return suffixed
        return plain

    return os.path.join(TEMPLATES_ROOT, f"api_{mode_lower}_{wf_name}.json")

def get_next_stitched_path(project_dir, project_name, branch_index):
    """Return a non-overwriting versioned path: {project}_v001_branch01.mp4"""
    os.makedirs(project_dir, exist_ok=True)
    branch_tag = f"branch{int(branch_index):02d}"
    pattern = re.compile(
        rf"^{re.escape(project_name)}_v(\d+)_{re.escape(branch_tag)}\.mp4$",
        re.IGNORECASE
    )
    max_ver = 0
    for fname in os.listdir(project_dir):
        m = pattern.match(fname)
        if m:
            max_ver = max(max_ver, int(m.group(1)))
    next_ver = max_ver + 1
    filename = f"{project_name}_v{next_ver:03d}_{branch_tag}.mp4"
    return os.path.join(project_dir, filename).replace("\\", "/")

def sync_disk_takes_into_state(project_dir, state):
    """Scan shot folders on disk (timestamp IDs or legacy Shot_XXX) so previews & take_data.json stay linked."""
    if not os.path.exists(project_dir):
        return state

    ledger_path = os.path.join(project_dir, "project_data.json")
    approved_ledger = {}
    if os.path.exists(ledger_path):
        try:
            with open(ledger_path, "r") as f:
                approved_ledger = json.load(f).get("approved_takes", {})
        except Exception:
            pass

    ref_dir = os.path.join(project_dir, "referenceImages")
    shots = state.get("shots", [])
    for idx, shot in enumerate(shots):
        shot_num = idx + 1
        shot_id = shot.get("id") or f"Shot_{shot_num:03d}"
        shot_dir = os.path.join(project_dir, shot_id)
        if not os.path.isdir(shot_dir):
            continue

        existing_by_num = {t.get("take_num"): t for t in (shot.get("takes") or []) if isinstance(t, dict)}
        discovered_takes = []

        for entry in sorted(os.listdir(shot_dir)):
            m = re.match(r"^Take_(\d+)$", entry)
            if not m:
                continue
            take_num = int(m.group(1))
            take_dir = os.path.join(shot_dir, entry)
            if not os.path.isdir(take_dir):
                continue

            mp4_files = [f for f in os.listdir(take_dir) if f.lower().endswith(".mp4")]
            if not mp4_files:
                continue

            preview_path = os.path.join(take_dir, mp4_files[0]).replace("\\", "/")
            take_obj = existing_by_num.get(take_num, {"take_num": take_num})
            take_obj["take_num"] = take_num
            take_obj["preview_path"] = preview_path

            prefix = make_shot_prefix(shot_id, take_num)
            take_data_path = os.path.join(take_dir, f"{prefix}take_data.json")
            if not os.path.exists(take_data_path):
                json_files = [f for f in os.listdir(take_dir) if f.lower().endswith("take_data.json")]
                if json_files:
                    take_data_path = os.path.join(take_dir, json_files[0])

            if os.path.exists(take_data_path):
                try:
                    with open(take_data_path, "r") as f:
                        td = json.load(f)
                    if "prompt" not in take_obj or not take_obj["prompt"]:
                        saved_prompt = td.get("shot_prompt") if "shot_prompt" in td else td.get("prompt", "")
                        take_obj["prompt"] = saved_prompt or ""
                    if "seed" not in take_obj and "seed" in td:
                        take_obj["seed"] = td["seed"]
                    if "mode" not in take_obj and "mode" in td:
                        take_obj["mode"] = td["mode"]
                    if "lora_1" in td and isinstance(td["lora_1"], dict):
                        take_obj.setdefault("active_1", True)
                        take_obj.setdefault("lora_1", td["lora_1"].get("name", "None"))
                        take_obj.setdefault("lora_strength_1", td["lora_1"].get("strength", 0))
                    if "lora_2" in td and isinstance(td["lora_2"], dict):
                        take_obj.setdefault("active_2", True)
                        take_obj.setdefault("lora_2", td["lora_2"].get("name", "None"))
                        take_obj.setdefault("lora_strength_2", td["lora_2"].get("strength", 0))
                    if "first_frame" in td and td["first_frame"] and "first_frame" not in take_obj:
                        cand = os.path.join(ref_dir, td["first_frame"]).replace("\\", "/")
                        if os.path.exists(cand):
                            take_obj["first_frame"] = cand
                    if "last_frame" in td and td["last_frame"] and "last_frame" not in take_obj:
                        cand = os.path.join(ref_dir, td["last_frame"]).replace("\\", "/")
                        if os.path.exists(cand):
                            take_obj["last_frame"] = cand
                except Exception:
                    pass

            discovered_takes.append(take_obj)

        if discovered_takes:
            shot["takes"] = sorted(discovered_takes, key=lambda x: x["take_num"])
            ledger_take = approved_ledger.get(shot_id) or approved_ledger.get(str(shot_num))
            if ledger_take is not None:
                shot["approved_take"] = int(ledger_take)
            elif shot.get("approved_take") is None:
                shot["approved_take"] = shot["takes"][0]["take_num"]

    return state

def setup_routes(prompt_server):

    @prompt_server.routes.get("/h3_wrapper/get_options")
    async def get_options(request):
        try:
            return web.json_response({
                "status": "success",
                "workflows": discover_workflows(),
                "unet_models": get_strict_model_list("unet"),
                "diffusion_models": get_strict_model_list("diffusion_models"),
                "loras": get_strict_model_list("loras"),
                "samplers": list(comfy.samplers.KSAMPLER_NAMES),
                "schedulers": list(comfy.samplers.SCHEDULER_NAMES),
            })
        except Exception as e:
            traceback.print_exc()
            return web.json_response({"error": str(e)}, status=500)

    @prompt_server.routes.get("/h3_wrapper/ui_state")
    async def get_ui_state(request):
        try:
            if os.path.exists(UI_STATE_PATH):
                with open(UI_STATE_PATH, "r") as f:
                    data = json.load(f)
                return web.json_response({"status": "success", "ui_state": data})
            return web.json_response({"status": "not_found", "ui_state": {}})
        except Exception as e:
            traceback.print_exc()
            return web.json_response({"error": str(e)}, status=500)

    @prompt_server.routes.post("/h3_wrapper/ui_state")
    async def save_ui_state(request):
        try:
            data = await request.json()
            with open(UI_STATE_PATH, "w") as f:
                json.dump(data, f, indent=4)
            return web.json_response({"status": "success"})
        except Exception as e:
            traceback.print_exc()
            return web.json_response({"error": str(e)}, status=500)

    @prompt_server.routes.get("/h3_wrapper/view_media")
    async def view_media(request):
        path = request.query.get("path")
        if not path or not os.path.exists(path):
            return web.Response(status=404, text="File not found")
        return web.FileResponse(path)

    @prompt_server.routes.post("/h3_wrapper/upload_image")
    async def upload_image(request):
        try:
            data = await request.json()
            project_name, project_dir = resolve_project_path(data.get("project_name", "DefaultProject"))
            filename = data.get("filename", "image.png")
            b64_data = data.get("image_data", "")

            if "," in b64_data:
                b64_data = b64_data.split(",")[1]

            ref_dir = os.path.join(project_dir, "referenceImages")
            os.makedirs(ref_dir, exist_ok=True)
            
            base, ext = os.path.splitext(filename)
            file_path = os.path.join(ref_dir, filename)
            counter = 1
            while os.path.exists(file_path):
                file_path = os.path.join(ref_dir, f"{base}_{counter}{ext}")
                counter += 1

            with open(file_path, "wb") as f:
                f.write(base64.b64decode(b64_data))

            return web.json_response({"status": "success", "file_path": file_path.replace("\\", "/")})
        except Exception as e:
            traceback.print_exc()
            return web.json_response({"error": str(e)}, status=500)

    @prompt_server.routes.post("/h3_wrapper/save_state")
    async def save_state(request):
        try:
            data = await request.json()
            project_name, project_dir = resolve_project_path(data.get("project_name", "DefaultProject"))
            state = data.get("state", {})
            
            os.makedirs(project_dir, exist_ok=True)
            state_path = os.path.join(project_dir, "project_state.json")
            with open(state_path, "w") as f:
                json.dump(state, f, indent=4)
                
            return web.json_response({"status": "success"})
        except Exception as e:
            traceback.print_exc()
            return web.json_response({"error": str(e)}, status=500)

    @prompt_server.routes.get("/h3_wrapper/load_state")
    async def load_state(request):
        try:
            project_name = request.query.get("project_name", "DefaultProject")
            _, project_dir = resolve_project_path(project_name)
            
            state_path = os.path.join(project_dir, "project_state.json")
            if os.path.exists(state_path):
                with open(state_path, "r") as f:
                    state = json.load(f)
                state = sync_disk_takes_into_state(project_dir, state)
                return web.json_response({"status": "success", "state": state})
            else:
                return web.json_response({"status": "not_found", "state": {}})
        except Exception as e:
            traceback.print_exc()
            return web.json_response({"error": str(e)}, status=500)

    @prompt_server.routes.get("/h3_wrapper/list_projects")
    async def list_projects(request):
        try:
            os.makedirs(PROJECTS_ROOT, exist_ok=True)
            projects = [d for d in os.listdir(PROJECTS_ROOT) if os.path.isdir(os.path.join(PROJECTS_ROOT, d))]
            projects = [p for p in projects if not p.startswith("_")]
            return web.json_response({"status": "success", "projects": projects})
        except Exception as e:
            traceback.print_exc()
            return web.json_response({"error": str(e)}, status=500)

    @prompt_server.routes.post("/h3_wrapper/approve_take")
    async def approve_take(request):
        try:
            data = await request.json()
            raw_project = data.get("project_name", "DefaultProject")
            project, project_dir = resolve_project_path(raw_project)
                
            shot_key = str(data.get("shot_id") or data.get("shot_number"))
            take_num = str(data.get("take_number"))
            
            os.makedirs(project_dir, exist_ok=True)
            ledger_path = os.path.join(project_dir, "project_data.json")
            
            lock = PROJECT_LOCKS.setdefault(project, asyncio.Lock())
            
            async with lock:
                ledger = {"approved_takes": {}}
                if os.path.exists(ledger_path):
                    with open(ledger_path, "r") as f:
                        ledger = json.load(f)
                        
                ledger["approved_takes"][shot_key] = take_num
                if data.get("shot_number") is not None:
                    ledger["approved_takes"][str(data.get("shot_number"))] = take_num
                with open(ledger_path, "w") as f:
                    json.dump(ledger, f, indent=4)
                
            return web.json_response({"status": "success", "message": f"Approved Take {take_num}"})
        except Exception as e:
            traceback.print_exc()
            return web.json_response({"error": str(e)}, status=500)

    @prompt_server.routes.post("/h3_wrapper/finalize_video")
    async def finalize_video(request):
        try:
            data = await request.json()
            dest_mp4 = data.get("dest_mp4")
            
            if not dest_mp4:
                return web.json_response({"error": "Missing dest_mp4 path"}, status=400)
                
            files = [f for f in os.listdir(TEMP_STITCHED_ABS) if f.endswith(".mp4") and not f.endswith(".locked")]
            if not files:
                return web.json_response({"error": f"No MP4 found in {TEMP_STITCHED_REL}"}, status=404)
                
            src = os.path.join(TEMP_STITCHED_ABS, files[0])
            os.makedirs(os.path.dirname(dest_mp4), exist_ok=True)
            
            move_success = False
            try:
                shutil.move(src, dest_mp4)
                print(f"\n[H3 Wrapper] -> SUCCESS! Fetched and moved final video to:\n    {dest_mp4}\n")
                move_success = True
            except Exception as e:
                print(f"[H3 Wrapper Error] -> Failed to move {src} to {dest_mp4}: {e}")
            
            if move_success and os.path.exists(TEMP_STITCH_ABS):
                for f in os.listdir(TEMP_STITCH_ABS):
                    if f.endswith(".safetensors"):
                        try:
                            os.remove(os.path.join(TEMP_STITCH_ABS, f))
                        except Exception as e:
                            print(f"[H3 Wrapper Warning] -> Could not delete {f}: {e}")
                print("[H3 Wrapper] -> Staged files cleared from disk.")
            
            return web.json_response({"status": "success", "message": f"Moved to {dest_mp4}"})
        except Exception as e:
            traceback.print_exc()
            return web.json_response({"error": str(e)}, status=500)

    @prompt_server.routes.post("/h3_wrapper/test_execute")
    async def test_execute(request):
        try:
            data = await request.json()
            raw_project = data.get("project_name", "DefaultProject")
            project, project_dir = resolve_project_path(raw_project)

            mode = data.get("mode", "Start")
            workflow_name = data.get("workflow_name", "Default")
            shot = int(data.get("shot_number", 1))
            shot_id = str(data.get("shot_id") or f"Shot_{shot:03d}").strip()
            take = int(data.get("take_number", 1))

            template_path = resolve_workflow_template(mode, workflow_name)
            if not os.path.exists(template_path):
                return web.json_response({"error": f"Template {os.path.basename(template_path)} not found"}, status=400)
                
            with open(template_path, "r") as f:
                workflow = json.load(f)
            
            load_path = ""
            next_load_path = ""
            absolute_preview_path = ""
                
            if mode in ("Start", "Continue", "Lead", "Bridge"):
                take_dir = os.path.join(project_dir, shot_id, f"Take_{take:03d}")
                os.makedirs(take_dir, exist_ok=True)

                # Resolve Previous Latent (Continue / Bridge)
                if mode in ("Continue", "Bridge"):
                    prev_shot_id = data.get("prev_shot_id")
                    prev_take_num = data.get("prev_take_number")
                    if prev_shot_id and prev_take_num is not None:
                        load_path = resolve_latent_path(project_dir, prev_shot_id, prev_take_num)
                    else:
                        ledger_path = os.path.join(project_dir, "project_data.json")
                        parent_shot_num = shot - 1
                        parent_take_num = 1
                        if os.path.exists(ledger_path):
                            with open(ledger_path, "r") as f:
                                ledger = json.load(f)
                            parent_take_num = int(ledger.get("approved_takes", {}).get(str(parent_shot_num), "1"))
                        load_path = resolve_latent_path(project_dir, f"Shot_{parent_shot_num:03d}", parent_take_num)

                # Resolve Next Latent (Lead / Bridge)
                if mode in ("Lead", "Bridge"):
                    next_shot_id = data.get("next_shot_id")
                    next_take_num = data.get("next_take_number")
                    if next_shot_id and next_take_num is not None:
                        next_load_path = resolve_latent_path(project_dir, next_shot_id, next_take_num)
                    if mode == "Lead" and not load_path:
                        # Also populate load_path so api_lead.json works whether wired to slot 5 or slot 13
                        load_path = next_load_path

                prefix = make_shot_prefix(shot_id, take)
                absolute_preview_path = os.path.join(take_dir, f"{prefix}preview.mp4").replace("\\", "/")

                lora_1_active = bool(data.get("active_1", False)) and data.get("lora_1") not in (None, "", "None")
                lora_2_active = bool(data.get("active_2", False)) and data.get("lora_2") not in (None, "", "None")
                first_frame_path = str(data.get("first_frame_path", "")).strip()
                last_frame_path = str(data.get("last_frame_path", "")).strip()

                take_data = {
                    "mode": mode,
                    "prompt": data.get("prompt", ""),
                    "shot_prompt": data.get("shot_prompt", data.get("prompt", "")),
                    "duration": float(data.get("duration", 5.0)),
                    "seed": int(data.get("seed", 0)),
                }
                if lora_1_active:
                    take_data["lora_1"] = {
                        "name": safe_get_model(data.get("lora_1"), "loras"),
                        "strength": float(data.get("lora_strength_1", 0.0))
                    }
                if lora_2_active:
                    take_data["lora_2"] = {
                        "name": safe_get_model(data.get("lora_2"), "loras"),
                        "strength": float(data.get("lora_strength_2", 0.0))
                    }
                if first_frame_path:
                    take_data["first_frame"] = os.path.basename(first_frame_path)
                if last_frame_path:
                    take_data["last_frame"] = os.path.basename(last_frame_path)

                with open(os.path.join(take_dir, f"{prefix}take_data.json"), "w") as f:
                    json.dump(take_data, f, indent=4)

                insert_ctx_str = snap_insert_context_frames(data.get("context_frames", 39))

                for node in workflow.values():
                    if not isinstance(node, dict):
                        continue
                    class_type = node.get("class_type")
                    if class_type == "H3InfinityWrapper_ProjectPayload":
                        node["inputs"]["prompt"] = data.get("prompt", "")
                        node["inputs"]["width"] = int(data.get("width", 864))
                        node["inputs"]["height"] = int(data.get("height", 480))
                        node["inputs"]["duration"] = float(data.get("duration", 5.0))
                        node["inputs"]["seed"] = int(data.get("seed", 0))
                        node["inputs"]["load_path"] = load_path
                        node["inputs"]["next_load_path"] = next_load_path
                        node["inputs"]["take_dir"] = take_dir
                    elif class_type == "H3InfinityWrapper_SettingsPayload":
                        inject_settings_payload(node, data)
                    elif class_type == "H3InfiniteInsertVideo":
                        node["inputs"]["tail_context_frames"] = insert_ctx_str
                        node["inputs"]["head_context_frames"] = insert_ctx_str

            elif mode == "Stitch":
                project_files_map = {}
                if os.path.exists(project_dir):
                    for root, dirs, files in os.walk(project_dir):
                        for file in files:
                            if file.endswith(".safetensors"):
                                project_files_map[file.lower()] = os.path.join(root, file)

                ordered_paths = []
                explicit_takes = data.get("stitch_takes")

                if isinstance(explicit_takes, list) and len(explicit_takes) > 0:
                    for item in explicit_takes:
                        t_num = int(item.get("take", 0))
                        if t_num <= 0:
                            continue
                        s_id = item.get("shot_id")
                        if s_id:
                            p = resolve_latent_path(project_dir, s_id, t_num)
                            if p:
                                ordered_paths.append(p)
                        else:
                            s_num = int(item.get("shot", 0))
                            if s_num <= 0:
                                continue
                            target_filename = f"shot{s_num:03d}_take{t_num:03d}_latent.safetensors".lower()
                            if target_filename in project_files_map:
                                ordered_paths.append(project_files_map[target_filename])
                else:
                    ledger_path = os.path.join(project_dir, "project_data.json")
                    if os.path.exists(ledger_path):
                        with open(ledger_path, "r") as f:
                            ledger = json.load(f)
                            approved_takes = ledger.get("approved_takes", {})
                            sorted_shots = sorted([int(k) for k in approved_takes.keys() if k.isdigit()])
                            for s_num in sorted_shots:
                                t_num = int(approved_takes[str(s_num)])
                                target_filename = f"shot{s_num:03d}_take{t_num:03d}_latent.safetensors".lower()
                                if target_filename in project_files_map:
                                    ordered_paths.append(project_files_map[target_filename])

                if not ordered_paths:
                    return web.json_response({"error": "Stitch failed: No approved latent files found."}, status=400)

                os.makedirs(TEMP_STITCH_ABS, exist_ok=True)
                os.makedirs(TEMP_STITCHED_ABS, exist_ok=True)

                for f in os.listdir(TEMP_STITCH_ABS):
                    if f.endswith(".safetensors"):
                        os.remove(os.path.join(TEMP_STITCH_ABS, f))
                        
                for f in os.listdir(TEMP_STITCHED_ABS):
                    if f.endswith(".mp4") or f.endswith(".locked"):
                        os.remove(os.path.join(TEMP_STITCHED_ABS, f))

                for i, path in enumerate(ordered_paths):
                    dest = os.path.join(TEMP_STITCH_ABS, f"clip_{i+1:05d}.safetensors")
                    try:
                        os.link(path, dest)
                    except OSError:
                        shutil.copy2(path, dest)

                branch_index = int(data.get("branch_index", 1))
                rel_staging_prefix = f"{TEMP_STITCH_REL}/clip"
                temp_output_prefix = f"{TEMP_STITCHED_REL}/master_output"
                absolute_preview_path = get_next_stitched_path(project_dir, project, branch_index)

                for node in workflow.values():
                    if not isinstance(node, dict):
                        continue
                    class_type = node.get("class_type")
                    if class_type == "H3InfinityWrapper_ProjectPayload":
                        node["inputs"]["latent_prefix"] = rel_staging_prefix
                        node["inputs"]["filename_prefix"] = temp_output_prefix
                        node["inputs"]["stitch_paths_json"] = json.dumps(ordered_paths)
                        node["inputs"]["stitch_mp4_path"] = absolute_preview_path
                    elif class_type == "H3InfinityWrapper_SettingsPayload":
                        inject_settings_payload(node, data)

            return web.json_response({
                "status": "success", 
                "workflow": workflow,
                "absolute_preview_path": absolute_preview_path
            })
            
        except Exception as e:
            traceback.print_exc()
            return web.json_response({"error": str(e)}, status=500)