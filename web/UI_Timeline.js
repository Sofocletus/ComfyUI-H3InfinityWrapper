export function createTimeline(ctx) {
    const MIN_SHOT_WIDTH = 24;
    const FPS = 24.0;
    const TAIL_TRIM_FRAMES = 17;
    const VALID_INSERT_CONTEXTS = [22, 39, 90, 141, 192];

    const MODE_COLORS = {
        Start:    { border: "#4fd1ff", bg: "rgba(79, 209, 255, 0.14)",  bgSel: "rgba(79, 209, 255, 0.28)",  text: "#82deff" },
        Continue: { border: "#2ed573", bg: "rgba(46, 213, 115, 0.12)",  bgSel: "rgba(46, 213, 115, 0.26)",  text: "#7bed9f" },
        Lead:     { border: "#ff9f43", bg: "rgba(255, 159, 67, 0.14)",  bgSel: "rgba(255, 159, 67, 0.28)",  text: "#ffbe76" },
        Bridge:   { border: "#a29bfe", bg: "rgba(162, 155, 254, 0.14)", bgSel: "rgba(162, 155, 254, 0.28)", text: "#c8c2ff" }
    };

    const snapInsertContext = (n) => {
        const val = parseInt(n, 10) || 39;
        return VALID_INSERT_CONTEXTS.reduce((best, cur) =>
            Math.abs(cur - val) < Math.abs(best - val) ? cur : best
        , 39);
    };

    let timeSpanMinutes = 1.0;
    const actualVideoDurations = new Map();

    const timelineWrapper = document.createElement("div");
    timelineWrapper.className = "h3-timeline-wrapper";
    timelineWrapper.style.position = "relative";
    timelineWrapper.style.userSelect = "none";
    timelineWrapper.style.height = "56px";
    timelineWrapper.style.minHeight = "56px";
    timelineWrapper.style.overflow = "hidden";
    timelineWrapper.style.boxSizing = "border-box";

    const stopProp = (e) => e.stopPropagation();
    timelineWrapper.addEventListener("mousedown", stopProp);
    timelineWrapper.addEventListener("wheel", stopProp, { passive: true });

    const scrollArea = document.createElement("div");
    scrollArea.className = "h3-timeline-scroll";
    scrollArea.style.position = "relative";
    scrollArea.style.overflowX = "scroll";
    scrollArea.style.overflowY = "hidden";
    scrollArea.style.width = "100%";
    scrollArea.style.height = "100%";
    scrollArea.style.padding = "0";
    scrollArea.style.margin = "0";
    scrollArea.style.boxSizing = "border-box";

    const contentArea = document.createElement("div");
    contentArea.className = "h3-timeline-content";
    contentArea.style.position = "relative";
    contentArea.style.minWidth = "100%";
    contentArea.style.height = "44px";
    contentArea.style.padding = "0";
    contentArea.style.margin = "0";

    const ruler = document.createElement("div");
    ruler.className = "h3-timeline-ruler";
    ruler.style.position = "relative";
    ruler.style.height = "18px";
    ruler.style.borderBottom = "1px solid var(--h3-border-subtle)";
    ruler.style.cursor = "pointer";
    ruler.style.background = "var(--h3-bg-panel)";
    ruler.style.padding = "0";
    ruler.style.margin = "0";
    ruler.style.boxSizing = "border-box";

    const track = document.createElement("div");
    track.className = "h3-timeline-track";
    track.style.position = "relative";
    track.style.display = "flex";
    track.style.alignItems = "stretch";
    track.style.gap = "0px";
    track.style.padding = "0px";
    track.style.margin = "0px";
    track.style.height = "26px";
    track.style.minHeight = "26px";
    track.style.cursor = "pointer";
    track.style.boxSizing = "border-box";

    const playhead = document.createElement("div");
    playhead.className = "h3-playhead";
    playhead.style.position = "absolute";
    playhead.style.top = "0";
    playhead.style.height = "44px";
    playhead.style.left = "0px";
    playhead.style.width = "2px";
    playhead.style.background = "var(--h3-accent-red, #e53935)";
    playhead.style.zIndex = "20";
    playhead.style.pointerEvents = "none";

    const playheadCap = document.createElement("div");
    playheadCap.className = "h3-playhead-cap";
    playheadCap.style.position = "absolute";
    playheadCap.style.top = "0";
    playheadCap.style.left = "-5px";
    playheadCap.style.width = "12px";
    playheadCap.style.height = "10px";
    playheadCap.style.background = "var(--h3-accent-red, #e53935)";
    playheadCap.style.clipPath = "polygon(0 0, 100% 0, 50% 100%)";
    playhead.appendChild(playheadCap);

    contentArea.appendChild(ruler);
    contentArea.appendChild(track);
    contentArea.appendChild(playhead);
    scrollArea.appendChild(contentArea);
    timelineWrapper.appendChild(scrollArea);

    const getPixelsPerSecond = () => {
        const viewportW = scrollArea.clientWidth || 1296;
        return viewportW / (timeSpanMinutes * 60);
    };

    const formatRulerLabel = (sec) => {
        if (sec < 60) return `${sec}s`;
        const m = Math.floor(sec / 60);
        const s = sec % 60;
        return `${m}:${String(s).padStart(2, "0")}`;
    };

    const getShotLayout = () => {
        const shots = ctx.stateManager.getVisibleShots();
        const ctxFrames = parseInt(ctx.stateManager.state.global?.context_frames, 10) || 39;
        const insertCtxFrames = snapInsertContext(ctxFrames);
        const pps = getPixelsPerSecond();

        let lastPlayableIndex = -1;
        shots.forEach((s, i) => {
            if (s && s.takes && s.takes.length > 0) lastPlayableIndex = i;
        });

        let cursorTime = 0;
        let cursorX = 0;
        const layout = [];

        shots.forEach((shot, index) => {
            const mode = ctx.stateManager.getShotDisplayMode(index);
            const requestedFrames = shot && shot.duration_frames !== undefined ? shot.duration_frames : 124;
            const hasNextPlayable = index < lastPlayableIndex;

            let headTrimFrames = 0;
            let tailTrimFrames = 0;

            if (mode === "Continue") {
                headTrimFrames = ctxFrames;
                tailTrimFrames = hasNextPlayable ? TAIL_TRIM_FRAMES : 0;
            } else if (mode === "Lead") {
                headTrimFrames = 0;
                tailTrimFrames = hasNextPlayable ? insertCtxFrames : 0;
            } else if (mode === "Bridge") {
                headTrimFrames = insertCtxFrames;
                tailTrimFrames = hasNextPlayable ? insertCtxFrames : 0;
            } else {
                headTrimFrames = 0;
                tailTrimFrames = hasNextPlayable ? TAIL_TRIM_FRAMES : 0;
            }

            const totalVideoFrames = requestedFrames;
            const effectiveFrames = Math.max(1, requestedFrames - headTrimFrames - tailTrimFrames);

            const headTrimSec = headTrimFrames / FPS;
            const tailTrimSec = tailTrimFrames / FPS;

            const activeTake = ctx.stateManager.getActiveTake(shot);
            const previewPath = activeTake ? activeTake.preview_path : null;
            const knownVideoSec = (previewPath && actualVideoDurations.has(previewPath))
                ? actualVideoDurations.get(previewPath)
                : (activeTake && isFinite(activeTake.video_duration) && activeTake.video_duration > 0
                    ? activeTake.video_duration
                    : null);

            let duration = effectiveFrames / FPS;
            if (knownVideoSec !== null) {
                duration = Math.max(0.1, knownVideoSec - headTrimSec - tailTrimSec);
            }

            const clipEndSec = headTrimSec + duration;
            const width = Math.max(MIN_SHOT_WIDTH, Math.round(duration * pps));

            layout.push({
                index,
                shot,
                mode,
                requestedFrames,
                totalVideoFrames,
                headTrimFrames,
                tailTrimFrames,
                effectiveFrames,
                headTrimSec,
                tailTrimSec,
                clipEndSec,
                startTime: cursorTime,
                endTime: cursorTime + duration,
                duration,
                startX: cursorX,
                endX: cursorX + width,
                width
            });
            cursorTime += duration;
            cursorX += width;
        });

        return { layout, totalDuration: cursorTime, totalWidth: cursorX };
    };

    const timeToX = (globalTime) => {
        const { layout, totalDuration, totalWidth } = getShotLayout();
        if (layout.length === 0 || totalDuration <= 0) return 0;
        const clamped = Math.max(0, Math.min(globalTime, totalDuration));

        for (const item of layout) {
            if (clamped <= item.endTime || item.index === layout.length - 1) {
                const ratio = item.duration > 0 ? (clamped - item.startTime) / item.duration : 0;
                return item.startX + Math.max(0, Math.min(1, ratio)) * item.width;
            }
        }
        return totalWidth;
    };

    const xToTime = (x) => {
        const { layout, totalDuration } = getShotLayout();
        if (layout.length === 0) return 0;
        const clampedX = Math.max(0, x);

        for (const item of layout) {
            if (clampedX <= item.endX || item.index === layout.length - 1) {
                const ratio = item.width > 0 ? (clampedX - item.startX) / item.width : 0;
                return item.startTime + Math.max(0, Math.min(1, ratio)) * item.duration;
            }
        }
        return totalDuration;
    };

    const getShotTimeRange = (index) => {
        const { layout } = getShotLayout();
        return layout[index] || null;
    };

    let currentGlobalTime = 0;
    let isScrubbing = false;

    const updatePlayhead = (globalTime) => {
        currentGlobalTime = Math.max(0, globalTime);
        playhead.style.left = `${timeToX(currentGlobalTime)}px`;
    };

    const scrubFromClientX = (clientX) => {
        const rect = contentArea.getBoundingClientRect();
        const scale = (rect.width > 0 && contentArea.offsetWidth > 0) ? (rect.width / contentArea.offsetWidth) : 1;
        const x = (clientX - rect.left) / scale;
        const targetTime = xToTime(x);
        updatePlayhead(targetTime);
        ctx.components.centerPlayer?.seekToGlobalTime?.(targetTime, false);
    };

    const onScrubStart = (e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        e.preventDefault();
        isScrubbing = true;
        scrubFromClientX(e.clientX);

        const onMove = (moveEvent) => {
            if (!isScrubbing) return;
            scrubFromClientX(moveEvent.clientX);
        };

        const onUp = () => {
            isScrubbing = false;
            window.removeEventListener("mousemove", onMove);
            window.removeEventListener("mouseup", onUp);
        };

        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
    };

    ruler.addEventListener("mousedown", onScrubStart);
    track.addEventListener("mousedown", onScrubStart);

    const renderTimeline = () => {
        track.innerHTML = "";
        ruler.innerHTML = "";

        const pps = getPixelsPerSecond();
        const { layout, totalDuration, totalWidth } = getShotLayout();
        const selectedIdx = ctx.stateManager.selectedShotIndex;

        const spanSec = Math.round(timeSpanMinutes * 60);
        const maxSec = Math.max(spanSec, Math.ceil(totalDuration) + 5);
        const contentWidth = Math.max(
            totalWidth + 40,
            Math.ceil(maxSec * pps),
            scrollArea.clientWidth || 1296
        );
        contentArea.style.width = `${contentWidth}px`;

        const tickStep = timeSpanMinutes <= 1.5 ? 1 : 5;
        const labelStep = timeSpanMinutes <= 1.5 ? 5 : (timeSpanMinutes <= 2.5 ? 10 : 15);

        for (let s = 0; s <= maxSec; s += tickStep) {
            const x = s <= totalDuration ? timeToX(s) : totalWidth + (s - totalDuration) * pps;
            const isMajor = s % labelStep === 0;

            const tick = document.createElement("div");
            tick.style.position = "absolute";
            tick.style.left = `${x}px`;
            tick.style.bottom = "0";
            tick.style.height = isMajor ? "9px" : "4px";
            tick.style.borderLeft = "1px solid var(--h3-border-strong, #444)";
            tick.style.pointerEvents = "none";

            if (isMajor) {
                const lbl = document.createElement("span");
                lbl.innerText = formatRulerLabel(s);
                lbl.style.position = "absolute";
                lbl.style.left = "3px";
                lbl.style.top = "-7px";
                lbl.style.fontSize = "8px";
                lbl.style.fontFamily = "monospace";
                lbl.style.color = "var(--h3-text-dim, #888)";
                lbl.style.whiteSpace = "nowrap";
                tick.appendChild(lbl);
            }
            ruler.appendChild(tick);
        }

        layout.forEach((item) => {
            const { index, shot, mode, width, duration } = item;
            const isSelected = index === selectedIdx;
            const hasTakes = shot.takes && shot.takes.length > 0;
            const palette = MODE_COLORS[mode] || MODE_COLORS.Start;

            const block = document.createElement("div");
            block.className = `h3-shot-block${isSelected ? " selected" : ""}${hasTakes ? " has-takes" : ""}`;
            block.title = `${shot.id} (${mode})`;
            block.style.width = `${width}px`;
            block.style.flexShrink = "0";
            block.style.boxSizing = "border-box";
            block.style.margin = "0px";
            block.style.padding = "0 4px";
            block.style.display = "flex";
            block.style.flexDirection = "row";
            block.style.alignItems = "center";
            block.style.justifyContent = "space-between";
            block.style.gap = "4px";
            block.style.overflow = "hidden";

            if (isSelected) {
                block.style.background = palette.bgSel;
                block.style.border = `1px solid ${palette.border}`;
                block.style.boxShadow = `inset 0 0 6px ${palette.bgSel}`;
            } else if (hasTakes) {
                block.style.background = palette.bg;
                block.style.border = `1px solid ${palette.border}`;
                block.style.opacity = "0.85";
            } else {
                block.style.background = "rgba(255, 255, 255, 0.03)";
                block.style.border = `1px dashed ${palette.border}`;
                block.style.opacity = "0.75";
            }

            const title = document.createElement("div");
            title.style.fontSize = "10px";
            title.style.fontWeight = isSelected ? "700" : "500";
            title.style.color = isSelected ? palette.text : "var(--h3-text-primary, #ddd)";
            title.style.whiteSpace = "nowrap";
            title.style.overflow = "hidden";
            title.style.textOverflow = "ellipsis";
            title.innerText = shot.id || `S${String(index + 1).padStart(2, "0")}`;

            const meta = document.createElement("div");
            meta.style.fontSize = "9px";
            meta.style.fontFamily = "monospace";
            meta.style.color = isSelected ? palette.text : "var(--h3-text-dim, #888)";
            meta.style.whiteSpace = "nowrap";
            const takeText = shot.approved_take ? `T${String(shot.approved_take).padStart(2, "0")}` : "--";
            meta.innerText = `${duration.toFixed(1)}s·${takeText}`;

            block.appendChild(title);
            if (width >= 96) block.appendChild(meta);
            track.appendChild(block);
        });

        updatePlayhead(Math.min(currentGlobalTime, totalDuration));
    };

    const setVideoDuration = (previewPath, videoDurationSec) => {
        if (!previewPath || !isFinite(videoDurationSec) || videoDurationSec <= 0) return;
        const prev = actualVideoDurations.get(previewPath);
        const changed = prev === undefined || Math.abs(prev - videoDurationSec) > 0.02;
        if (changed) {
            actualVideoDurations.set(previewPath, videoDurationSec);
        }

        let persisted = false;
        (ctx.stateManager.state.shots || []).forEach((shot) => {
            (shot.takes || []).forEach((take) => {
                if (take.preview_path === previewPath) {
                    if (!isFinite(take.video_duration) || Math.abs(take.video_duration - videoDurationSec) > 0.02) {
                        take.video_duration = Number(videoDurationSec.toFixed(4));
                        persisted = true;
                    }
                }
            });
        });

        if (persisted) {
            ctx.stateManager.saveProject();
        }
        if (changed || persisted) {
            renderTimeline();
        }
    };

    const setTimeSpanMinutes = (minutes) => {
        const clamped = Math.max(1, Math.min(4, parseFloat(minutes) || 1));
        if (clamped !== timeSpanMinutes) {
            timeSpanMinutes = clamped;
            renderTimeline();
        }
    };

    ctx.stateManager.subscribe((event) => {
        if ([
            "PROJECT_LOADED",
            "GLOBAL_UPDATED",
            "SHOT_ADDED",
            "SHOT_DELETED",
            "SHOT_SELECTED",
            "SHOT_UPDATED",
            "TAKE_ADDED",
            "TAKE_APPROVED",
            "BRANCH_SELECTED"
        ].includes(event)) {
            renderTimeline();
        }
    });

    requestAnimationFrame(() => renderTimeline());

    return {
        element: timelineWrapper,
        updatePlayhead,
        getShotLayout,
        getShotTimeRange,
        setVideoDuration,
        setTimeSpanMinutes
    };
}