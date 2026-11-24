import * as Icons from "./icons.js";
import { EVENTS } from "./StateManager.js";
import { createSearchableSelect } from "./UI_SearchableSelect.js";

const ASPECT_RATIOS = ["1:1", "4:3", "3:4", "16:9", "9:16"];

const RESOLUTIONS = {
    "16:9": {
        "0.1": [448, 256], "0.2": [608, 352], "0.3": [736, 416], "0.4": [864, 480], "0.5": [960, 544],
        "0.6": [1056, 608], "0.7": [1152, 640], "0.8": [1216, 672], "0.9": [1280, 736],
        "0.98": [1344, 768], "1.0": [1376, 768], "1.2": [1504, 832], "1.5": [1664, 928],
        "1.8": [1824, 1024], "2.0": [1920, 1088]
    },
    "9:16": {
        "0.1": [256, 448], "0.2": [352, 608], "0.3": [416, 736], "0.4": [480, 864], "0.5": [544, 960],
        "0.6": [608, 1056], "0.7": [640, 1152], "0.8": [672, 1216], "0.9": [736, 1280],
        "0.98": [768, 1344], "1.0": [768, 1376], "1.2": [832, 1504], "1.5": [928, 1664],
        "1.8": [1024, 1824], "2.0": [1088, 1920]
    },
    "1:1": {
        "0.1": [320, 320], "0.2": [448, 448], "0.3": [544, 544], "0.4": [640, 640], "0.5": [704, 704],
        "0.6": [768, 768], "0.7": [832, 832], "0.8": [896, 896], "0.9": [960, 960],
        "0.98": [992, 992], "1.0": [1024, 1024], "1.2": [1088, 1088], "1.5": [1216, 1216],
        "1.8": [1344, 1344], "2.0": [1408, 1408]
    },
    "4:3": {
        "0.1": [384, 288], "0.2": [512, 384], "0.3": [640, 480], "0.4": [736, 544], "0.5": [832, 608],
        "0.6": [896, 672], "0.7": [960, 736], "0.8": [1024, 768], "0.9": [1088, 832],
        "0.98": [1152, 864], "1.0": [1152, 864], "1.2": [1280, 960], "1.5": [1408, 1056],
        "1.8": [1536, 1152], "2.0": [1632, 1216]
    },
    "3:4": {
        "0.1": [288, 384], "0.2": [384, 512], "0.3": [480, 640], "0.4": [544, 736], "0.5": [608, 832],
        "0.6": [672, 896], "0.7": [736, 960], "0.8": [768, 1024], "0.9": [832, 1088],
        "0.98": [864, 1152], "1.0": [864, 1152], "1.2": [960, 1280], "1.5": [1056, 1408],
        "1.8": [1152, 1536], "2.0": [1216, 1632]
    }
};

export function createLeftPanel(ctx) {
    const preventEvents = (e) => e.stopPropagation();

    const leftCol = document.createElement("div");
    leftCol.className = "h3-left-col";

    // ==========================================
    // GLOBAL SETTINGS FRAME
    // ==========================================
    const globalFrame = document.createElement("div");
    globalFrame.className = "h3-frame h3-frame-flex";

    const globalTitle = document.createElement("div");
    globalTitle.className = "h3-panel-title";
    globalTitle.style.display = "flex";
    globalTitle.style.alignItems = "center";
    globalTitle.style.justifyContent = "flex-start";
    globalTitle.style.gap = "6px";
    globalTitle.innerHTML = `${Icons.ICON_TOOLS} <span>Global Settings</span>`;
    globalFrame.appendChild(globalTitle);

    // Workflow Selector
    const wfRow = document.createElement("div");
    wfRow.className = "h3-row";
    const wfLbl = document.createElement("span");
    wfLbl.className = "h3-label";
    wfLbl.innerText = "Workflow:";
    const wfSelect = document.createElement("select");
    wfSelect.className = "h3-input";
    wfSelect.addEventListener("mousedown", preventEvents);
    wfSelect.addEventListener("change", (e) => {
        ctx.stateManager.updateGlobal("workflow", e.target.value);
    });
    wfRow.appendChild(wfLbl);
    wfRow.appendChild(wfSelect);
    globalFrame.appendChild(wfRow);

    // Dynamic Searchable Model Selector (auto-switches between UNet and Diffusion)
    const modelRow = document.createElement("div");
    modelRow.className = "h3-row";
    const modelLbl = document.createElement("span");
    modelLbl.className = "h3-label";
    modelLbl.innerText = "Model:";

    const getActiveModelType = () => {
        const wfName = ctx.stateManager.state.global.workflow || "Default";
        const match = (ctx.stateManager.options.workflows || []).find(w => w.name === wfName);
        return match ? match.model_type : "diffusion";
    };

    const modelSelect = createSearchableSelect({
        placeholder: "Filter models...",
        onChange: (val) => {
            const key = getActiveModelType() === "unet" ? "unet_model" : "diffusion_model";
            ctx.stateManager.updateGlobal(key, val);
        }
    });

    modelRow.appendChild(modelLbl);
    modelRow.appendChild(modelSelect.element);
    globalFrame.appendChild(modelRow);

    // Sampler & Scheduler
    const sampSchedRow = document.createElement("div");
    sampSchedRow.className = "h3-row";
    sampSchedRow.style.gap = "6px";

    const samplerSelect = document.createElement("select");
    samplerSelect.className = "h3-input";
    samplerSelect.title = "Sampler";
    samplerSelect.style.flex = "1";
    samplerSelect.style.minWidth = "0";
    samplerSelect.addEventListener("mousedown", preventEvents);
    samplerSelect.addEventListener("change", (e) => ctx.stateManager.updateGlobal("sampler_name", e.target.value));

    const schedSelect = document.createElement("select");
    schedSelect.className = "h3-input";
    schedSelect.title = "Scheduler";
    schedSelect.style.flex = "1";
    schedSelect.style.minWidth = "0";
    schedSelect.addEventListener("mousedown", preventEvents);
    schedSelect.addEventListener("change", (e) => ctx.stateManager.updateGlobal("scheduler", e.target.value));

    sampSchedRow.appendChild(samplerSelect);
    sampSchedRow.appendChild(schedSelect);
    globalFrame.appendChild(sampSchedRow);

    // Steps & Context Frames
    const stepsCtxRow = document.createElement("div");
    stepsCtxRow.className = "h3-row";
    stepsCtxRow.style.gap = "6px";
    stepsCtxRow.style.justifyContent = "space-between";

    const stepsGroup = document.createElement("div");
    stepsGroup.style.display = "flex";
    stepsGroup.style.alignItems = "center";
    stepsGroup.style.gap = "4px";

    const stepsLbl = document.createElement("span");
    stepsLbl.className = "h3-label";
    stepsLbl.style.minWidth = "auto";
    stepsLbl.style.whiteSpace = "nowrap";
    stepsLbl.innerText = "Steps:";

    const stepsNum = document.createElement("input");
    stepsNum.type = "number";
    stepsNum.className = "h3-input h3-input-num";
    stepsNum.style.width = "46px";
    stepsNum.style.flex = "0 0 auto";
    stepsNum.min = "1";
    stepsNum.max = "50";
    stepsNum.step = "1";
    stepsNum.addEventListener("mousedown", preventEvents);
    stepsNum.addEventListener("keydown", preventEvents);
    stepsNum.addEventListener("change", (e) => {
        const parsed = Math.max(1, Math.min(50, parseInt(e.target.value, 10) || 12));
        stepsNum.value = parsed;
        ctx.stateManager.updateGlobal("steps", parsed);
    });

    stepsGroup.appendChild(stepsLbl);
    stepsGroup.appendChild(stepsNum);

    const ctxGroup = document.createElement("div");
    ctxGroup.style.display = "flex";
    ctxGroup.style.alignItems = "center";
    ctxGroup.style.gap = "4px";

    const ctxLbl = document.createElement("span");
    ctxLbl.className = "h3-label";
    ctxLbl.style.minWidth = "auto";
    ctxLbl.style.whiteSpace = "nowrap";
    ctxLbl.innerText = "Context Frames:";

    const ctxSelect = document.createElement("select");
    ctxSelect.className = "h3-input";
    ctxSelect.style.width = "54px";
    ctxSelect.style.flex = "0 0 auto";
    [5, 22, 39, 56, 73, 90].forEach(val => {
        const opt = document.createElement("option");
        opt.value = String(val);
        opt.innerText = String(val);
        ctxSelect.appendChild(opt);
    });
    ctxSelect.addEventListener("mousedown", preventEvents);
    ctxSelect.addEventListener("change", (e) => {
        ctx.stateManager.updateGlobal("context_frames", parseInt(e.target.value, 10));
    });

    ctxGroup.appendChild(ctxLbl);
    ctxGroup.appendChild(ctxSelect);

    stepsCtxRow.appendChild(stepsGroup);
    stepsCtxRow.appendChild(ctxGroup);
    globalFrame.appendChild(stepsCtxRow);

    // ==========================================
    // RESOLUTION PRESETS
    // ==========================================
    const presetRow = document.createElement("div");
    presetRow.className = "h3-row";
    presetRow.style.gap = "4px";

    const presetLbl = document.createElement("span");
    presetLbl.className = "h3-label";
    presetLbl.style.minWidth = "auto";
    presetLbl.style.whiteSpace = "nowrap";
    presetLbl.innerText = "Preset:";

    const ratioSelect = document.createElement("select");
    ratioSelect.className = "h3-input";
    ratioSelect.title = "Aspect Ratio";
    ratioSelect.style.width = "58px";
    ratioSelect.style.flex = "0 0 auto";
    ASPECT_RATIOS.forEach(ratio => {
        const opt = document.createElement("option");
        opt.value = ratio;
        opt.innerText = ratio;
        ratioSelect.appendChild(opt);
    });
    ratioSelect.value = "16:9";
    ratioSelect.addEventListener("mousedown", preventEvents);

    const resSelect = document.createElement("select");
    resSelect.className = "h3-input";
    resSelect.title = "Resolution Preset";
    resSelect.style.flex = "1";
    resSelect.style.minWidth = "0";
    resSelect.addEventListener("mousedown", preventEvents);

    const populateResolutions = (ratio, selectedMp = null) => {
        const map = RESOLUTIONS[ratio] || RESOLUTIONS["16:9"];
        resSelect.innerHTML = "";
        Object.entries(map).forEach(([mp, [w, h]]) => {
            const opt = document.createElement("option");
            opt.value = mp;
            opt.innerText = `${mp} MP (${w}x${h})`;
            resSelect.appendChild(opt);
        });
        if (selectedMp && map[selectedMp]) {
            resSelect.value = selectedMp;
        }
    };

    const applyPresetSelection = () => {
        const ratio = ratioSelect.value;
        const mp = resSelect.value;
        const dims = RESOLUTIONS[ratio]?.[mp];
        if (!dims) return;
        const [w, h] = dims;
        wInput.value = w;
        hInput.value = h;
        if (h > 0) lockedRatio = w / h;
        ctx.stateManager.updateDimensions(w, h);
    };

    ratioSelect.addEventListener("change", () => {
        const currentMp = resSelect.value || "0.4";
        populateResolutions(ratioSelect.value, currentMp);
        applyPresetSelection();
    });

    resSelect.addEventListener("change", () => {
        applyPresetSelection();
    });

    presetRow.appendChild(presetLbl);
    presetRow.appendChild(ratioSelect);
    presetRow.appendChild(resSelect);
    globalFrame.appendChild(presetRow);

    // Dimensions
    let isAspectLocked = true;
    let lockedRatio = 864 / 480;

    const dimRow = document.createElement("div");
    dimRow.className = "h3-row";
    dimRow.style.gap = "4px";

    const wLbl = document.createElement("span");
    wLbl.className = "h3-label";
    wLbl.style.minWidth = "auto";
    wLbl.style.whiteSpace = "nowrap";
    wLbl.innerText = "Width";

    const wInput = document.createElement("input");
    wInput.type = "number";
    wInput.className = "h3-input h3-input-num";
    wInput.style.flex = "0 0 auto";
    wInput.style.minWidth = "64px";
    wInput.min = "64";
    wInput.max = "1920";
    wInput.step = "32";
    wInput.addEventListener("mousedown", preventEvents);
    wInput.addEventListener("keydown", preventEvents);

    const hLbl = document.createElement("span");
    hLbl.className = "h3-label";
    hLbl.style.minWidth = "auto";
    hLbl.style.whiteSpace = "nowrap";
    hLbl.innerText = "Height";

    const hInput = document.createElement("input");
    hInput.type = "number";
    hInput.className = "h3-input h3-input-num";
    hInput.style.flex = "0 0 auto";
    hInput.style.minWidth = "64px";
    hInput.min = "64";
    hInput.max = "1920";
    hInput.step = "32";
    hInput.addEventListener("mousedown", preventEvents);
    hInput.addEventListener("keydown", preventEvents);

    const linkBtn = document.createElement("button");
    linkBtn.className = "h3-icon-btn small";
    linkBtn.style.flex = "0 0 auto";
    linkBtn.title = "Lock Aspect Ratio";
    linkBtn.innerHTML = Icons.ICON_LINK || "🔗";
    const updateLinkBtnStyle = () => {
        linkBtn.style.color = isAspectLocked ? "var(--h3-accent-cyan, #4fd1ff)" : "var(--h3-text-dim, #666)";
        linkBtn.style.borderColor = isAspectLocked ? "var(--h3-accent-cyan, #4fd1ff)" : "var(--h3-border-subtle, #333)";
        linkBtn.title = isAspectLocked ? "Aspect Ratio Locked" : "Aspect Ratio Unlocked";
    };
    updateLinkBtnStyle();

    linkBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (linkBtn.disabled) return;
        isAspectLocked = !isAspectLocked;
        if (isAspectLocked) {
            const w = parseInt(wInput.value, 10) || 864;
            const h = parseInt(hInput.value, 10) || 480;
            lockedRatio = w / h;
        }
        updateLinkBtnStyle();
    });

    const snapDim = (val) => Math.max(64, Math.min(1920, Math.round(val / 32) * 32));

    wInput.addEventListener("change", () => {
        const w = snapDim(parseInt(wInput.value, 10) || 864);
        let h = snapDim(parseInt(hInput.value, 10) || 480);
        if (isAspectLocked && lockedRatio > 0) {
            h = snapDim(w / lockedRatio);
        }
        wInput.value = w;
        hInput.value = h;
        ctx.stateManager.updateDimensions(w, h);
    });

    hInput.addEventListener("change", () => {
        let w = snapDim(parseInt(wInput.value, 10) || 864);
        const h = snapDim(parseInt(hInput.value, 10) || 480);
        if (isAspectLocked && lockedRatio > 0) {
            w = snapDim(h * lockedRatio);
        }
        wInput.value = w;
        hInput.value = h;
        ctx.stateManager.updateDimensions(w, h);
    });

    dimRow.appendChild(wLbl);
    dimRow.appendChild(wInput);
    dimRow.appendChild(hLbl);
    dimRow.appendChild(hInput);
    dimRow.appendChild(linkBtn);
    globalFrame.appendChild(dimRow);

    populateResolutions("16:9", "0.4");

    // ==========================================
    // GLOBAL LoRA PANEL
    // ==========================================
    const gLoraPanel = document.createElement("div");
    gLoraPanel.style.display = "flex";
    gLoraPanel.style.flexDirection = "column";
    gLoraPanel.style.gap = "4px";
    gLoraPanel.style.padding = "4px";
    gLoraPanel.style.border = "1px solid var(--h3-border-subtle)";
    gLoraPanel.style.borderRadius = "4px";

    const gLoraTopRow = document.createElement("div");
    gLoraTopRow.className = "h3-row";

    const gLoraCheck = document.createElement("input");
    gLoraCheck.type = "checkbox";
    gLoraCheck.addEventListener("mousedown", preventEvents);
    gLoraCheck.addEventListener("change", (e) => ctx.stateManager.updateGlobal("global_lora_active", e.target.checked));

    const gLoraLbl = document.createElement("span");
    gLoraLbl.className = "h3-label";
    gLoraLbl.style.minWidth = "auto";
    gLoraLbl.style.whiteSpace = "nowrap";
    gLoraLbl.style.color = "var(--h3-text-secondary)";
    gLoraLbl.innerText = "Global LoRA";

    const gLoraSlider = document.createElement("input");
    gLoraSlider.type = "range";
    gLoraSlider.className = "h3-slider";
    gLoraSlider.min = "-10";
    gLoraSlider.max = "10";
    gLoraSlider.step = "0.05";
    gLoraSlider.addEventListener("mousedown", preventEvents);

    const gLoraNum = document.createElement("input");
    gLoraNum.type = "number";
    gLoraNum.className = "h3-input h3-input-num";
    gLoraNum.style.width = "56px";
    gLoraNum.style.flex = "0 0 auto";
    gLoraNum.min = "-10";
    gLoraNum.max = "10";
    gLoraNum.step = "0.05";
    gLoraNum.addEventListener("mousedown", preventEvents);
    gLoraNum.addEventListener("keydown", preventEvents);

    const updateGlobalLoraStr = (val) => {
        const parsed = parseFloat(val);
        if (isNaN(parsed)) return;
        gLoraSlider.value = parsed;
        gLoraNum.value = parsed;
        ctx.stateManager.updateGlobal("global_lora_strength", parsed);
    };
    gLoraSlider.addEventListener("input", (e) => updateGlobalLoraStr(e.target.value));
    gLoraNum.addEventListener("change", (e) => updateGlobalLoraStr(e.target.value));

    gLoraTopRow.appendChild(gLoraCheck);
    gLoraTopRow.appendChild(gLoraLbl);
    gLoraTopRow.appendChild(gLoraSlider);
    gLoraTopRow.appendChild(gLoraNum);

    const gLoraBotRow = document.createElement("div");
    gLoraBotRow.className = "h3-row";

    const gLoraSelect = createSearchableSelect({
        placeholder: "Filter LoRAs...",
        onChange: (val) => ctx.stateManager.updateGlobal("global_lora", val)
    });

    gLoraBotRow.appendChild(gLoraSelect.element);
    gLoraPanel.appendChild(gLoraTopRow);
    gLoraPanel.appendChild(gLoraBotRow);
    globalFrame.appendChild(gLoraPanel);

    // ==========================================
    // GLOBAL REFERENCES + GLOBAL PROMPT
    // ==========================================
    const gpWrapper = document.createElement("div");
    gpWrapper.style.display = "flex";
    gpWrapper.style.flexDirection = "column";
    gpWrapper.style.gap = "4px";
    gpWrapper.style.marginTop = "auto";
    gpWrapper.style.paddingTop = "6px";
    gpWrapper.style.borderTop = "1px solid var(--h3-border-subtle)";

    const gRefPanel = document.createElement("div");
    gRefPanel.style.display = "flex";
    gRefPanel.style.flexDirection = "column";
    gRefPanel.style.gap = "4px";
    gRefPanel.style.padding = "4px";
    gRefPanel.style.border = "1px solid var(--h3-border-subtle)";
    gRefPanel.style.borderRadius = "4px";

    const gRefHeader = document.createElement("div");
    gRefHeader.className = "h3-row";
    gRefHeader.style.gap = "4px";

    const gRefCheck = document.createElement("input");
    gRefCheck.type = "checkbox";
    gRefCheck.addEventListener("mousedown", preventEvents);
    gRefCheck.addEventListener("change", (e) => {
        ctx.stateManager.updateGlobal("global_ref_enabled", e.target.checked);
    });

    const gRefLbl = document.createElement("span");
    gRefLbl.className = "h3-label";
    gRefLbl.style.minWidth = "auto";
    gRefLbl.style.whiteSpace = "nowrap";
    gRefLbl.style.color = "var(--h3-text-secondary)";
    gRefLbl.innerText = "Global References";

    gRefHeader.appendChild(gRefCheck);
    gRefHeader.appendChild(gRefLbl);
    gRefPanel.appendChild(gRefHeader);

    const createGlobalRefBox = (num) => {
        const stateKey = `global_ref_${num}`;
        const label = `Pic ${num}`;

        const zone = document.createElement("div");
        zone.className = "h3-dnd-zone";
        zone.style.flex = "1 1 0";
        zone.style.minWidth = "0";
        zone.style.aspectRatio = "1 / 1";
        zone.style.height = "auto";
        zone.style.minHeight = "0";

        const text = document.createElement("span");
        text.innerText = label;
        text.style.fontSize = "8px";
        zone.appendChild(text);

        const imgPreview = document.createElement("img");
        imgPreview.className = "h3-dnd-image-preview";
        imgPreview.style.display = "none";
        zone.appendChild(imgPreview);

        zone.addEventListener("dragover", (e) => {
            if (zone.dataset.locked === "true") return;
            e.preventDefault();
            zone.classList.add("dragover");
        });
        zone.addEventListener("dragleave", (e) => {
            e.preventDefault();
            zone.classList.remove("dragover");
        });
        zone.addEventListener("drop", (e) => {
            if (zone.dataset.locked === "true") return;
            e.preventDefault();
            zone.classList.remove("dragover");
            const file = e.dataTransfer.files[0];
            if (!file || !file.type.startsWith("image/")) return;

            const reader = new FileReader();
            reader.onload = async (ev) => {
                const b64 = ev.target.result;
                text.innerText = "...";
                try {
                    const resp = await fetch("/h3_wrapper/upload_image", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            project_name: ctx.stateManager.state.project_name,
                            filename: file.name,
                            image_data: b64
                        })
                    });
                    const resData = await resp.json();
                    if (resData.status === "success") {
                        ctx.stateManager.updateGlobal(stateKey, resData.file_path);
                        text.style.display = "none";
                        imgPreview.src = b64;
                        imgPreview.style.display = "block";
                    }
                } catch (err) {
                    text.innerText = "Err";
                    console.error(err);
                }
            };
            reader.readAsDataURL(file);
        });

        const clearBtn = document.createElement("button");
        clearBtn.className = "h3-icon-btn small danger";
        clearBtn.innerHTML = Icons.ICON_TRASH;
        clearBtn.style.position = "absolute";
        clearBtn.style.top = "2px";
        clearBtn.style.right = "2px";
        clearBtn.style.display = "none";
        clearBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            if (zone.dataset.locked === "true") return;
            ctx.stateManager.updateGlobal(stateKey, "");
            imgPreview.src = "";
            imgPreview.style.display = "none";
            text.style.display = "inline";
            text.innerText = label;
            clearBtn.style.display = "none";
        });
        zone.appendChild(clearBtn);

        return { zone, imgPreview, text, clearBtn, defaultLabel: label, stateKey };
    };

    const gRefSingleRow = document.createElement("div");
    gRefSingleRow.className = "h3-row";
    gRefSingleRow.style.gap = "4px";
    gRefSingleRow.style.alignItems = "stretch";

    const gRefs = [
        createGlobalRefBox(1),
        createGlobalRefBox(2),
        createGlobalRefBox(3),
        createGlobalRefBox(4)
    ];

    gRefs.forEach(ref => gRefSingleRow.appendChild(ref.zone));
    gRefPanel.appendChild(gRefSingleRow);

    const gpInput = document.createElement("textarea");
    gpInput.className = "h3-input";
    gpInput.placeholder = "Global Prompt, applies to all shots in the timeline";
    gpInput.style.minHeight = "36px";
    gpInput.style.height = "120px";
    gpInput.addEventListener("mousedown", preventEvents);
    gpInput.addEventListener("keydown", preventEvents);
    gpInput.addEventListener("change", (e) => {
        const val = e.target.value;
        ctx.stateManager.updateGlobal("global_prompt", val);
        ctx.stateManager.updateGlobal("global_prompt_enabled", val.trim().length > 0);
    });

    gpWrapper.appendChild(gRefPanel);
    gpWrapper.appendChild(gpInput);
    globalFrame.appendChild(gpWrapper);

    leftCol.appendChild(globalFrame);

    // ==========================================
    // SYNC & SELECTIVE LOCK LOGIC
    // ==========================================
    const firstShotOnlyControls = [
        ratioSelect, resSelect, wInput, hInput, linkBtn
    ];

    const updateShotLockState = () => {
        const isLocked = ctx.stateManager.selectedShotIndex > 0;
        firstShotOnlyControls.forEach(el => {
            el.disabled = isLocked;
            el.style.opacity = isLocked ? "0.45" : "1";
        });
    };

    const populateSelect = (sel, items, currentVal) => {
        sel.innerHTML = "";
        (items || []).forEach(item => {
            const opt = document.createElement("option");
            opt.value = item;
            opt.innerText = item;
            sel.appendChild(opt);
        });
        if (currentVal && (items || []).includes(currentVal)) {
            sel.value = currentVal;
        }
    };

    const syncModelDropdown = () => {
        const opts = ctx.stateManager.options;
        const g = ctx.stateManager.state.global;
        const modelType = getActiveModelType();
        const list = modelType === "unet" ? opts.unet_models : opts.diffusion_models;
        const currentVal = modelType === "unet" ? g.unet_model : g.diffusion_model;
        modelSelect.setOptions(list, currentVal);
        modelSelect.setTitle(modelType === "unet" ? "UNet Model (auto-detected)" : "Diffusion Model (auto-detected)");
    };

    const syncPresetFromDims = (w, h) => {
        for (const ratio of ASPECT_RATIOS) {
            const map = RESOLUTIONS[ratio];
            for (const [mp, [rw, rh]] of Object.entries(map)) {
                if (rw === w && rh === h) {
                    ratioSelect.value = ratio;
                    populateResolutions(ratio, mp);
                    return;
                }
            }
        }
    };

    const syncOptions = () => {
        const opts = ctx.stateManager.options;
        const g = ctx.stateManager.state.global;
        const wfNames = (opts.workflows || []).map(w => w.name);
        populateSelect(wfSelect, wfNames.length > 0 ? wfNames : ["Default"], g.workflow);
        syncModelDropdown();
        populateSelect(samplerSelect, opts.samplers, g.sampler_name);
        populateSelect(schedSelect, opts.schedulers, g.scheduler);

        const loraList = ["None", ...(opts.loras || [])];
        gLoraSelect.setOptions(loraList, g.global_lora || "None");
    };

    const syncGlobalRefsUI = () => {
        const isRef2V = ctx.stateManager.isRef2VModel();
        const g = ctx.stateManager.state?.global || {};
        const shot = ctx.stateManager.getActiveShot() || {};
        const globalToggleOn = isRef2V && Boolean(g.global_ref_enabled);

        gRefCheck.checked = Boolean(g.global_ref_enabled);
        gRefCheck.disabled = !isRef2V;
        gRefHeader.style.opacity = isRef2V ? "1" : "0.45";

        gRefs.forEach((ref, idx) => {
            const shotKey = `ref_image_${idx + 1}`;
            const directPath = g[ref.stateKey] || "";
            const shotPath = isRef2V ? (shot[shotKey] || "") : "";
            const displayPath = directPath || (globalToggleOn ? shotPath : "");
            const isMirrored = !directPath && globalToggleOn && Boolean(shotPath);
            const locked = !globalToggleOn || isMirrored;

            ref.zone.dataset.locked = locked ? "true" : "false";
            ref.zone.style.cursor = locked ? "not-allowed" : "pointer";
            ref.zone.style.borderStyle = isMirrored ? "dashed" : "";
            ref.zone.style.opacity = !isRef2V ? "0.45" : "1";

            if (displayPath) {
                ref.text.style.display = "none";
                ref.imgPreview.style.display = "block";
                ref.imgPreview.src = `/h3_wrapper/view_media?path=${encodeURIComponent(displayPath)}&t=${Date.now()}`;
                if (isMirrored) {
                    ref.imgPreview.style.opacity = "0.4";
                    ref.imgPreview.style.filter = "grayscale(45%) brightness(0.85)";
                } else {
                    ref.imgPreview.style.opacity = "1";
                    ref.imgPreview.style.filter = "none";
                }
                ref.clearBtn.style.display = directPath && globalToggleOn ? "block" : "none";
            } else {
                ref.text.style.display = "inline";
                ref.text.innerText = ref.defaultLabel;
                ref.text.style.opacity = locked ? "0.45" : "1";
                ref.imgPreview.style.display = "none";
                ref.imgPreview.src = "";
                ref.imgPreview.style.opacity = "1";
                ref.imgPreview.style.filter = "none";
                ref.clearBtn.style.display = "none";
            }
        });
    };

    const syncUI = () => {
        const g = ctx.stateManager.state.global;

        if (g.workflow && Array.from(wfSelect.options).some(o => o.value === g.workflow)) {
            wfSelect.value = g.workflow;
        }
        syncModelDropdown();

        if (g.sampler_name) samplerSelect.value = g.sampler_name;
        if (g.scheduler) schedSelect.value = g.scheduler;

        const stepsVal = Math.max(1, Math.min(50, g.steps !== undefined ? g.steps : 20));
        stepsNum.value = stepsVal;

        ctxSelect.value = String(g.context_frames !== undefined ? g.context_frames : 39);

        const w = g.width !== undefined ? g.width : 864;
        const h = g.height !== undefined ? g.height : 480;
        wInput.value = w;
        hInput.value = h;
        syncPresetFromDims(w, h);
        if (isAspectLocked && h > 0) {
            lockedRatio = w / h;
        }

        gLoraCheck.checked = Boolean(g.global_lora_active);
        const gLoraStr = g.global_lora_strength !== undefined ? g.global_lora_strength : 1.0;
        gLoraSlider.value = gLoraStr;
        gLoraNum.value = gLoraStr;
        gLoraSelect.setValue(g.global_lora || "None");

        gpInput.value = g.global_prompt || "";
        updateShotLockState();
        syncGlobalRefsUI();
    };

    ctx.stateManager.subscribe((event) => {
        if (event === EVENTS.OPTIONS_LOADED) {
            syncOptions();
            syncUI();
        } else if ([
            EVENTS.PROJECT_LOADED,
            EVENTS.GLOBAL_UPDATED,
            EVENTS.SHOT_SELECTED,
            EVENTS.SHOT_UPDATED,
            EVENTS.SHOT_ADDED,
            EVENTS.SHOT_DELETED,
            EVENTS.HISTORY_RESTORED,
            EVENTS.BRANCH_SELECTED
        ].includes(event)) {
            syncUI();
        }
    });

    return { element: leftCol };
}