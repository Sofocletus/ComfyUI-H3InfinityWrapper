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

    // SECTION 1 (LEFT): SHOT & LINEAGE INFO PANEL (103px)
    const infoPanel = document.createElement("div");
    infoPanel.style.width = "103px";
    infoPanel.style.flexShrink = "0";
    infoPanel.style.padding = "6px";
    infoPanel.style.borderRight = "1px solid var(--h3-border-subtle, #2a2a2a)";
    infoPanel.style.background = "var(--h3-bg-panel, #141414)";
    infoPanel.style.display = "flex";
    infoPanel.style.flexDirection = "column";
    infoPanel.style.justifyContent = "flex-start";
    infoPanel.style.gap = "3px";
    infoPanel.style.boxSizing = "border-box";
    infoPanel.style.fontSize = "10px";
    infoPanel.style.fontFamily = "monospace";

    // SECTION 2 (CENTER): TAKES STRIP
    const takesContainer = document.createElement("div");
    takesContainer.style.flex = "1";
    takesContainer.style.minWidth = "0";
    takesContainer.style.display = "flex";
    takesContainer.style.alignItems = "center";
    takesContainer.style.gap = "8px";
    takesContainer.style.padding = "6px 10px";
    takesContainer.style.overflowX = "auto";
    takesContainer.style.overflowY = "hidden";

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
    galleryStrip.appendChild(takesContainer);
    galleryStrip.appendChild(graphContainer);

    const renderInfoPanel = (shots, shotIndex, shot) => {
        infoPanel.innerHTML = "";

        if (!shot) {
            infoPanel.innerHTML = `<div style="color:var(--h3-text-disabled, #666); text-align:center;">No Shot</div>`;
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

        const delTakeBtn = document.createElement("button");
        delTakeBtn.className = "h3-icon-btn danger";
        delTakeBtn.style.marginTop = "auto";
        delTakeBtn.style.alignSelf = "center";
        delTakeBtn.innerHTML = Icons.ICON_TRASH;
        delTakeBtn.disabled = !activeTakeObj;
        delTakeBtn.title = activeTakeObj
            ? `Delete Take ${String(activeTakeObj.take_num).padStart(2, "0")} from this shot`
            : "No take selected";
        delTakeBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            if (!activeTakeObj) return;
            const takeLabel = `Take ${String(activeTakeObj.take_num).padStart(2, "0")}`;
            if (confirm(`Delete ${takeLabel} from Shot ${String(shotIndex + 1).padStart(2, "0")}?`)) {
                ctx.stateManager.deleteTake(shotIndex, activeTakeObj.take_num);
            }
        });
        infoPanel.appendChild(delTakeBtn);
    };

    const renderGallery = () => {
        takesContainer.innerHTML = "";
        const shots = ctx.stateManager.state.shots || [];
        const shotIndex = ctx.stateManager.selectedShotIndex;
        const shot = ctx.stateManager.getActiveShot();
        const prevShot = shotIndex > 0 ? shots[shotIndex - 1] : null;
        const nextShot = shotIndex < shots.length - 1 ? shots[shotIndex + 1] : null;

        renderInfoPanel(shots, shotIndex, shot);

        if (!shot) {
            const emptyText = document.createElement("div");
            emptyText.style.color = "var(--h3-text-disabled)";
            emptyText.style.margin = "auto";
            emptyText.style.fontSize = "11px";
            emptyText.innerText = "Select a shot in the timeline to view Takes.";
            takesContainer.appendChild(emptyText);
            return;
        }

        if (!shot.takes || shot.takes.length === 0) {
            const emptyText = document.createElement("div");
            emptyText.style.color = "var(--h3-text-disabled)";
            emptyText.style.margin = "auto";
            emptyText.style.fontSize = "11px";
            emptyText.innerText = `No takes generated for ${shot.id} yet.`;
            takesContainer.appendChild(emptyText);
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

            const badgeParts = [];
            if (hasPrevLink) badgeParts.push(`←T${String(incoming[0]).padStart(2, "0")}`);
            if (hasNextLink) badgeParts.push(`→T${String(take.next_take).padStart(2, "0")}`);
            thumb.title = `Take ${String(take.take_num).padStart(2, "0")}${badgeParts.length ? ` (${badgeParts.join(" ")})` : ""}`;

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

            if (badgeParts.length > 0) {
                const badge = document.createElement("div");
                badge.style.position = "absolute";
                badge.style.top = "3px";
                badge.style.right = "4px";
                badge.style.zIndex = "3";
                badge.style.fontSize = "8px";
                badge.style.fontFamily = "monospace";
                badge.style.color = isValidForBranch ? "var(--h3-accent-cyan, #4fd1ff)" : "#888";
                badge.style.background = "rgba(0,0,0,0.65)";
                badge.style.padding = "1px 3px";
                badge.style.borderRadius = "2px";
                badge.innerText = badgeParts.join(" ");
                thumb.appendChild(badge);
            }

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

            const label = document.createElement("div");
            label.className = "h3-gallery-filename";
            label.style.zIndex = "3";
            label.innerText = `Take ${String(take.take_num).padStart(2, "0")}`;

            thumb.appendChild(checkbox);
            thumb.appendChild(label);
            thumb.addEventListener("click", selectTake);

            takesContainer.appendChild(thumb);
        });
    };

    ctx.stateManager.subscribe((event) => {
        if ([
            EVENTS.PROJECT_LOADED,
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