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
    const createDnDZone = (label, stateKey) => {
        const zone = document.createElement("div");
        zone.className = "h3-dnd-zone";
        zone.style.flex = "1";
        zone.style.minWidth = "0";

        const text = document.createElement("span");
        text.innerText = label;
        zone.appendChild(text);

        const imgPreview = document.createElement("img");
        imgPreview.className = "h3-dnd-image-preview";
        imgPreview.style.display = "none";
        zone.appendChild(imgPreview);

        zone.addEventListener("dragover", (e) => {
            e.preventDefault();
            zone.classList.add("dragover");
        });
        zone.addEventListener("dragleave", (e) => {
            e.preventDefault();
            zone.classList.remove("dragover");
        });
        zone.addEventListener("drop", (e) => {
            e.preventDefault();
            zone.classList.remove("dragover");
            const file = e.dataTransfer.files[0];
            if (!file || !file.type.startsWith("image/")) return;

            const reader = new FileReader();
            reader.onload = async (ev) => {
                const b64 = ev.target.result;
                text.innerText = "Uploading...";

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
                    text.innerText = "Upload Failed";
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
            ctx.stateManager.updateActiveShot(stateKey, "");
            imgPreview.src = "";
            imgPreview.style.display = "none";
            text.style.display = "inline";
            text.innerText = label;
            clearBtn.style.display = "none";
        });
        zone.appendChild(clearBtn);

        return { zone, imgPreview, text, clearBtn, defaultLabel: label };
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

    activeShotLabel.appendChild(iconWrapper);
    activeShotLabel.appendChild(activeShotText);

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

    // Prompt (auto-fills remaining vertical space when accordions are collapsed)
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
    // START & END IMAGES
    // ==========================================
    const imgAcc = createAccordion("Start & End Images", Icons.ICON_IMAGE, false);
    const imgRow = document.createElement("div");
    imgRow.className = "h3-row";
    imgRow.style.gap = "6px";

    const dndFirst = createDnDZone("First Frame", "first_frame");
    const dndLast = createDnDZone("Last Frame", "last_frame");
    imgRow.appendChild(dndFirst.zone);
    imgRow.appendChild(dndLast.zone);
    imgAcc.content.appendChild(imgRow);
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
    // BOTTOM ACTION ROW: GENERATE / CANCEL + ALL IN TIMELINE
    // ==========================================
    const actionRow = document.createElement("div");
    actionRow.className = "h3-row";
    actionRow.style.marginTop = "auto";
    actionRow.style.gap = "8px";
    actionRow.style.alignItems = "center";

    const genBtn = document.createElement("button");
    genBtn.className = "h3-btn h3-btn-generate";
    genBtn.style.flex = "1";
    genBtn.style.justifyContent = "center";
    genBtn.innerHTML = `${Icons.ICON_GENERATE} <span>GENERATE TAKE</span>`;

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

    actionRow.appendChild(genBtn);
    actionRow.appendChild(allInTimelineLabel);
    rightCol.appendChild(actionRow);

    const getIdleGenerateLabel = () => {
        const idx = ctx.stateManager.selectedShotIndex;
        if (idx < 0) return "GENERATE TAKE";
        const mode = ctx.stateManager.detectShotMode(idx);
        return `GENERATE (${mode.toUpperCase()})`;
    };

    genBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (ctx.executionEngine.getIsRendering()) {
            if (ctx.executionEngine.getRenderingMode() !== "Stitch") {
                ctx.executionEngine.cancelGeneration();
            }
            return;
        }

        if (allInTimelineCheck.checked) {
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
        const mode = ctx.stateManager.detectShotMode(idx);
        ctx.executionEngine.executeWorkflow(mode, idx);
    });

    const setGeneratingVisual = (isRendering, mode = null) => {
        if (isRendering && mode !== "Stitch") {
            genBtn.style.background = "var(--h3-accent-red, #e53935)";
            genBtn.style.borderColor = "#ff6b6b";
            genBtn.style.color = "#ffffff";
            genBtn.innerHTML = `<span>Cancel Generation</span>`;
            genBtn.disabled = false;
        } else {
            genBtn.style.background = "";
            genBtn.style.borderColor = "";
            genBtn.style.color = "";
            genBtn.innerHTML = `${Icons.ICON_GENERATE} <span>${getIdleGenerateLabel()}</span>`;
            genBtn.disabled = isRendering || ctx.stateManager.selectedShotIndex < 0;
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
        }
        shotFrame.style.opacity = disable ? "0.5" : "1";
        if (disable) {
            activeShotText.innerText = "No Shot Selected";
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

        if (!ctx.executionEngine?.getIsRendering?.()) {
            genBtn.innerHTML = `${Icons.ICON_GENERATE} <span>${getIdleGenerateLabel()}</span>`;
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

        const setDndState = (dnd, path) => {
            if (path) {
                dnd.text.style.display = "none";
                dnd.imgPreview.style.display = "block";
                dnd.imgPreview.src = `/h3_wrapper/view_media?path=${encodeURIComponent(path)}&t=${Date.now()}`;
                dnd.clearBtn.style.display = "block";
            } else {
                dnd.text.style.display = "inline";
                dnd.text.innerText = dnd.defaultLabel;
                dnd.imgPreview.style.display = "none";
                dnd.imgPreview.src = "";
                dnd.clearBtn.style.display = "none";
            }
        };

        setDndState(dndFirst, shot.first_frame);
        setDndState(dndLast, shot.last_frame);
    };

    ctx.stateManager.subscribe((event, _sm, payload) => {
        if (event === EVENTS.OPTIONS_LOADED) {
            populateLoras();
            syncUI();
        } else if (event === EVENTS.RENDER_STATE_CHANGED) {
            setGeneratingVisual(Boolean(payload?.isRendering), payload?.mode);
        } else if ([
            EVENTS.PROJECT_LOADED,
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
            syncUI();
        }
    });

    disablePanel(true);

    return {
        element: rightCol,
        isAllInTimelineChecked: () => allInTimelineCheck.checked
    };
}