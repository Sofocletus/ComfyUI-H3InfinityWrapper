import * as Icons from "./icons.js";
import { EVENTS } from "./StateManager.js";
import { createBranchGraph } from "./UI_BranchGraph.js";

export function createGallery(ctx) {
    const galleryStrip = document.createElement("div");
    galleryStrip.className = "h3-gallery-strip";
    galleryStrip.style.display = "flex";
    galleryStrip.style.alignItems = "stretch";
    galleryStrip.style.height = "124px";
    galleryStrip.style.minHeight = "124px";
    galleryStrip.style.padding = "0";
    galleryStrip.style.gap = "0";
    galleryStrip.style.overflow = "hidden";

    const stopProp = (e) => e.stopPropagation();
    galleryStrip.addEventListener("mousedown", stopProp);
    galleryStrip.addEventListener("wheel", stopProp, { passive: true });

    let activeTab = "takes"; // "takes" | "refs" | "clips"
    let referenceImagesCache = [];
    let videoClipsCache = [];
    let selectedClipFilename = null;
    let isConforming = false;

    // SECTION 1 (LEFT): TABS + SHOT/LINEAGE/CLIP INFO PANEL (103px)
    const infoPanel = document.createElement("div");
    infoPanel.style.width = "103px";
    infoPanel.style.flexShrink = "0";
    infoPanel.style.padding = "5px 6px";
    infoPanel.style.borderRight = "1px solid var(--h3-border-subtle, #2a2a2a)";
    infoPanel.style.background = "var(--h3-bg-panel, #141414)";
    infoPanel.style.display = "flex";
    infoPanel.style.flexDirection = "column";
    infoPanel.style.justifyContent = "flex-start";
    infoPanel.style.gap = "3px";
    infoPanel.style.boxSizing = "border-box";
    infoPanel.style.fontSize = "10px";
    infoPanel.style.fontFamily = "monospace";

    // SECTION 2 (CENTER): TAB CONTENT STRIP
    const contentContainer = document.createElement("div");
    contentContainer.style.flex = "1";
    contentContainer.style.minWidth = "0";
    contentContainer.style.display = "flex";
    contentContainer.style.alignItems = "center";
    contentContainer.style.gap = "8px";
    contentContainer.style.padding = "6px 10px";
    contentContainer.style.overflowX = "auto";
    contentContainer.style.overflowY = "hidden";

    // SECTION 3 (RIGHT): BRANCH GRAPH + STITCH (500px)
    const graphContainer = document.createElement("div");
    graphContainer.style.width = "500px";
    graphContainer.style.flexShrink = "0";
    graphContainer.style.height = "100%";
    graphContainer.style.overflow = "hidden";

    const branchGraph = createBranchGraph(ctx);
    ctx.components.branchGraph = branchGraph;
    graphContainer.appendChild(branchGraph.element);

    galleryStrip.appendChild(infoPanel);
    galleryStrip.appendChild(contentContainer);
    galleryStrip.appendChild(graphContainer);

    const fetchReferenceImages = async () => {
        const proj = ctx.stateManager.state?.project_name || "DefaultProject";
        try {
            const resp = await fetch(`/h3_wrapper/list_reference_images?project_name=${encodeURIComponent(proj)}`);
            const data = await resp.json();
            if (data.status === "success" && Array.isArray(data.images)) {
                referenceImagesCache = data.images;
            }
        } catch (err) {
            console.error("H3 Wrapper: Error fetching reference images", err);
        }
    };

    const fetchVideoClips = async () => {
        const g = ctx.stateManager.state?.global || {};
        const proj = ctx.stateManager.state?.project_name || "DefaultProject";
        const w = g.width || 864;
        const h = g.height || 480;
        try {
            const resp = await fetch(
                `/h3_wrapper/list_video_clips?project_name=${encodeURIComponent(proj)}&width=${w}&height=${h}`
            );
            const data = await resp.json();
            if (data.status === "success" && Array.isArray(data.clips)) {
                videoClipsCache = data.clips;
                if (!selectedClipFilename && videoClipsCache.length > 0) {
                    selectedClipFilename = videoClipsCache[0].filename;
                }
            }
        } catch (err) {
            console.error("H3 Wrapper: Error fetching video clips", err);
        }
    };

    const runConformSelectedClip = async () => {
        const clip = videoClipsCache.find(c => c.filename === selectedClipFilename) || videoClipsCache[0];
        if (!clip || isConforming) return;

        const g = ctx.stateManager.state?.global || {};
        const proj = ctx.stateManager.state?.project_name || "DefaultProject";
        const targetW = g.width || 864;
        const targetH = g.height || 480;
        isConforming = true;
        renderGallery();
        ctx.components.centerPlayer?.setStatusText?.(`Conforming ${clip.filename}...`, "var(--h3-accent-amber)");

        try {
            const resp = await fetch("/h3_wrapper/test_execute", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    project_name: proj,
                    mode: "Conform",
                    clip_path: clip.file_path,
                    base_name: clip.base_name,
                    width: targetW,
                    height: targetH
                })
            });
            const resData = await resp.json();
            if (resData.error) throw new Error(resData.error);

            const queueResp = await fetch("/prompt", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ prompt: resData.workflow, client_id: ctx.api.clientId })
            });
            const queueData = await queueResp.json();
            if (queueData.error) throw new Error(queueData.error);

            const waitForIdle = () => new Promise((resolve) => {
                const onStatus = async (ev) => {
                    if (ev.detail?.exec_info?.queue_remaining === 0) {
                        ctx.api.removeEventListener("status", onStatus);
                        resolve();
                    }
                };
                ctx.api.addEventListener("status", onStatus);
            });

            await waitForIdle();

            const finResp = await fetch("/h3_wrapper/finalize_conform", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    project_name: proj,
                    source_path: clip.file_path,
                    base_name: clip.base_name,
                    width: targetW,
                    height: targetH
                })
            });
            const finData = await finResp.json();
            if (finData.filename) {
                selectedClipFilename = finData.filename;
            }

            await fetchVideoClips();
            if (finData.short_clip_warning || (typeof finData.frame_count === "number" && finData.frame_count < 39)) {
                alert("Short clip warning: this clip has fewer than 39 frames. If continuing from it, use < 39 context frames (e.g. 22) to avoid ~8.3 ms audio rounding.");
            }
            ctx.components.centerPlayer?.setStatusText?.("Conform Complete", "var(--h3-accent-green)");
        } catch (err) {
            console.error("H3 Wrapper: Error conforming clip", err);
            ctx.components.centerPlayer?.setStatusText?.("Conform Error", "var(--h3-accent-red)");
        } finally {
            isConforming = false;
            renderGallery();
        }
    };

    const addClipToTimeline = async (clip, insertBeforeSelected = false) => {
        if (!clip || !clip.conformed) return;

        if (clip.short_clip_warning || (typeof clip.frame_count === "number" && clip.frame_count < 39)) {
            alert("Short clip warning: this clip has fewer than 39 frames. If continuing from it, use < 39 context frames (e.g. 22) to avoid ~8.3 ms audio rounding.");
        }

        const sm = ctx.stateManager;
        sm.pushHistory();

        const currentIdx = sm.selectedShotIndex >= 0 ? sm.selectedShotIndex : 0;
        const targetIdx = insertBeforeSelected
            ? currentIdx
            : Math.min(sm.state.shots.length, currentIdx + 1);

        const refShot = sm.state.shots[targetIdx] || sm.state.shots[targetIdx - 1] || null;
        const newShot = sm._createShotObject(refShot);
        newShot.prompt = `[Clip] ${clip.base_name}`;

        sm.state.shots.splice(targetIdx, 0, newShot);
        sm.visibleShotCount = Math.min(sm.state.shots.length, (sm.visibleShotCount || 0) + 1);
        sm.selectedShotIndex = targetIdx;

        try {
            const resp = await fetch("/h3_wrapper/insert_clip_to_shot", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    project_name: sm.state.project_name,
                    shot_id: newShot.id,
                    clip_mp4: clip.file_path,
                    clip_latent: clip.latent_path,
                    base_name: clip.base_name
                })
            });
            const data = await resp.json();
            if (data.status === "success") {
                newShot.takes.push({
                    take_num: 1,
                    mode: "Start",
                    ref2v_mode: false,
                    preview_path: data.preview_path,
                    prompt: newShot.prompt,
                    seed: 0,
                    duration_frames: newShot.duration_frames
                });
                newShot.approved_take = 1;
            }
        } catch (err) {
            console.error("H3 Wrapper: Error inserting clip into shot", err);
        }

        sm.notify(EVENTS.SHOT_ADDED);
        sm.saveProject(true);
    };

    const renderTabBar = () => {
        const bar = document.createElement("div");
        bar.style.display = "flex";
        bar.style.alignItems = "center";
        bar.style.justifyContent = "space-between";
        bar.style.gap = "3px";
        bar.style.width = "100%";
        bar.style.paddingBottom = "3px";
        bar.style.borderBottom = "1px solid var(--h3-border-subtle, #2a2a2a)";

        const tabs = [
            { id: "takes", icon: Icons.ICON_CLAPPERBOARD, title: "Takes" },
            { id: "refs", icon: Icons.ICON_IMAGE, title: "Reference Images" },
            { id: "clips", icon: Icons.ICON_VIDEO, title: "Clips" }
        ];

        tabs.forEach((t) => {
            const isOn = activeTab === t.id;
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "h3-icon-btn small";
            btn.title = t.title;
            btn.innerHTML = t.icon;
            btn.style.flex = "1";
            btn.style.display = "flex";
            btn.style.alignItems = "center";
            btn.style.justifyContent = "center";
            btn.style.padding = "3px 0";
            btn.style.color = isOn ? "var(--h3-accent-cyan, #4fd1ff)" : "var(--h3-text-dim, #666)";
            btn.style.background = isOn ? "rgba(79, 209, 255, 0.14)" : "transparent";
            btn.style.borderColor = isOn ? "var(--h3-accent-cyan, #4fd1ff)" : "var(--h3-border-subtle, #333)";
            btn.style.opacity = isOn ? "1" : "0.65";

            btn.addEventListener("click", async (e) => {
                e.stopPropagation();
                if (activeTab === t.id) return;
                activeTab = t.id;
                if (activeTab === "refs") {
                    await fetchReferenceImages();
                } else if (activeTab === "clips") {
                    await fetchVideoClips();
                }
                renderGallery();
            });

            bar.appendChild(btn);
        });

        return bar;
    };

    const renderInfoPanel = (shotIndex, shot) => {
        infoPanel.innerHTML = "";
        infoPanel.appendChild(renderTabBar());

        if (activeTab === "refs") {
            const refInfo = document.createElement("div");
            refInfo.style.marginTop = "4px";
            refInfo.style.color = "var(--h3-text-secondary, #aaa)";
            refInfo.style.fontSize = "9px";
            refInfo.style.lineHeight = "1.35";
            refInfo.innerHTML = `
                <div style="color:var(--h3-accent-cyan,#4fd1ff);font-weight:700;margin-bottom:2px;">Ref Images</div>
                <div>G: Global Ref</div>
                <div>S: Shot Ref</div>
            `;
            infoPanel.appendChild(refInfo);
            return;
        }

        if (activeTab === "clips") {
            const clipInfo = document.createElement("div");
            clipInfo.style.marginTop = "2px";
            clipInfo.style.color = "var(--h3-text-secondary, #aaa)";
            clipInfo.style.fontSize = "9px";
            clipInfo.innerText = selectedClipFilename || "No Clip";
            clipInfo.style.overflow = "hidden";
            clipInfo.style.textOverflow = "ellipsis";
            clipInfo.style.whiteSpace = "nowrap";
            infoPanel.appendChild(clipInfo);

            const conformBtn = document.createElement("button");
            conformBtn.type = "button";
            conformBtn.className = "h3-btn h3-btn-subtle h3-btn-blue";
            conformBtn.style.marginTop = "auto";
            conformBtn.style.width = "100%";
            conformBtn.style.justifyContent = "center";
            conformBtn.style.fontSize = "9px";
            conformBtn.style.padding = "4px 4px";
            conformBtn.innerText = isConforming ? "Conforming..." : "Conform";
            conformBtn.disabled = isConforming || videoClipsCache.length === 0;
            conformBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                runConformSelectedClip();
            });
            infoPanel.appendChild(conformBtn);
            return;
        }

        if (!shot) {
            const noShot = document.createElement("div");
            noShot.style.color = "var(--h3-text-disabled, #666)";
            noShot.style.textAlign = "center";
            noShot.style.marginTop = "8px";
            noShot.innerText = "No Shot";
            infoPanel.appendChild(noShot);
            return;
        }

        const shotNumLabel = document.createElement("div");
        shotNumLabel.style.fontSize = "10px";
        shotNumLabel.style.fontWeight = "700";
        shotNumLabel.style.textAlign = "center";
        shotNumLabel.style.width = "100%";
        shotNumLabel.style.color = "var(--h3-accent-cyan, #4fd1ff)";
        shotNumLabel.innerText = `Shot ${String(shotIndex + 1).padStart(2, "0")}`;
        infoPanel.appendChild(shotNumLabel);

        const mode = ctx.stateManager.getShotDisplayMode(shotIndex);
        const modeColors = {
            Start: "#4fd1ff",
            Continue: "#2ed573",
            Lead: "#ff9f43",
            Bridge: "#a29bfe"
        };
        const shotModeLabel = document.createElement("div");
        shotModeLabel.style.fontSize = "9px";
        shotModeLabel.style.fontWeight = "600";
        shotModeLabel.style.textAlign = "center";
        shotModeLabel.style.width = "100%";
        shotModeLabel.style.color = modeColors[mode] || "var(--h3-text-secondary, #aaa)";
        shotModeLabel.innerText = `(${mode})`;
        infoPanel.appendChild(shotModeLabel);

        const shotTitle = document.createElement("div");
        shotTitle.style.fontSize = "9px";
        shotTitle.style.fontWeight = "500";
        shotTitle.style.textAlign = "center";
        shotTitle.style.width = "100%";
        shotTitle.style.color = "var(--h3-text-secondary, #aaa)";
        shotTitle.style.overflow = "hidden";
        shotTitle.style.textOverflow = "ellipsis";
        shotTitle.innerText = shot.id || "";
        shotTitle.title = shot.id || "";
        infoPanel.appendChild(shotTitle);

        const lineageWrap = document.createElement("div");
        lineageWrap.style.display = "flex";
        lineageWrap.style.flexDirection = "column";
        lineageWrap.style.gap = "2px";
        lineageWrap.style.marginTop = "2px";

        const activeTakeObj = (shot.takes || []).find(t => t.take_num === shot.approved_take);

        const fromRow = document.createElement("div");
        fromRow.style.color = "var(--h3-text-secondary, #aaa)";
        fromRow.style.whiteSpace = "nowrap";
        fromRow.style.overflow = "hidden";
        fromRow.style.textOverflow = "ellipsis";

        if (activeTakeObj) {
            const incoming = ctx.stateManager.getIncomingLinks(shotIndex, activeTakeObj.take_num);
            if (incoming.length > 0) {
                const prevLabel = `S${String(shotIndex).padStart(2, "0")}-${incoming.map(n => `T${String(n).padStart(2, "0")}`).join(",")}`;
                fromRow.innerHTML = `<span style="color:var(--h3-text-dim,#777);">From:</span> ${prevLabel}`;
                fromRow.title = `From: ${prevLabel}`;
            } else {
                fromRow.innerHTML = `<span style="color:var(--h3-text-dim,#777);">From:</span> Start`;
            }
        } else {
            fromRow.innerHTML = `<span style="color:var(--h3-text-dim,#777);">From:</span> --`;
        }
        lineageWrap.appendChild(fromRow);

        const nextRow = document.createElement("div");
        nextRow.style.color = "var(--h3-text-secondary, #aaa)";
        nextRow.style.whiteSpace = "nowrap";
        nextRow.style.overflow = "hidden";
        nextRow.style.textOverflow = "ellipsis";

        if (activeTakeObj) {
            const outgoing = ctx.stateManager.getOutgoingLinks(shotIndex, activeTakeObj.take_num);
            if (outgoing.length > 0) {
                const nextLabel = `S${String(shotIndex + 2).padStart(2, "0")}-${outgoing.map(n => `T${String(n).padStart(2, "0")}`).join(",")}`;
                nextRow.innerHTML = `<span style="color:var(--h3-text-dim,#777);">Next:</span> ${nextLabel}`;
                nextRow.title = `Next: ${nextLabel}`;
            } else {
                nextRow.innerHTML = `<span style="color:var(--h3-text-dim,#777);">Next:</span> None`;
            }
        } else {
            nextRow.innerHTML = `<span style="color:var(--h3-text-dim,#777);">Next:</span> None`;
        }
        lineageWrap.appendChild(nextRow);

        infoPanel.appendChild(lineageWrap);
    };

    const assignToFirstGlobalSlot = (filePath) => {
        const g = ctx.stateManager.state?.global;
        if (!g) return;
        for (let i = 1; i <= 4; i++) {
            const key = `global_ref_${i}`;
            if (!g[key]) {
                if (!g.global_ref_enabled) {
                    ctx.stateManager.updateGlobal("global_ref_enabled", true);
                }
                ctx.stateManager.updateGlobal(key, filePath);
                return;
            }
        }
    };

    const assignToFirstShotSlot = (filePath) => {
        const shot = ctx.stateManager.getActiveShot();
        if (!shot) return;
        const g = ctx.stateManager.state?.global || {};
        for (let i = 1; i <= 4; i++) {
            const shotKey = `ref_image_${i}`;
            const globalKey = `global_ref_${i}`;
            const blockedByGlobal = Boolean(g.global_ref_enabled) && Boolean(g[globalKey]);
            if (!blockedByGlobal && !shot[shotKey]) {
                ctx.stateManager.updateActiveShot(shotKey, filePath);
                return;
            }
        }
    };

    const renderTakesTab = (shots, shotIndex, shot, prevShot, nextShot) => {
        if (!shot) {
            const emptyText = document.createElement("div");
            emptyText.style.color = "var(--h3-text-disabled)";
            emptyText.style.margin = "auto";
            emptyText.style.fontSize = "11px";
            emptyText.innerText = "Select a shot in the timeline to view Takes.";
            contentContainer.appendChild(emptyText);
            return;
        }

        if (!shot.takes || shot.takes.length === 0) {
            const emptyText = document.createElement("div");
            emptyText.style.color = "var(--h3-text-disabled)";
            emptyText.style.margin = "auto";
            emptyText.style.fontSize = "11px";
            emptyText.innerText = `No takes generated for ${shot.id} yet.`;
            contentContainer.appendChild(emptyText);
            return;
        }

        shot.takes.forEach((take) => {
            const isApproved = shot.approved_take === take.take_num;
            const incoming = ctx.stateManager.getIncomingLinks(shotIndex, take.take_num);
            const hasPrevLink = incoming.length > 0;
            const hasNextLink = take.next_take !== undefined && take.next_take !== null;

            const prevMatches = !hasPrevLink || !prevShot || prevShot.approved_take === null || incoming.includes(prevShot.approved_take);
            const nextMatches = !hasNextLink || !nextShot || nextShot.approved_take === null || nextShot.approved_take === take.next_take;
            const isValidForBranch = prevMatches && nextMatches;

            const thumb = document.createElement("div");
            thumb.className = `h3-gallery-thumb${isApproved ? " approved" : ""}`;
            thumb.style.position = "relative";
            thumb.style.overflow = "hidden";
            thumb.style.opacity = isValidForBranch ? "1" : "0.38";

            const takeCode = `Take${String(take.take_num).padStart(3, "0")}`;
            thumb.title = takeCode;

            const selectTake = () => {
                if (!isValidForBranch || hasNextLink) {
                    ctx.stateManager.selectBranch(shotIndex, take.take_num);
                } else {
                    ctx.stateManager.approveTakeAndSync(shotIndex, take.take_num);
                }
            };

            const checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            checkbox.checked = isApproved;
            checkbox.style.position = "absolute";
            checkbox.style.top = "4px";
            checkbox.style.left = "4px";
            checkbox.style.zIndex = "3";
            checkbox.style.cursor = "pointer";
            checkbox.addEventListener("click", (e) => e.stopPropagation());
            checkbox.addEventListener("change", selectTake);

            const delBtn = document.createElement("button");
            delBtn.type = "button";
            delBtn.className = "h3-icon-btn small danger";
            delBtn.innerHTML = Icons.ICON_TRASH;
            delBtn.title = `Delete ${takeCode}`;
            delBtn.style.position = "absolute";
            delBtn.style.top = "3px";
            delBtn.style.right = "3px";
            delBtn.style.zIndex = "4";
            delBtn.style.width = "18px";
            delBtn.style.height = "18px";
            delBtn.style.padding = "0";
            delBtn.style.display = "flex";
            delBtn.style.alignItems = "center";
            delBtn.style.justifyContent = "center";
            delBtn.style.background = "rgba(0, 0, 0, 0.65)";
            delBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                if (confirm(`Delete ${takeCode} from Shot ${String(shotIndex + 1).padStart(2, "0")}?`)) {
                    ctx.stateManager.deleteTake(shotIndex, take.take_num);
                }
            });

            if (take.preview_path) {
                const vid = document.createElement("video");
                vid.src = `/h3_wrapper/view_media?path=${encodeURIComponent(take.preview_path)}`;
                vid.muted = true;
                vid.loop = true;
                vid.playsInline = true;
                vid.preload = "metadata";
                vid.style.position = "absolute";
                vid.style.top = "0";
                vid.style.left = "0";
                vid.style.width = "100%";
                vid.style.height = "100%";
                vid.style.objectFit = "cover";
                vid.style.display = "block";
                vid.style.pointerEvents = "none";

                thumb.addEventListener("mouseenter", () => {
                    vid.play().catch(() => {});
                });
                thumb.addEventListener("mouseleave", () => {
                    vid.pause();
                    vid.currentTime = 0;
                });

                thumb.appendChild(vid);
            } else {
                const thumbVisual = document.createElement("div");
                thumbVisual.style.width = "100%";
                thumbVisual.style.height = "100%";
                thumbVisual.style.display = "flex";
                thumbVisual.style.alignItems = "center";
                thumbVisual.style.justifyContent = "center";
                thumbVisual.style.color = "var(--h3-text-dim)";
                thumbVisual.innerHTML = Icons.ICON_FILM_PROJECT;
                thumb.appendChild(thumbVisual);
            }

            const bottomBar = document.createElement("div");
            bottomBar.style.position = "absolute";
            bottomBar.style.left = "0";
            bottomBar.style.right = "0";
            bottomBar.style.bottom = "0";
            bottomBar.style.zIndex = "3";
            bottomBar.style.display = "flex";
            bottomBar.style.alignItems = "baseline";
            bottomBar.style.justifyContent = "space-between";
            bottomBar.style.gap = "2px";
            bottomBar.style.padding = "2px 4px";
            bottomBar.style.background = "linear-gradient(transparent, rgba(0, 0, 0, 0.85))";
            bottomBar.style.fontFamily = "monospace";
            bottomBar.style.whiteSpace = "nowrap";
            bottomBar.style.pointerEvents = "none";

            const bothColor = "#a29bfe";
            const prevColor = (hasPrevLink && hasNextLink) ? bothColor : "#2ed573";
            const nextColor = (hasPrevLink && hasNextLink) ? bothColor : "#ff9f43";

            const prevSpan = document.createElement("span");
            prevSpan.style.fontSize = "8px";
            prevSpan.style.color = prevColor;
            prevSpan.innerText = hasPrevLink ? `<Take${String(incoming[0]).padStart(2, "0")}` : "";

            const centerSpan = document.createElement("span");
            centerSpan.style.fontSize = "10px";
            centerSpan.style.fontWeight = "800";
            centerSpan.style.color = "#ffffff";
            centerSpan.style.margin = "0 auto";
            centerSpan.innerText = takeCode;

            const nextSpan = document.createElement("span");
            nextSpan.style.fontSize = "8px";
            nextSpan.style.color = nextColor;
            nextSpan.innerText = hasNextLink ? `Take${String(take.next_take).padStart(2, "0")}>` : "";

            bottomBar.appendChild(prevSpan);
            bottomBar.appendChild(centerSpan);
            bottomBar.appendChild(nextSpan);

            thumb.appendChild(checkbox);
            thumb.appendChild(delBtn);
            thumb.appendChild(bottomBar);
            thumb.addEventListener("click", selectTake);

            contentContainer.appendChild(thumb);
        });
    };

    const renderRefsTab = () => {
        if (!referenceImagesCache || referenceImagesCache.length === 0) {
            const emptyText = document.createElement("div");
            emptyText.style.color = "var(--h3-text-disabled)";
            emptyText.style.margin = "auto";
            emptyText.style.fontSize = "11px";
            emptyText.innerText = "No images in referenceImages folder.";
            contentContainer.appendChild(emptyText);
            return;
        }

        referenceImagesCache.forEach((imgItem) => {
            const thumb = document.createElement("div");
            thumb.className = "h3-gallery-thumb";
            thumb.style.position = "relative";
            thumb.style.overflow = "hidden";
            thumb.title = imgItem.filename;

            const img = document.createElement("img");
            img.src = `/h3_wrapper/view_media?path=${encodeURIComponent(imgItem.file_path)}&t=${Date.now()}`;
            img.alt = imgItem.filename;
            img.style.position = "absolute";
            img.style.top = "0";
            img.style.left = "0";
            img.style.width = "100%";
            img.style.height = "100%";
            img.style.objectFit = "cover";
            img.style.display = "block";
            img.style.pointerEvents = "none";
            thumb.appendChild(img);

            const globalBtn = document.createElement("button");
            globalBtn.type = "button";
            globalBtn.className = "h3-icon-btn small";
            globalBtn.innerText = "G";
            globalBtn.title = "Send to first available Global Reference slot";
            globalBtn.style.position = "absolute";
            globalBtn.style.top = "3px";
            globalBtn.style.left = "3px";
            globalBtn.style.zIndex = "4";
            globalBtn.style.width = "16px";
            globalBtn.style.height = "16px";
            globalBtn.style.padding = "0";
            globalBtn.style.fontSize = "9px";
            globalBtn.style.fontWeight = "700";
            globalBtn.style.background = "rgba(0, 0, 0, 0.72)";
            globalBtn.style.color = "var(--h3-accent-cyan, #4fd1ff)";
            globalBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                assignToFirstGlobalSlot(imgItem.file_path);
            });

            const shotBtn = document.createElement("button");
            shotBtn.type = "button";
            shotBtn.className = "h3-icon-btn small";
            shotBtn.innerText = "S";
            shotBtn.title = "Send to first available Shot Reference slot";
            shotBtn.style.position = "absolute";
            shotBtn.style.top = "3px";
            shotBtn.style.right = "3px";
            shotBtn.style.zIndex = "4";
            shotBtn.style.width = "16px";
            shotBtn.style.height = "16px";
            shotBtn.style.padding = "0";
            shotBtn.style.fontSize = "9px";
            shotBtn.style.fontWeight = "700";
            shotBtn.style.background = "rgba(0, 0, 0, 0.72)";
            shotBtn.style.color = "var(--h3-accent-amber, #ff9f43)";
            shotBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                assignToFirstShotSlot(imgItem.file_path);
            });

            const label = document.createElement("div");
            label.className = "h3-gallery-filename";
            label.style.zIndex = "3";
            label.innerText = imgItem.filename;

            thumb.appendChild(globalBtn);
            thumb.appendChild(shotBtn);
            thumb.appendChild(label);
            contentContainer.appendChild(thumb);
        });
    };

    contentContainer.addEventListener("dragover", (e) => {
        if (activeTab !== "clips") return;
        e.preventDefault();
        contentContainer.style.outline = "1px dashed var(--h3-accent-cyan, #4fd1ff)";
    });

    contentContainer.addEventListener("dragleave", (e) => {
        if (activeTab !== "clips") return;
        e.preventDefault();
        contentContainer.style.outline = "none";
    });

    contentContainer.addEventListener("drop", async (e) => {
        if (activeTab !== "clips") return;
        e.preventDefault();
        contentContainer.style.outline = "none";
        const file = e.dataTransfer?.files?.[0];
        if (!file || !file.type.startsWith("video/")) return;

        const reader = new FileReader();
        reader.onload = async (ev) => {
            try {
                const resp = await fetch("/h3_wrapper/upload_video_clip", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        project_name: ctx.stateManager.state?.project_name || "DefaultProject",
                        filename: file.name,
                        file_data: ev.target.result
                    })
                });
                const resData = await resp.json();
                if (resData.status === "success") {
                    selectedClipFilename = resData.filename;
                    await fetchVideoClips();
                    renderGallery();
                }
            } catch (err) {
                console.error("H3 Wrapper: Error uploading video clip", err);
            }
        };
        reader.readAsDataURL(file);
    });

    const renderClipsTab = () => {
        if (!videoClipsCache || videoClipsCache.length === 0) {
            const emptyText = document.createElement("div");
            emptyText.style.color = "var(--h3-text-disabled)";
            emptyText.style.margin = "auto";
            emptyText.style.fontSize = "11px";
            emptyText.innerText = "Drop video clips here to inspect or conform to project settings.";
            contentContainer.appendChild(emptyText);
            return;
        }

        videoClipsCache.forEach((clip) => {
            const isSelected = selectedClipFilename === clip.filename;
            const thumb = document.createElement("div");
            thumb.className = `h3-gallery-thumb${isSelected ? " approved" : ""}`;
            thumb.style.position = "relative";
            thumb.style.overflow = "hidden";
            thumb.style.opacity = clip.conformed ? "1" : "0.45";
            thumb.title = clip.filename;

            thumb.addEventListener("click", () => {
                selectedClipFilename = clip.filename;
                renderGallery();
            });

            const vid = document.createElement("video");
            vid.src = `/h3_wrapper/view_media?path=${encodeURIComponent(clip.file_path)}&t=${Date.now()}`;
            vid.muted = true;
            vid.loop = true;
            vid.playsInline = true;
            vid.preload = "metadata";
            vid.style.position = "absolute";
            vid.style.top = "0";
            vid.style.left = "0";
            vid.style.width = "100%";
            vid.style.height = "100%";
            vid.style.objectFit = "cover";
            vid.style.display = "block";
            vid.style.pointerEvents = "none";

            thumb.addEventListener("mouseenter", () => vid.play().catch(() => {}));
            thumb.addEventListener("mouseleave", () => {
                vid.pause();
                vid.currentTime = 0;
            });
            thumb.appendChild(vid);

            if (clip.conformed) {
                const addBeforeBtn = document.createElement("button");
                addBeforeBtn.type = "button";
                addBeforeBtn.className = "h3-icon-btn small";
                addBeforeBtn.innerText = "<Add";
                addBeforeBtn.title = "Add clip before selected shot";
                addBeforeBtn.style.position = "absolute";
                addBeforeBtn.style.top = "3px";
                addBeforeBtn.style.left = "3px";
                addBeforeBtn.style.zIndex = "4";
                addBeforeBtn.style.height = "16px";
                addBeforeBtn.style.padding = "0 3px";
                addBeforeBtn.style.fontSize = "8px";
                addBeforeBtn.style.fontWeight = "700";
                addBeforeBtn.style.background = "rgba(0, 0, 0, 0.78)";
                addBeforeBtn.style.color = "var(--h3-accent-cyan, #4fd1ff)";
                addBeforeBtn.addEventListener("click", (e) => {
                    e.stopPropagation();
                    addClipToTimeline(clip, true);
                });

                const addAfterBtn = document.createElement("button");
                addAfterBtn.type = "button";
                addAfterBtn.className = "h3-icon-btn small";
                addAfterBtn.innerText = "Add>";
                addAfterBtn.title = "Add clip after selected shot";
                addAfterBtn.style.position = "absolute";
                addAfterBtn.style.top = "3px";
                addAfterBtn.style.right = "3px";
                addAfterBtn.style.zIndex = "4";
                addAfterBtn.style.height = "16px";
                addAfterBtn.style.padding = "0 3px";
                addAfterBtn.style.fontSize = "8px";
                addAfterBtn.style.fontWeight = "700";
                addAfterBtn.style.background = "rgba(0, 0, 0, 0.78)";
                addAfterBtn.style.color = "var(--h3-accent-amber, #ff9f43)";
                addAfterBtn.addEventListener("click", (e) => {
                    e.stopPropagation();
                    addClipToTimeline(clip, false);
                });

                thumb.appendChild(addBeforeBtn);
                thumb.appendChild(addAfterBtn);
            }

            const label = document.createElement("div");
            label.className = "h3-gallery-filename";
            label.style.zIndex = "3";
            label.innerText = clip.filename;
            thumb.appendChild(label);

            contentContainer.appendChild(thumb);
        });
    };

    const renderGallery = () => {
        contentContainer.innerHTML = "";
        const shots = ctx.stateManager.state.shots || [];
        const shotIndex = ctx.stateManager.selectedShotIndex;
        const shot = ctx.stateManager.getActiveShot();
        const prevShot = shotIndex > 0 ? shots[shotIndex - 1] : null;
        const nextShot = shotIndex < shots.length - 1 ? shots[shotIndex + 1] : null;

        renderInfoPanel(shotIndex, shot);

        if (activeTab === "refs") {
            renderRefsTab();
        } else if (activeTab === "clips") {
            renderClipsTab();
        } else {
            renderTakesTab(shots, shotIndex, shot, prevShot, nextShot);
        }
    };

    ctx.stateManager.subscribe(async (event) => {
        if (event === EVENTS.PROJECT_LOADED) {
            selectedClipFilename = null;
            if (activeTab === "refs") await fetchReferenceImages();
            if (activeTab === "clips") await fetchVideoClips();
        } else if (event === EVENTS.GLOBAL_UPDATED && activeTab === "clips") {
            await fetchVideoClips();
        }
        if ([
            EVENTS.PROJECT_LOADED,
            EVENTS.GLOBAL_UPDATED,
            EVENTS.SHOT_ADDED,
            EVENTS.SHOT_DELETED,
            EVENTS.HISTORY_RESTORED,
            EVENTS.SHOT_SELECTED,
            EVENTS.TAKE_ADDED,
            EVENTS.TAKE_APPROVED,
            EVENTS.TAKE_DELETED,
            EVENTS.BRANCH_SELECTED
        ].includes(event)) {
            renderGallery();
        }
    });

    return { element: galleryStrip };
}