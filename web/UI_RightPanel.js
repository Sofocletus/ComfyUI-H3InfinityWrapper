import * as Icons from "./icons.js";
import { EVENTS } from "./StateManager.js";
import { createSearchableSelect } from "./UI_SearchableSelect.js";

export function createRightPanel(ctx) {
    const preventEvents = (e) => e.stopPropagation();
    const rightCol = document.createElement("div");
    rightCol.className = "h3-right-col";

    // --- HELPER: Accordion Builder ---
    const createAccordion = (titleText, iconSvg, defaultOpen = false) => {
        const wrapper = document.createElement("div");
        wrapper.style.display = "flex";
        wrapper.style.flexDirection = "column";
        wrapper.style.gap = "4px";
        wrapper.style.flexShrink = "0";

        const header = document.createElement("div");
        header.className = "h3-accordion-header";

        const left = document.createElement("div");
        left.style.display = "flex";
        left.style.alignItems = "center";
        left.style.gap = "6px";
        left.innerHTML = `${iconSvg} <span>${titleText}</span>`;

        const chevron = document.createElement("div");
        chevron.innerHTML = defaultOpen ? Icons.ICON_CHEVRON_UP : Icons.ICON_CHEVRON_DOWN;

        header.appendChild(left);
        header.appendChild(chevron);

        const content = document.createElement("div");
        content.className = `h3-accordion-content ${defaultOpen ? "open" : ""}`;

        header.addEventListener("click", () => {
            const isOpen = content.classList.contains("open");
            if (isOpen) {
                content.classList.remove("open");
                chevron.innerHTML = Icons.ICON_CHEVRON_DOWN;
            } else {
                content.classList.add("open");
                chevron.innerHTML = Icons.ICON_CHEVRON_UP;
            }
        });

        wrapper.appendChild(header);
        wrapper.appendChild(content);
        return { wrapper, content };
    };

    // --- HELPER: Drag & Drop Zone ---
    const createDnDZone = (label, stateKey, square = false) => {
        const zone = document.createElement("div");
        zone.className = "h3-dnd-zone";
        zone.style.flex = "1 1 0";
        zone.style.minWidth = "0";
        if (square) {
            zone.style.aspectRatio = "1 / 1";
            zone.style.height = "auto";
            zone.style.minHeight = "0";
        }

        const text = document.createElement("span");
        text.innerText = label;
        if (square) text.style.fontSize = "8px";
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
                text.innerText = square ? "..." : "Uploading...";

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
                        ctx.stateManager.updateActiveShot(stateKey, resData.file_path);
                        text.style.display = "none";
                        imgPreview.src = b64;
                        imgPreview.style.display = "block";
                    }
                } catch (err) {
                    text.innerText = square ? "Err" : "Upload Failed";
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
            ctx.stateManager.updateActiveShot(stateKey, "");
            imgPreview.src = "";
            imgPreview.style.display = "none";
            text.style.display = "inline";
            text.innerText = label;
            clearBtn.style.display = "none";
        });
        zone.appendChild(clearBtn);

        return { zone, imgPreview, text, clearBtn, defaultLabel: label, stateKey };
    };

    // ==========================================
    // MAIN PANEL CONFIG
    // ==========================================
    const shotFrame = document.createElement("div");
    shotFrame.className = "h3-frame h3-frame-flex";

    const shotTitle = document.createElement("div");
    shotTitle.className = "h3-panel-title";
    shotTitle.style.flexShrink = "0";
    shotTitle.style.display = "flex";
    shotTitle.style.alignItems = "center";
    shotTitle.style.justifyContent = "space-between";

    const activeShotLabel = document.createElement("div");
    activeShotLabel.style.display = "flex";
    activeShotLabel.style.gap = "6px";
    activeShotLabel.style.alignItems = "center";

    const iconWrapper = document.createElement("div");
    iconWrapper.innerHTML = Icons.ICON_FILM_PROJECT;

    const activeShotText = document.createElement("span");
    activeShotText.innerText = "No Shot Selected";

    const modelVariantBadge = document.createElement("span");
    modelVariantBadge.style.fontSize = "11px";
    modelVariantBadge.style.fontWeight = "800";
    modelVariantBadge.style.letterSpacing = "0.4px";
    modelVariantBadge.style.color = "var(--h3-accent-cyan, #4fd1ff)";
    modelVariantBadge.style.display = "none";

    activeShotLabel.appendChild(iconWrapper);
    activeShotLabel.appendChild(activeShotText);
    activeShotLabel.appendChild(modelVariantBadge);

    const revertBtn = document.createElement("button");
    revertBtn.className = "h3-icon-btn small";
    revertBtn.innerHTML = Icons.ICON_UNDO;
    revertBtn.title = "Restore prompt & settings from completed take";
    revertBtn.disabled = true;
    revertBtn.addEventListener("mousedown", preventEvents);
    revertBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const shot = ctx.stateManager.getActiveShot();
        const take = ctx.stateManager.getActiveTake(shot);
        if (!shot || !take) return;
        ctx.stateManager.applyTakeMetadataToShot(shot, take.take_num);
        ctx.stateManager.notify(EVENTS.SHOT_UPDATED, { index: ctx.stateManager.selectedShotIndex });
        ctx.stateManager.saveProject(true);
    });

    shotTitle.appendChild(activeShotLabel);
    shotTitle.appendChild(revertBtn);
    shotFrame.appendChild(shotTitle);

    // Prompt
    const promptInput = document.createElement("textarea");
    promptInput.className = "h3-input";
    promptInput.placeholder = "Prompt";
    promptInput.style.flex = "1 1 80px";
    promptInput.style.minHeight = "80px";
    promptInput.style.height = "auto";
    promptInput.style.resize = "none";
    promptInput.addEventListener("mousedown", preventEvents);
    promptInput.addEventListener("keydown", preventEvents);
    promptInput.addEventListener("input", (e) => {
        const shot = ctx.stateManager.getActiveShot();
        if (!shot) return;
        shot.prompt = e.target.value;
        ctx.stateManager.saveProject();
    });
    promptInput.addEventListener("change", (e) => {
        ctx.stateManager.updateActiveShot("prompt", e.target.value);
    });
    shotFrame.appendChild(promptInput);

    // ==========================================
    // START & END / REF2V IMAGES
    // ==========================================
    const imgAcc = createAccordion("Start & End / Ref2V", Icons.ICON_IMAGE, false);

    const fl2vBox = document.createElement("div");
    fl2vBox.style.display = "flex";
    fl2vBox.style.flexDirection = "column";
    fl2vBox.style.gap = "4px";

    const imgRow = document.createElement("div");
    imgRow.className = "h3-row";
    imgRow.style.gap = "6px";

    const dndFirst = createDnDZone("First Frame", "first_frame", false);
    const dndLast = createDnDZone("Last Frame", "last_frame", false);
    imgRow.appendChild(dndFirst.zone);
    imgRow.appendChild(dndLast.zone);
    fl2vBox.appendChild(imgRow);
    imgAcc.content.appendChild(fl2vBox);

    const ref2vBox = document.createElement("div");
    ref2vBox.style.display = "none";
    ref2vBox.style.flexDirection = "column";
    ref2vBox.style.gap = "4px";

    const refSingleRow = document.createElement("div");
    refSingleRow.className = "h3-row";
    refSingleRow.style.gap = "4px";
    refSingleRow.style.alignItems = "stretch";

    const dndRefs = [
        createDnDZone("Pic 1", "ref_image_1", true),
        createDnDZone("Pic 2", "ref_image_2", true),
        createDnDZone("Pic 3", "ref_image_3", true),
        createDnDZone("Pic 4", "ref_image_4", true)
    ];

    dndRefs.forEach(dnd => refSingleRow.appendChild(dnd.zone));
    ref2vBox.appendChild(refSingleRow);
    imgAcc.content.appendChild(ref2vBox);

    const applySlotVisual = (dnd, directPath, mirroredPath, locked) => {
        const displayPath = directPath || mirroredPath;
        const isMirrored = !directPath && Boolean(mirroredPath);

        dnd.zone.dataset.locked = locked ? "true" : "false";
        dnd.zone.style.cursor = locked ? "not-allowed" : "pointer";
        dnd.zone.style.borderStyle = isMirrored ? "dashed" : "";

        if (displayPath) {
            dnd.text.style.display = "none";
            dnd.imgPreview.style.display = "block";
            dnd.imgPreview.src = `/h3_wrapper/view_media?path=${encodeURIComponent(displayPath)}&t=${Date.now()}`;
            if (isMirrored) {
                dnd.imgPreview.style.opacity = "0.4";
                dnd.imgPreview.style.filter = "grayscale(45%) brightness(0.85)";
            } else {
                dnd.imgPreview.style.opacity = "1";
                dnd.imgPreview.style.filter = "none";
            }
            dnd.clearBtn.style.display = directPath ? "block" : "none";
        } else {
            dnd.text.style.display = "inline";
            dnd.text.innerText = dnd.defaultLabel;
            dnd.text.style.opacity = locked ? "0.45" : "1";
            dnd.imgPreview.style.display = "none";
            dnd.imgPreview.src = "";
            dnd.imgPreview.style.opacity = "1";
            dnd.imgPreview.style.filter = "none";
            dnd.clearBtn.style.display = "none";
        }
    };

    const syncRefModeAndSlots = (shot) => {
        const isRef2V = ctx.stateManager.isRef2VModel();
        fl2vBox.style.display = isRef2V ? "none" : "flex";
        ref2vBox.style.display = isRef2V ? "flex" : "none";

        applySlotVisual(dndFirst, shot?.first_frame || "", "", false);
        applySlotVisual(dndLast, shot?.last_frame || "", "", false);

        const g = ctx.stateManager.state?.global || {};
        const globalToggleOn = isRef2V && Boolean(g.global_ref_enabled);

        dndRefs.forEach((dnd, idx) => {
            const globalPath = globalToggleOn ? (g[`global_ref_${idx + 1}`] || "") : "";
            const directPath = shot?.[dnd.stateKey] || "";
            const mirroredPath = !directPath ? globalPath : "";
            const locked = Boolean(globalPath) && !directPath;
            applySlotVisual(dnd, directPath, mirroredPath, locked);
        });
    };

    shotFrame.appendChild(imgAcc.wrapper);

    // ==========================================
    // SHOT SETTINGS
    // ==========================================
    const settingsAcc = createAccordion("Shot Settings", Icons.ICON_TOOLS, true);

    const snapH3Frames = (val) => {
        const parsed = parseInt(val, 10);
        if (isNaN(parsed)) return 124;
        const n = Math.max(0, Math.min(41, Math.round((parsed - 22) / 17)));
        return 22 + n * 17;
    };

    const durRow = document.createElement("div");
    durRow.className = "h3-row";
    const durLbl = document.createElement("span");
    durLbl.className = "h3-label";
    durLbl.innerText = "Frames:";

    const durSlider = document.createElement("input");
    durSlider.type = "range";
    durSlider.className = "h3-slider";
    durSlider.min = "22";
    durSlider.max = "719";
    durSlider.step = "17";
    durSlider.addEventListener("mousedown", preventEvents);

    const durNum = document.createElement("input");
    durNum.type = "number";
    durNum.className = "h3-input h3-input-num";
    durNum.style.width = "52px";
    durNum.min = "22";
    durNum.max = "719";
    durNum.step = "17";
    durNum.addEventListener("mousedown", preventEvents);
    durNum.addEventListener("keydown", preventEvents);

    const durSecLbl = document.createElement("span");
    durSecLbl.style.fontSize = "10px";
    durSecLbl.style.fontFamily = "monospace";
    durSecLbl.style.color = "var(--h3-text-dim)";
    durSecLbl.style.minWidth = "38px";
    durSecLbl.style.textAlign = "right";
    durSecLbl.innerText = "5.17s";

    const updateDuration = (val) => {
        const snapped = snapH3Frames(val);
        durSlider.value = snapped;
        durNum.value = snapped;
        durSecLbl.innerText = `${(snapped / 24.0).toFixed(2)}s`;
        ctx.stateManager.updateActiveShot("duration_frames", snapped);
    };
    durSlider.addEventListener("input", (e) => updateDuration(e.target.value));
    durNum.addEventListener("change", (e) => updateDuration(e.target.value));

    durRow.appendChild(durLbl);
    durRow.appendChild(durSlider);
    durRow.appendChild(durNum);
    durRow.appendChild(durSecLbl);
    settingsAcc.content.appendChild(durRow);

    // Seed
    const seedRow = document.createElement("div");
    seedRow.className = "h3-row";
    const seedLbl = document.createElement("span");
    seedLbl.className = "h3-label";
    seedLbl.innerText = "Seed:";

    const seedInput = document.createElement("input");
    seedInput.type = "number";
    seedInput.className = "h3-input h3-input-num";
    seedInput.style.width = "100px";
    seedInput.style.flex = "0 0 auto";
    seedInput.min = "0";
    seedInput.addEventListener("mousedown", preventEvents);
    seedInput.addEventListener("keydown", preventEvents);
    seedInput.addEventListener("change", (e) => {
        const parsed = parseInt(e.target.value, 10);
        if (!isNaN(parsed)) ctx.stateManager.updateActiveShot("seed", parsed);
    });

    const randSeedBtn = document.createElement("button");
    randSeedBtn.className = "h3-icon-btn small";
    randSeedBtn.innerHTML = Icons.ICON_REFRESH;
    randSeedBtn.title = "Randomize Seed";
    randSeedBtn.addEventListener("click", () => {
        const rand = Math.floor(Math.random() * 1000000000);
        seedInput.value = rand;
        ctx.stateManager.updateActiveShot("seed", rand);
    });

    seedRow.appendChild(seedLbl);
    seedRow.appendChild(seedInput);
    seedRow.appendChild(randSeedBtn);
    settingsAcc.content.appendChild(seedRow);

    // LoRAs
    const createLoraControls = (num) => {
        const row = document.createElement("div");
        row.style.display = "flex";
        row.style.flexDirection = "column";
        row.style.gap = "4px";
        row.style.padding = "4px";
        row.style.border = "1px solid var(--h3-border-subtle)";
        row.style.borderRadius = "4px";

        const topRow = document.createElement("div");
        topRow.className = "h3-row";

        const activeCheck = document.createElement("input");
        activeCheck.type = "checkbox";
        activeCheck.addEventListener("mousedown", preventEvents);
        activeCheck.addEventListener("change", (e) => ctx.stateManager.updateActiveShot(`active_${num}`, e.target.checked));

        const loraLbl = document.createElement("span");
        loraLbl.className = "h3-label";
        loraLbl.style.minWidth = "44px";
        loraLbl.style.color = "var(--h3-text-secondary)";
        loraLbl.innerText = `LoRA ${num}`;

        const strSlider = document.createElement("input");
        strSlider.type = "range";
        strSlider.className = "h3-slider";
        strSlider.min = "0";
        strSlider.max = "4";
        strSlider.step = "0.05";
        strSlider.addEventListener("mousedown", preventEvents);

        const strNum = document.createElement("input");
        strNum.type = "number";
        strNum.className = "h3-input h3-input-num";
        strNum.style.width = "60px";
        strNum.style.flex = "0 0 auto";
        strNum.min = "0";
        strNum.max = "4";
        strNum.step = "0.05";
        strNum.addEventListener("mousedown", preventEvents);
        strNum.addEventListener("keydown", preventEvents);

        const updateStr = (val) => {
            const parsed = parseFloat(val);
            if (isNaN(parsed)) return;
            const clamped = Math.max(0, Math.min(4, parsed));
            strSlider.value = clamped;
            strNum.value = clamped;
            ctx.stateManager.updateActiveShot(`lora_strength_${num}`, clamped);
        };
        strSlider.addEventListener("input", (e) => updateStr(e.target.value));
        strNum.addEventListener("input", (e) => {
            const parsed = parseFloat(e.target.value);
            if (!isNaN(parsed)) {
                const clamped = Math.max(0, Math.min(4, parsed));
                strSlider.value = clamped;
                const shot = ctx.stateManager.getActiveShot();
                if (shot) shot[`lora_strength_${num}`] = clamped;
            }
        });
        strNum.addEventListener("change", (e) => updateStr(e.target.value));

        topRow.appendChild(activeCheck);
        topRow.appendChild(loraLbl);
        topRow.appendChild(strSlider);
        topRow.appendChild(strNum);

        const botRow = document.createElement("div");
        botRow.className = "h3-row";

        const nameSelect = createSearchableSelect({
            placeholder: "Filter LoRAs...",
            onChange: (val) => ctx.stateManager.updateActiveShot(`lora_${num}`, val)
        });

        botRow.appendChild(nameSelect.element);

        row.appendChild(topRow);
        row.appendChild(botRow);

        return { row, activeCheck, nameSelect, strSlider, strNum };
    };

    const l1 = createLoraControls(1);
    const l2 = createLoraControls(2);
    settingsAcc.content.appendChild(l1.row);
    settingsAcc.content.appendChild(l2.row);
    shotFrame.appendChild(settingsAcc.wrapper);

    rightCol.appendChild(shotFrame);

    // ==========================================
    // BOTTOM ACTION ROW: SPLIT GENERATE + COUNT + ALL IN TIMELINE
    // ==========================================
    let modeOverride = null; // null = Auto, or "Start" | "Single" | "Continue" | "Lead" | "Bridge"

    const actionRow = document.createElement("div");
    actionRow.className = "h3-row";
    actionRow.style.marginTop = "auto";
    actionRow.style.gap = "6px";
    actionRow.style.alignItems = "center";

    const splitWrap = document.createElement("div");
    splitWrap.style.position = "relative";
    splitWrap.style.display = "flex";
    splitWrap.style.flex = "1";
    splitWrap.style.minWidth = "0";

    const genBtn = document.createElement("button");
    genBtn.className = "h3-btn h3-btn-generate";
    genBtn.style.flex = "1";
    genBtn.style.flexDirection = "column";
    genBtn.style.justifyContent = "center";
    genBtn.style.alignItems = "center";
    genBtn.style.lineHeight = "1.15";
    genBtn.style.whiteSpace = "nowrap";
    genBtn.style.padding = "4px 6px";
    genBtn.style.borderTopRightRadius = "0";
    genBtn.style.borderBottomRightRadius = "0";
    genBtn.title = "Left-click to Generate, right-click to choose mode";

    const formatGenButtonHtml = (mode) => {
        if (!mode) {
            return `<span>GENERATE</span><span style="font-size:9px;font-weight:600;opacity:0.9;">TAKE</span>`;
        }
        const display = mode === "Lead" ? "LEAD-IN" : mode.toUpperCase();
        return `<span>GENERATE</span><span style="font-size:9px;font-weight:700;opacity:0.95;">(${display})</span>`;
    };

    genBtn.innerHTML = formatGenButtonHtml(null);

    const modeDropBtn = document.createElement("button");
    modeDropBtn.type = "button";
    modeDropBtn.className = "h3-btn h3-btn-generate";
    modeDropBtn.style.padding = "0 10px";
    modeDropBtn.style.borderTopLeftRadius = "0";
    modeDropBtn.style.borderBottomLeftRadius = "0";
    modeDropBtn.style.borderLeft = "1px solid rgba(0,0,0,0.35)";
    modeDropBtn.innerText = "▴";
    modeDropBtn.title = "Choose generation mode";
    modeDropBtn.addEventListener("mousedown", preventEvents);

    const modeMenu = document.createElement("div");
    modeMenu.style.display = "none";
    modeMenu.style.position = "absolute";
    modeMenu.style.bottom = "calc(100% + 4px)";
    modeMenu.style.left = "0";
    modeMenu.style.right = "0";
    modeMenu.style.background = "var(--h3-bg-panel, #181818)";
    modeMenu.style.border = "1px solid var(--h3-border-strong, #444)";
    modeMenu.style.borderRadius = "4px";
    modeMenu.style.boxShadow = "0 4px 14px rgba(0,0,0,0.6)";
    modeMenu.style.zIndex = "50";
    modeMenu.style.padding = "3px";
    modeMenu.style.flexDirection = "column";
    modeMenu.style.gap = "2px";
    modeMenu.addEventListener("mousedown", preventEvents);

    const takeCountInput = document.createElement("input");
    takeCountInput.type = "number";
    takeCountInput.className = "h3-input h3-input-num";
    takeCountInput.min = "1";
    takeCountInput.max = "8";
    takeCountInput.step = "1";
    takeCountInput.value = "1";
    takeCountInput.title = "Number of takes to generate (takes 2+ use random seeds)";
    takeCountInput.style.width = "40px";
    takeCountInput.style.flex = "0 0 auto";
    takeCountInput.style.textAlign = "center";
    takeCountInput.style.padding = "4px 2px";
    takeCountInput.addEventListener("mousedown", preventEvents);
    takeCountInput.addEventListener("keydown", preventEvents);

    const getTakeCount = () => {
        const parsed = parseInt(takeCountInput.value, 10);
        if (isNaN(parsed) || parsed < 1) return 1;
        return Math.min(8, parsed);
    };

    const allInTimelineLabel = document.createElement("label");
    allInTimelineLabel.style.display = "flex";
    allInTimelineLabel.style.alignItems = "center";
    allInTimelineLabel.style.gap = "4px";
    allInTimelineLabel.style.fontSize = "10px";
    allInTimelineLabel.style.color = "var(--h3-text-secondary, #aaa)";
    allInTimelineLabel.style.whiteSpace = "nowrap";
    allInTimelineLabel.style.cursor = "pointer";
    allInTimelineLabel.addEventListener("mousedown", preventEvents);

    const allInTimelineText = document.createElement("span");
    allInTimelineText.innerText = "All in Timeline";

    const allInTimelineCheck = document.createElement("input");
    allInTimelineCheck.type = "checkbox";
    allInTimelineCheck.style.margin = "0";
    allInTimelineCheck.addEventListener("mousedown", preventEvents);

    allInTimelineLabel.appendChild(allInTimelineText);
    allInTimelineLabel.appendChild(allInTimelineCheck);

    const syncAllInTimelineState = () => {
        const count = getTakeCount();
        const disableAll = count > 1;
        if (disableAll) {
            allInTimelineCheck.checked = false;
        }
        allInTimelineCheck.disabled = disableAll;
        allInTimelineLabel.style.opacity = disableAll ? "0.45" : "1";
        allInTimelineLabel.style.cursor = disableAll ? "not-allowed" : "pointer";
    };

    takeCountInput.addEventListener("input", syncAllInTimelineState);
    takeCountInput.addEventListener("change", () => {
        takeCountInput.value = String(getTakeCount());
        syncAllInTimelineState();
    });

    const getAvailableModes = (idx) => {
        const shots = ctx.stateManager.getVisibleShots();
        const hasPrev = idx > 0 && ctx.stateManager.hasGeneratedTake(shots[idx - 1]);
        const hasNext = idx >= 0 && idx < shots.length - 1 && ctx.stateManager.hasGeneratedTake(shots[idx + 1]);
        return {
            Auto: true,
            Start: true,
            Single: true,
            Continue: hasPrev,
            Lead: hasNext,
            Bridge: hasPrev && hasNext
        };
    };

    const getResolvedGenerateMode = () => {
        const idx = ctx.stateManager.selectedShotIndex;
        if (idx < 0) return null;
        const avail = getAvailableModes(idx);
        if (modeOverride && avail[modeOverride]) return modeOverride;
        modeOverride = null;
        return ctx.stateManager.detectShotMode(idx);
    };

    const renderModeMenu = () => {
        modeMenu.innerHTML = "";
        const idx = ctx.stateManager.selectedShotIndex;
        if (idx < 0) return;

        const avail = getAvailableModes(idx);
        const autoMode = ctx.stateManager.detectShotMode(idx);
        const items = [
            { value: null, label: `Auto (${autoMode === "Lead" ? "Lead-In" : autoMode})`, enabled: true },
            { value: "Start", label: "Start (New Sequence)", enabled: avail.Start },
            { value: "Single", label: "Single (Standalone Cut)", enabled: avail.Single },
            { value: "Continue", label: "Continue (From Prev)", enabled: avail.Continue },
            { value: "Lead", label: "Lead-In (Into Next)", enabled: avail.Lead },
            { value: "Bridge", label: "Bridge (Prev ↔ Next)", enabled: avail.Bridge }
        ];

        items.forEach((item) => {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.disabled = !item.enabled;
            const isSelected = modeOverride === item.value;
            btn.style.display = "flex";
            btn.style.alignItems = "center";
            btn.style.justifyContent = "space-between";
            btn.style.width = "100%";
            btn.style.padding = "4px 8px";
            btn.style.border = "none";
            btn.style.borderRadius = "3px";
            btn.style.fontSize = "10px";
            btn.style.textAlign = "left";
            btn.style.cursor = item.enabled ? "pointer" : "not-allowed";
            btn.style.background = isSelected ? "rgba(79, 209, 255, 0.2)" : "transparent";
            btn.style.color = !item.enabled
                ? "var(--h3-text-disabled, #555)"
                : (isSelected ? "var(--h3-accent-cyan, #4fd1ff)" : "var(--h3-text-primary, #ddd)");
            btn.innerText = item.label;

            btn.addEventListener("click", (e) => {
                e.stopPropagation();
                if (!item.enabled) return;
                modeOverride = item.value;
                modeMenu.style.display = "none";
                if (!ctx.executionEngine?.getIsRendering?.()) {
                    genBtn.innerHTML = formatGenButtonHtml(getResolvedGenerateMode());
                }
            });
            modeMenu.appendChild(btn);
        });
    };

    const toggleModeMenu = () => {
        if (ctx.executionEngine.getIsRendering() || ctx.stateManager.selectedShotIndex < 0) return;
        const isOpen = modeMenu.style.display === "flex";
        if (isOpen) {
            modeMenu.style.display = "none";
        } else {
            renderModeMenu();
            modeMenu.style.display = "flex";
        }
    };

    modeDropBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        toggleModeMenu();
    });

    genBtn.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleModeMenu();
    });

    window.addEventListener("mousedown", () => {
        modeMenu.style.display = "none";
    });

    splitWrap.appendChild(genBtn);
    splitWrap.appendChild(modeDropBtn);
    splitWrap.appendChild(modeMenu);

    actionRow.appendChild(splitWrap);
    actionRow.appendChild(takeCountInput);
    actionRow.appendChild(allInTimelineLabel);
    rightCol.appendChild(actionRow);

    genBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        modeMenu.style.display = "none";
        if (ctx.executionEngine.getIsRendering()) {
            if (ctx.executionEngine.getRenderingMode() !== "Stitch") {
                ctx.executionEngine.cancelGeneration();
            }
            return;
        }

        const count = getTakeCount();
        if (count === 1 && allInTimelineCheck.checked) {
            const visibleShots = ctx.stateManager.getVisibleShots();
            const pendingIndices = [];
            visibleShots.forEach((shot, i) => {
                if (!shot.takes || shot.takes.length === 0 || shot.approved_take === null) {
                    pendingIndices.push(i);
                }
            });

            if (pendingIndices.length === 0) {
                alert("All shots in the timeline already have generated takes.");
                return;
            }

            ctx.executionEngine.executePendingQueue(pendingIndices);
            return;
        }

        const idx = ctx.stateManager.selectedShotIndex;
        if (idx < 0) return;
        const mode = getResolvedGenerateMode();
        ctx.executionEngine.executeTakeBatch(mode, idx, count);
    });

    const setGeneratingVisual = (isRendering, mode = null) => {
        modeMenu.style.display = "none";
        if (isRendering && mode !== "Stitch") {
            genBtn.style.background = "var(--h3-accent-red, #e53935)";
            genBtn.style.borderColor = "#ff6b6b";
            genBtn.style.color = "#ffffff";
            genBtn.innerHTML = `<span>Cancel Generation</span>`;
            genBtn.disabled = false;
            modeDropBtn.disabled = true;
            takeCountInput.disabled = true;
        } else {
            genBtn.style.background = "";
            genBtn.style.borderColor = "";
            genBtn.style.color = "";
            genBtn.innerHTML = formatGenButtonHtml(getResolvedGenerateMode());
            const dis = isRendering || ctx.stateManager.selectedShotIndex < 0;
            genBtn.disabled = dis;
            modeDropBtn.disabled = dis;
            takeCountInput.disabled = dis;
        }
    };

    // ==========================================
    // SYNC LOGIC
    // ==========================================
    const populateLoras = () => {
        const list = ["None", ...(ctx.stateManager.options.loras || [])];
        const shot = ctx.stateManager.getActiveShot();
        l1.nameSelect.setOptions(list, shot?.lora_1 || "None");
        l2.nameSelect.setOptions(list, shot?.lora_2 || "None");
    };

    const disablePanel = (disable) => {
        promptInput.disabled = disable;
        durSlider.disabled = disable;
        durNum.disabled = disable;
        seedInput.disabled = disable;
        randSeedBtn.disabled = disable;
        l1.activeCheck.disabled = disable;
        l1.nameSelect.setDisabled(disable);
        l1.strSlider.disabled = disable;
        l1.strNum.disabled = disable;
        l2.activeCheck.disabled = disable;
        l2.nameSelect.setDisabled(disable);
        l2.strSlider.disabled = disable;
        l2.strNum.disabled = disable;
        if (disable) revertBtn.disabled = true;
        if (!ctx.executionEngine?.getIsRendering?.()) {
            genBtn.disabled = disable;
            modeDropBtn.disabled = disable;
            takeCountInput.disabled = disable;
        }
        shotFrame.style.opacity = disable ? "0.5" : "1";
        if (disable) {
            activeShotText.innerText = "No Shot Selected";
            modelVariantBadge.style.display = "none";
            modelVariantBadge.innerText = "";
            promptInput.value = "";
        }
    };

    const syncUI = () => {
        const shot = ctx.stateManager.getActiveShot();
        if (!shot) {
            disablePanel(true);
            return;
        }

        disablePanel(false);
        revertBtn.disabled = !ctx.stateManager.getActiveTake(shot);

        const takeNum = shot.approved_take !== null && shot.approved_take !== undefined
            ? String(shot.approved_take).padStart(3, "0")
            : "---";
        activeShotText.innerText = `${shot.id}, Take${takeNum}`;

        const variant = ctx.stateManager.getModelVariantLabel();
        modelVariantBadge.innerText = variant;
        modelVariantBadge.style.color = variant === "REF2VA"
            ? "var(--h3-accent-amber, #ff9f43)"
            : "var(--h3-accent-cyan, #4fd1ff)";
        modelVariantBadge.style.display = "inline";

        if (!ctx.executionEngine?.getIsRendering?.()) {
            genBtn.innerHTML = formatGenButtonHtml(getResolvedGenerateMode());
        }

        promptInput.value = shot.prompt || "";

        const frames = shot.duration_frames !== undefined ? shot.duration_frames : 124;
        durSlider.value = frames;
        durNum.value = frames;
        durSecLbl.innerText = `${(frames / 24.0).toFixed(2)}s`;

        seedInput.value = shot.seed !== undefined ? shot.seed : 123456789;

        l1.activeCheck.checked = shot.active_1;
        l1.nameSelect.setValue(shot.lora_1 || "None");
        const s1 = shot.lora_strength_1 !== undefined ? shot.lora_strength_1 : 0;
        l1.strSlider.value = s1;
        l1.strNum.value = s1;

        l2.activeCheck.checked = shot.active_2;
        l2.nameSelect.setValue(shot.lora_2 || "None");
        const s2 = shot.lora_strength_2 !== undefined ? shot.lora_strength_2 : 0;
        l2.strSlider.value = s2;
        l2.strNum.value = s2;

        syncRefModeAndSlots(shot);
    };

    ctx.stateManager.subscribe((event, _sm, payload) => {
        if (event === EVENTS.OPTIONS_LOADED) {
            populateLoras();
            syncUI();
        } else if (event === EVENTS.RENDER_STATE_CHANGED) {
            setGeneratingVisual(Boolean(payload?.isRendering), payload?.mode);
        } else if ([
            EVENTS.PROJECT_LOADED,
            EVENTS.GLOBAL_UPDATED,
            EVENTS.SHOT_ADDED,
            EVENTS.SHOT_DELETED,
            EVENTS.HISTORY_RESTORED,
            EVENTS.SHOT_SELECTED,
            EVENTS.SHOT_UPDATED,
            EVENTS.TAKE_ADDED,
            EVENTS.TAKE_APPROVED,
            EVENTS.TAKE_DELETED,
            EVENTS.BRANCH_SELECTED
        ].includes(event)) {
            if ([
                EVENTS.PROJECT_LOADED,
                EVENTS.SHOT_ADDED,
                EVENTS.SHOT_DELETED,
                EVENTS.HISTORY_RESTORED,
                EVENTS.SHOT_SELECTED
            ].includes(event)) {
                modeOverride = null;
            }
            syncUI();
        }
    });

    syncAllInTimelineState();
    disablePanel(true);

    return {
        element: rightCol,
        isAllInTimelineChecked: () => allInTimelineCheck.checked
    };
}