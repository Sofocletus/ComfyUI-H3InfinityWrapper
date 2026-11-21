import * as Icons from "./icons.js";
import { EVENTS } from "./StateManager.js";

export function createCenterPlayer(ctx) {
    const preventEvents = (e) => e.stopPropagation();

    const centerPanel = document.createElement("div");
    centerPanel.className = "h3-center-panel";
    centerPanel.style.display = "flex";
    centerPanel.style.flexDirection = "column";
    centerPanel.style.height = "512px";
    centerPanel.style.gap = "0";
    centerPanel.style.boxSizing = "border-box";

    // ==========================================
    // 1. PROJECT PANEL (Top: 72px)
    // ==========================================
    const projFrame = document.createElement("div");
    projFrame.className = "h3-frame";
    projFrame.style.height = "72px";
    projFrame.style.flexShrink = "0";
    projFrame.style.boxSizing = "border-box";
    projFrame.style.display = "flex";
    projFrame.style.flexDirection = "column";
    projFrame.style.justifyContent = "center";
    projFrame.style.gap = "6px";
    projFrame.style.borderRadius = "0";
    projFrame.style.borderLeft = "none";
    projFrame.style.borderRight = "none";
    projFrame.style.borderTop = "none";

    const projTitle = document.createElement("div");
    projTitle.className = "h3-panel-title";
    projTitle.style.display = "flex";
    projTitle.style.alignItems = "center";
    projTitle.style.justifyContent = "flex-start";
    projTitle.style.gap = "6px";
    projTitle.style.margin = "0";
    projTitle.innerHTML = `${Icons.ICON_FILM_PROJECT} <span>Project</span>`;
    projFrame.appendChild(projTitle);

    const projRow = document.createElement("div");
    projRow.className = "h3-row";

    const projInput = document.createElement("input");
    projInput.type = "text";
    projInput.className = "h3-input";
    projInput.placeholder = "Project Name";
    projInput.addEventListener("mousedown", preventEvents);
    projInput.addEventListener("keydown", (e) => {
        e.stopPropagation();
        if (e.key === "Enter") {
            const name = projInput.value.trim();
            if (name) ctx.stateManager.loadProject(name);
        }
    });

    const loadProjBtn = document.createElement("button");
    loadProjBtn.className = "h3-btn h3-btn-subtle";
    loadProjBtn.innerText = "Load";
    loadProjBtn.addEventListener("click", () => {
        const name = projInput.value.trim();
        if (name) ctx.stateManager.loadProject(name);
    });

    projRow.appendChild(projInput);
    projRow.appendChild(loadProjBtn);
    projFrame.appendChild(projRow);
    centerPanel.appendChild(projFrame);

    // ==========================================
    // 2. VIDEO VIEWER & LIVE PREVIEW (360px)
    // ==========================================
    const viewer = document.createElement("div");
    viewer.className = "h3-video-viewer";
    viewer.style.height = "360px";
    viewer.style.flex = "0 0 360px";
    viewer.style.position = "relative";
    viewer.style.boxSizing = "border-box";

    const video = document.createElement("video");
    video.controls = false;
    video.playsInline = true;
    video.preload = "auto";
    video.style.display = "block";
    video.style.width = "100%";
    video.style.height = "100%";

    const liveImg = document.createElement("img");
    liveImg.style.display = "none";
    liveImg.style.width = "100%";
    liveImg.style.height = "100%";
    liveImg.style.objectFit = "contain";
    liveImg.style.position = "absolute";
    liveImg.style.top = "0";
    liveImg.style.left = "0";
    liveImg.style.zIndex = "5";
    liveImg.style.backgroundColor = "var(--h3-bg-base)";

    const liveVideo = document.createElement("video");
    liveVideo.style.display = "none";
    liveVideo.style.width = "100%";
    liveVideo.style.height = "100%";
    liveVideo.style.objectFit = "contain";
    liveVideo.style.position = "absolute";
    liveVideo.style.top = "0";
    liveVideo.style.left = "0";
    liveVideo.style.zIndex = "5";
    liveVideo.style.backgroundColor = "var(--h3-bg-base)";
    liveVideo.autoplay = true;
    liveVideo.loop = true;
    liveVideo.muted = true;
    liveVideo.playsInline = true;

    viewer.appendChild(video);
    viewer.appendChild(liveImg);
    viewer.appendChild(liveVideo);
    centerPanel.appendChild(viewer);

    // ==========================================
    // 3. INFO BAR (Below Video Player: 36px)
    // ==========================================
    const infoBar = document.createElement("div");
    infoBar.className = "h3-player-topbar";
    infoBar.style.height = "36px";
    infoBar.style.flexShrink = "0";
    infoBar.style.boxSizing = "border-box";
    infoBar.style.display = "flex";
    infoBar.style.alignItems = "center";
    infoBar.style.justifyContent = "space-between";

    const infoLeft = document.createElement("div");
    infoLeft.innerText = "No Shot Selected";

    const infoCenter = document.createElement("div");
    infoCenter.style.color = "var(--h3-accent-cyan)";
    infoCenter.style.fontWeight = "bold";
    infoCenter.innerText = "00:00.00";

    const infoRight = document.createElement("div");
    infoRight.innerText = "Ready";

    infoBar.appendChild(infoLeft);
    infoBar.appendChild(infoCenter);
    infoBar.appendChild(infoRight);
    centerPanel.appendChild(infoBar);

    const setStatusText = (text, color = "var(--h3-text-secondary)") => {
        infoRight.innerText = text;
        infoRight.style.color = color;
    };

    // ==========================================
    // SEQUENCE PLAYBACK STATE
    // ==========================================
    let currentLoadedPath = null;
    let currentLoadedShotIndex = -1;
    let currentGlobalTime = 0;
    let isSequencePlaying = false;
    let isAdvancingShot = false;
    let pendingSeekLocalTime = null;
    let pendingAutoPlay = false;

    const formatTimecode = (sec) => {
        const s = Math.max(0, sec);
        const mins = Math.floor(s / 60);
        const rem = (s % 60).toFixed(2).padStart(5, "0");
        return `${String(mins).padStart(2, "0")}:${rem}`;
    };

    const clearLivePreview = () => {
        liveImg.style.display = "none";
        liveImg.removeAttribute("src");
        liveVideo.pause();
        liveVideo.style.display = "none";
        liveVideo.removeAttribute("src");
        liveVideo.load();
    };

    const showLiveFrame = (url, mime = "image/jpeg") => {
        if (mime && mime.includes("video")) {
            liveImg.style.display = "none";
            liveVideo.style.display = "block";
            liveVideo.src = url;
        } else {
            liveVideo.pause();
            liveVideo.style.display = "none";
            liveImg.style.display = "block";
            liveImg.src = url;
        }
    };

    const loadVideoPath = (filePath, shotIndex = -1, seekVideoTime = 0, autoPlay = false, forceReload = false) => {
        currentLoadedShotIndex = shotIndex;

        if (!filePath) {
            currentLoadedPath = null;
            pendingSeekLocalTime = null;
            pendingAutoPlay = false;
            video.pause();
            video.removeAttribute("src");
            video.load();
            return;
        }

        if (!forceReload && currentLoadedPath === filePath && video.readyState >= 1) {
            const clamped = isFinite(video.duration) ? Math.min(seekVideoTime, Math.max(0, video.duration - 0.01)) : seekVideoTime;
            video.currentTime = Math.max(0, clamped);
            isAdvancingShot = false;
            if (autoPlay) video.play().catch(() => {});
            return;
        }

        currentLoadedPath = filePath;
        pendingSeekLocalTime = Math.max(0, seekVideoTime);
        pendingAutoPlay = autoPlay;
        video.src = `/h3_wrapper/view_media?path=${encodeURIComponent(filePath)}&t=${Date.now()}`;
        video.load();
    };

    video.addEventListener("loadedmetadata", () => {
        if (currentLoadedPath && isFinite(video.duration) && video.duration > 0) {
            ctx.components.timeline?.setVideoDuration?.(currentLoadedPath, video.duration);
        }
        if (pendingSeekLocalTime !== null) {
            const clamped = isFinite(video.duration)
                ? Math.min(pendingSeekLocalTime, Math.max(0, video.duration - 0.01))
                : pendingSeekLocalTime;
            video.currentTime = Math.max(0, clamped);
            pendingSeekLocalTime = null;
        }
        isAdvancingShot = false;
        if (pendingAutoPlay) {
            pendingAutoPlay = false;
            video.play().catch(() => {});
        }
    });

    const seekToGlobalTime = (globalTime, autoPlay = false) => {
        if (!ctx.components.timeline?.getShotLayout) return;
        const { layout, totalDuration } = ctx.components.timeline.getShotLayout();
        if (layout.length === 0) return;

        const clamped = Math.max(0, Math.min(globalTime, totalDuration));
        currentGlobalTime = clamped;
        infoCenter.innerText = formatTimecode(clamped);

        let target = layout[layout.length - 1];
        for (const item of layout) {
            if (clamped < item.endTime || item.index === layout.length - 1) {
                target = item;
                break;
            }
        }

        const localEffectiveOffset = Math.max(0, clamped - target.startTime);
        const videoTimestamp = target.headTrimSec + localEffectiveOffset;

        if (ctx.stateManager.selectedShotIndex !== target.index) {
            ctx.stateManager.selectShot(target.index);
        }

        const path = ctx.stateManager.getShotVideoPath(target.shot);
        loadVideoPath(path, target.index, videoTimestamp, autoPlay);
    };

    // ==========================================
    // 4. BOTTOM TOOLBAR (44px)
    // ==========================================
    const toolbar = document.createElement("div");
    toolbar.className = "h3-player-toolbar";
    toolbar.style.height = "44px";
    toolbar.style.flexShrink = "0";
    toolbar.style.boxSizing = "border-box";

    const leftGroup = document.createElement("div");
    leftGroup.className = "h3-toolbar-group";

    const insertBeforeBtn = document.createElement("button");
    insertBeforeBtn.className = "h3-btn h3-btn-subtle h3-btn-blue";
    insertBeforeBtn.innerText = "< New Shot";
    insertBeforeBtn.title = "Insert a new shot before the selected shot";
    insertBeforeBtn.addEventListener("click", () => ctx.stateManager.insertShotBefore());

    const insertAfterBtn = document.createElement("button");
    insertAfterBtn.className = "h3-btn h3-btn-subtle h3-btn-blue";
    insertAfterBtn.innerText = "New Shot >";
    insertAfterBtn.title = "Insert a new shot after the selected shot";
    insertAfterBtn.addEventListener("click", () => ctx.stateManager.insertShotAfter());

    const delShotBtn = document.createElement("button");
    delShotBtn.className = "h3-icon-btn danger";
    delShotBtn.innerHTML = Icons.ICON_TRASH;
    delShotBtn.title = "Delete selected shot from timeline";
    delShotBtn.disabled = true;
    delShotBtn.addEventListener("click", () => {
        if (confirm("Delete this shot from the timeline?")) {
            ctx.stateManager.deleteShot(ctx.stateManager.selectedShotIndex);
        }
    });

    const undoBtn = document.createElement("button");
    undoBtn.className = "h3-icon-btn";
    undoBtn.innerHTML = Icons.ICON_UNDO;
    undoBtn.title = "Nothing to undo";
    undoBtn.disabled = true;
    undoBtn.addEventListener("click", () => ctx.stateManager.undo());

    leftGroup.appendChild(insertBeforeBtn);
    leftGroup.appendChild(insertAfterBtn);
    leftGroup.appendChild(delShotBtn);
    leftGroup.appendChild(undoBtn);

    const centerGroup = document.createElement("div");
    centerGroup.className = "h3-toolbar-group";

    const stopPlayback = () => {
        isSequencePlaying = false;
        isAdvancingShot = false;
        video.pause();
        playBtn.innerHTML = Icons.ICON_PLAY;
    };

    const advanceToNextShot = () => {
        if (!isSequencePlaying || isAdvancingShot || !ctx.components.timeline) return;
        isAdvancingShot = true;

        const { layout } = ctx.components.timeline.getShotLayout();
        const nextItem = layout.find(
            item => item.index > currentLoadedShotIndex && ctx.stateManager.getShotVideoPath(item.shot)
        );

        if (nextItem) {
            currentGlobalTime = nextItem.startTime;
            ctx.components.timeline.updatePlayhead(currentGlobalTime);
            seekToGlobalTime(currentGlobalTime, true);
        } else {
            const currentRange = layout[currentLoadedShotIndex];
            if (currentRange) {
                currentGlobalTime = currentRange.endTime;
                ctx.components.timeline.updatePlayhead(currentGlobalTime);
                infoCenter.innerText = formatTimecode(currentGlobalTime);
            }
            stopPlayback();
        }
    };

    const rewindBtn = document.createElement("button");
    rewindBtn.className = "h3-icon-btn";
    rewindBtn.innerHTML = Icons.ICON_REWIND;
    rewindBtn.addEventListener("click", () => {
        stopPlayback();
        seekToGlobalTime(0, false);
        ctx.components.timeline?.updatePlayhead(0);
    });

    const playBtn = document.createElement("button");
    playBtn.className = "h3-icon-btn";
    playBtn.innerHTML = Icons.ICON_PLAY;
    playBtn.style.color = "var(--h3-accent-cyan)";
    playBtn.style.borderColor = "var(--h3-border-hover)";

    playBtn.addEventListener("click", () => {
        if (isSequencePlaying) {
            stopPlayback();
            return;
        }

        if (!ctx.components.timeline) return;
        const { layout, totalDuration } = ctx.components.timeline.getShotLayout();
        if (layout.length === 0) return;

        if (currentGlobalTime >= totalDuration - 0.05) {
            currentGlobalTime = 0;
        }

        let startItem = layout.find(item => currentGlobalTime < item.endTime) || layout[0];
        if (!ctx.stateManager.getShotVideoPath(startItem.shot)) {
            const nextPlayable = layout.find(
                item => item.index >= startItem.index && ctx.stateManager.getShotVideoPath(item.shot)
            );
            if (!nextPlayable) return;
            startItem = nextPlayable;
            currentGlobalTime = startItem.startTime;
        }

        isSequencePlaying = true;
        isAdvancingShot = false;
        playBtn.innerHTML = Icons.ICON_PAUSE;
        seekToGlobalTime(currentGlobalTime, true);
    });

    video.addEventListener("ended", () => {
        if (!isSequencePlaying) {
            stopPlayback();
            return;
        }
        advanceToNextShot();
    });

    video.addEventListener("timeupdate", () => {
        if (!ctx.components.timeline || currentLoadedShotIndex < 0) return;
        const { layout } = ctx.components.timeline.getShotLayout();
        const range = layout[currentLoadedShotIndex];
        if (!range) return;

        const hasPlayableNext = layout.some(
            item => item.index > currentLoadedShotIndex && ctx.stateManager.getShotVideoPath(item.shot)
        );

        const actualCutSec = (isFinite(video.duration) && video.duration > 0)
            ? Math.max(range.headTrimSec, video.duration - range.tailTrimSec)
            : range.clipEndSec;

        if (isSequencePlaying && hasPlayableNext && range.tailTrimFrames > 0 && video.currentTime >= actualCutSec - 0.04) {
            advanceToNextShot();
            return;
        }

        const effectiveLocal = Math.max(0, Math.min(range.duration, video.currentTime - range.headTrimSec));
        const globalTime = range.startTime + effectiveLocal;
        currentGlobalTime = globalTime;
        ctx.components.timeline.updatePlayhead(globalTime);
        infoCenter.innerText = formatTimecode(globalTime);
    });

    centerGroup.appendChild(rewindBtn);
    centerGroup.appendChild(playBtn);

    // Right Group: Timeline Scale Controller (1.0m to 4.0m in 0.5m steps)
    const rightGroup = document.createElement("div");
    rightGroup.className = "h3-toolbar-group";

    const scaleLbl = document.createElement("span");
    scaleLbl.style.fontSize = "10px";
    scaleLbl.style.color = "var(--h3-text-muted, #aaa)";
    scaleLbl.style.whiteSpace = "nowrap";
    scaleLbl.innerText = "Scale:";

    const scaleSlider = document.createElement("input");
    scaleSlider.type = "range";
    scaleSlider.className = "h3-slider";
    scaleSlider.min = "1";
    scaleSlider.max = "4";
    scaleSlider.step = "0.5";
    scaleSlider.value = "1";
    scaleSlider.title = "Timeline Visible Span (minutes)";
    scaleSlider.style.width = "84px";
    scaleSlider.style.flex = "0 0 auto";
    scaleSlider.addEventListener("mousedown", preventEvents);

    const scaleValLbl = document.createElement("span");
    scaleValLbl.style.fontSize = "10px";
    scaleValLbl.style.fontFamily = "monospace";
    scaleValLbl.style.color = "var(--h3-accent-cyan)";
    scaleValLbl.style.minWidth = "28px";
    scaleValLbl.style.textAlign = "right";
    scaleValLbl.innerText = "1.0m";

    scaleSlider.addEventListener("input", (e) => {
        const mins = parseFloat(e.target.value) || 1;
        scaleValLbl.innerText = `${mins.toFixed(1)}m`;
        ctx.components.timeline?.setTimeSpanMinutes?.(mins);
    });

    rightGroup.appendChild(scaleLbl);
    rightGroup.appendChild(scaleSlider);
    rightGroup.appendChild(scaleValLbl);

    toolbar.appendChild(leftGroup);
    toolbar.appendChild(centerGroup);
    toolbar.appendChild(rightGroup);
    centerPanel.appendChild(toolbar);

    // ==========================================
    // SYNC LOGIC
    // ==========================================
    const updateShotInfoLabel = () => {
        const shot = ctx.stateManager.getActiveShot();
        if (!shot) {
            infoLeft.innerText = "No Shot Selected";
            return;
        }
        const takeNum = shot.approved_take !== null && shot.approved_take !== undefined
            ? String(shot.approved_take).padStart(3, "0")
            : "---";
        infoLeft.innerHTML = `<b>${shot.id}</b> · Take${takeNum}`;
    };

    const updateUndoButton = () => {
        const count = ctx.stateManager.getUndoCount();
        undoBtn.disabled = count === 0;
        undoBtn.title = count > 0 ? `Undo timeline change (${count})` : "Nothing to undo";
    };

    ctx.stateManager.subscribe((event) => {
        const state = ctx.stateManager.state;
        projInput.value = state.project_name || "";
        delShotBtn.disabled = ctx.stateManager.selectedShotIndex < 0;
        updateShotInfoLabel();
        updateUndoButton();

        if ([EVENTS.SHOT_ADDED, EVENTS.SHOT_DELETED, EVENTS.HISTORY_RESTORED].includes(event)) {
            stopPlayback();
            const idx = ctx.stateManager.selectedShotIndex;
            const range = ctx.components.timeline?.getShotTimeRange(idx);
            const targetTime = range ? range.startTime : 0;
            currentGlobalTime = targetTime;
            infoCenter.innerText = formatTimecode(targetTime);
            ctx.components.timeline?.updatePlayhead(targetTime);

            const shot = ctx.stateManager.getActiveShot();
            const path = ctx.stateManager.getShotVideoPath(shot);
            const startOffset = range ? range.headTrimSec : 0;
            loadVideoPath(path, idx, startOffset, false);
        } else if ([EVENTS.PROJECT_LOADED, EVENTS.TAKE_APPROVED, EVENTS.TAKE_ADDED, EVENTS.TAKE_DELETED, EVENTS.BRANCH_SELECTED].includes(event)) {
            const idx = ctx.stateManager.selectedShotIndex;
            const shot = ctx.stateManager.getActiveShot();
            const path = ctx.stateManager.getShotVideoPath(shot);
            const range = ctx.components.timeline?.getShotTimeRange(idx);
            const startOffset = range ? range.headTrimSec : 0;
            const forceReload = [EVENTS.TAKE_APPROVED, EVENTS.TAKE_DELETED, EVENTS.BRANCH_SELECTED].includes(event);
            loadVideoPath(path, idx, startOffset, false, forceReload);
        }
    });

    return {
        element: centerPanel,
        seekToGlobalTime,
        stopPlayback,
        loadVideoPath,
        setStatusText,
        showLiveFrame,
        clearLivePreview,
        videoElement: video
    };
}