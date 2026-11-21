import * as Icons from "./icons.js";
import { EVENTS } from "./StateManager.js";

// ==========================================
// CONSOLIDATED BIDIRECTIONAL DAG HELPERS
// ==========================================
export function getIncomingLinks(shots, shotIndex, takeNum) {
    if (!shots || shotIndex <= 0 || shotIndex >= shots.length) return [];
    const prevShot = shots[shotIndex - 1];
    const currShot = shots[shotIndex];
    if (!prevShot || !currShot) return [];

    const links = new Set();
    const currTake = (currShot.takes || []).find(t => t.take_num === takeNum);
    if (currTake && currTake.parent_take !== undefined && currTake.parent_take !== null) {
        links.add(currTake.parent_take);
    }
    (prevShot.takes || []).forEach((pTake) => {
        if (pTake.next_take !== undefined && pTake.next_take !== null && pTake.next_take === takeNum) {
            links.add(pTake.take_num);
        }
    });
    return Array.from(links);
}

export function getOutgoingLinks(shots, shotIndex, takeNum) {
    if (!shots || shotIndex < 0 || shotIndex >= shots.length - 1) return [];
    const currShot = shots[shotIndex];
    const nextShot = shots[shotIndex + 1];
    if (!currShot || !nextShot) return [];

    const links = new Set();
    const currTake = (currShot.takes || []).find(t => t.take_num === takeNum);
    if (currTake && currTake.next_take !== undefined && currTake.next_take !== null) {
        links.add(currTake.next_take);
    }
    (nextShot.takes || []).forEach((nTake) => {
        if (nTake.parent_take !== undefined && nTake.parent_take !== null && nTake.parent_take === takeNum) {
            links.add(nTake.take_num);
        }
    });
    return Array.from(links);
}

export function getParentTake(shots, shotIndex, take) {
    if (!shots || shotIndex <= 0 || !take) return null;
    if (take.parent_take !== undefined && take.parent_take !== null) {
        return take.parent_take;
    }
    const incoming = getIncomingLinks(shots, shotIndex, take.take_num);
    if (incoming.length === 0) return null;

    const prevShot = shots[shotIndex - 1];
    if (prevShot && incoming.includes(prevShot.approved_take)) {
        return prevShot.approved_take;
    }
    return incoming[0];
}

export function isTakeDisabled(shots, sIdx, takeNum) {
    const shot = shots[sIdx];
    if (!shot || !shot.takes) return false;
    const take = shot.takes.find(t => t.take_num === takeNum);
    return Boolean(take && take.disabled);
}

export function getEdgesBetween(shots, leftIdx, rightIdx) {
    const leftShot = shots[leftIdx];
    const rightShot = shots[rightIdx];
    if (!leftShot || !rightShot) return [];

    const leftSet = new Set((leftShot.takes || []).map(t => t.take_num));
    const rightSet = new Set((rightShot.takes || []).map(t => t.take_num));
    const edgeKeys = new Set();
    const edges = [];

    const addEdge = (fromTake, toTake) => {
        if (!leftSet.has(fromTake) || !rightSet.has(toTake)) return;
        const key = `${fromTake}->${toTake}`;
        if (edgeKeys.has(key)) return;
        edgeKeys.add(key);
        edges.push({ fromTake, toTake });
    };

    (leftShot.takes || []).forEach((t) => {
        if (t.next_take !== undefined && t.next_take !== null) {
            addEdge(t.take_num, t.next_take);
        }
    });

    (rightShot.takes || []).forEach((t) => {
        if (t.parent_take !== undefined && t.parent_take !== null) {
            addEdge(t.parent_take, t.take_num);
        }
    });

    return edges;
}

export function getAllFullBranches(shots) {
    const incoming = new Map();
    const outgoing = new Map();

    shots.forEach((shot, sIdx) => {
        (shot.takes || []).forEach((take) => {
            const key = `${sIdx}:${take.take_num}`;
            incoming.set(key, []);
            outgoing.set(key, []);
        });
    });

    for (let sIdx = 0; sIdx < shots.length - 1; sIdx++) {
        const edges = getEdgesBetween(shots, sIdx, sIdx + 1);
        edges.forEach(({ fromTake, toTake }) => {
            const fromKey = `${sIdx}:${fromTake}`;
            const toKey = `${sIdx + 1}:${toTake}`;
            outgoing.get(fromKey)?.push({ sIdx: sIdx + 1, takeNum: toTake });
            incoming.get(toKey)?.push({ sIdx, takeNum: fromTake });
        });
    }

    const branches = [];
    const dfs = (sIdx, takeNum, path) => {
        const shot = shots[sIdx];
        const nextPath = [...path, { shot: sIdx + 1, shot_id: shot.id, take: takeNum }];
        const children = outgoing.get(`${sIdx}:${takeNum}`) || [];
        if (children.length === 0) {
            branches.push({ branchIndex: branches.length + 1, takes: nextPath });
            return;
        }
        children.forEach((c) => dfs(c.sIdx, c.takeNum, nextPath));
    };

    shots.forEach((shot, sIdx) => {
        (shot.takes || []).forEach((take) => {
            const key = `${sIdx}:${take.take_num}`;
            if ((incoming.get(key) || []).length === 0) {
                dfs(sIdx, take.take_num, []);
            }
        });
    });

    return branches;
}

export function isBranchEnabled(branch, shots) {
    return branch.takes.every(item => !isTakeDisabled(shots, item.shot - 1, item.take));
}

// ==========================================
// BRANCH GRAPH UI COMPONENT
// ==========================================
export function createBranchGraph(ctx) {
    const BRANCH_COLORS = [
        "#4fd1ff", "#ff9f43", "#2ed573", "#ff6b81",
        "#a29bfe", "#feca57", "#1dd1a1", "#ff7f50"
    ];

    const outer = document.createElement("div");
    outer.className = "h3-branch-panel";
    outer.style.display = "flex";
    outer.style.alignItems = "stretch";
    outer.style.width = "100%";
    outer.style.height = "100%";
    outer.style.background = "var(--h3-bg-base, #0d0d0d)";
    outer.style.borderLeft = "1px solid var(--h3-border-subtle, #2a2a2a)";
    outer.style.boxSizing = "border-box";
    outer.style.userSelect = "none";

    const stopProp = (e) => e.stopPropagation();
    outer.addEventListener("mousedown", stopProp);
    outer.addEventListener("wheel", stopProp, { passive: true });

    const wrapper = document.createElement("div");
    wrapper.className = "h3-branch-graph";
    wrapper.style.position = "relative";
    wrapper.style.flex = "1";
    wrapper.style.minWidth = "0";
    wrapper.style.height = "100%";
    wrapper.style.overflowX = "auto";
    wrapper.style.overflowY = "auto";
    wrapper.style.boxSizing = "border-box";
    wrapper.style.padding = "5px 8px";

    const canvas = document.createElement("div");
    canvas.style.position = "relative";
    canvas.style.display = "inline-flex";
    canvas.style.alignItems = "flex-start";
    canvas.style.gap = "18px";
    wrapper.appendChild(canvas);

    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, "svg");
    svg.style.position = "absolute";
    svg.style.top = "0";
    svg.style.left = "0";
    svg.style.width = "100%";
    svg.style.height = "100%";
    svg.style.pointerEvents = "none";
    svg.style.overflow = "visible";
    svg.style.zIndex = "1";

    const controlsCol = document.createElement("div");
    controlsCol.style.width = "84px";
    controlsCol.style.flexShrink = "0";
    controlsCol.style.borderLeft = "1px solid var(--h3-border-subtle, #2a2a2a)";
    controlsCol.style.background = "var(--h3-bg-panel, #141414)";
    controlsCol.style.padding = "8px 6px";
    controlsCol.style.display = "flex";
    controlsCol.style.flexDirection = "column";
    controlsCol.style.alignItems = "stretch";
    controlsCol.style.justifyContent = "center";
    controlsCol.style.gap = "8px";
    controlsCol.style.boxSizing = "border-box";

    const stitchBtn = document.createElement("button");
    stitchBtn.className = "h3-btn h3-btn-generate";
    stitchBtn.style.width = "100%";
    stitchBtn.style.justifyContent = "center";
    stitchBtn.style.padding = "6px 4px";
    stitchBtn.innerHTML = `${Icons.ICON_STITCH} <span>Stitch</span>`;

    const setStitchingVisual = (isRendering, mode = null) => {
        if (isRendering && mode === "Stitch") {
            stitchBtn.style.background = "var(--h3-accent-red, #e53935)";
            stitchBtn.style.borderColor = "#ff6b6b";
            stitchBtn.style.color = "#ffffff";
            stitchBtn.innerHTML = `<span>Cancel</span>`;
            stitchBtn.disabled = false;
        } else {
            stitchBtn.style.background = "";
            stitchBtn.style.borderColor = "";
            stitchBtn.style.color = "";
            stitchBtn.innerHTML = `${Icons.ICON_STITCH} <span>Stitch</span>`;
            stitchBtn.disabled = isRendering;
        }
    };

    const allBranchesRow = document.createElement("label");
    allBranchesRow.style.display = "flex";
    allBranchesRow.style.alignItems = "center";
    allBranchesRow.style.gap = "4px";
    allBranchesRow.style.fontSize = "9px";
    allBranchesRow.style.color = "var(--h3-text-secondary, #aaa)";
    allBranchesRow.style.cursor = "pointer";
    allBranchesRow.style.lineHeight = "1.2";

    const allBranchesCheck = document.createElement("input");
    allBranchesCheck.type = "checkbox";
    allBranchesCheck.style.margin = "0";
    allBranchesCheck.addEventListener("mousedown", stopProp);

    const allBranchesText = document.createElement("span");
    allBranchesText.innerText = "All branches";

    allBranchesRow.appendChild(allBranchesCheck);
    allBranchesRow.appendChild(allBranchesText);

    controlsCol.appendChild(stitchBtn);
    controlsCol.appendChild(allBranchesRow);

    outer.appendChild(wrapper);
    outer.appendChild(controlsCol);

    stitchBtn.addEventListener("click", (e) => {
        e.stopPropagation();

        if (ctx.executionEngine.getIsRendering()) {
            if (ctx.executionEngine.getRenderingMode() === "Stitch") {
                ctx.executionEngine.cancelGeneration();
            }
            return;
        }

        const shots = ctx.stateManager.state.shots || [];
        const allBranches = getAllFullBranches(shots);

        if (allBranchesCheck.checked) {
            if (allBranches.length === 0) {
                alert("No generated takes found to stitch.");
                return;
            }
            if (confirm(`Stitch all ${allBranches.length} full branches into separate videos?`)) {
                ctx.executionEngine.executeStitchQueue(allBranches);
            }
        } else {
            const enabledBranches = allBranches.filter(b => isBranchEnabled(b, shots));
            if (enabledBranches.length === 0) {
                alert("No enabled branches to stitch. Ctrl+Click takes in the graph to enable them.");
                return;
            }

            const msg = enabledBranches.length === 1
                ? `Stitch enabled branch (branch${String(enabledBranches[0].branchIndex).padStart(2, "0")})?`
                : `Stitch ${enabledBranches.length} enabled branches into separate videos?`;

            if (confirm(msg)) {
                ctx.executionEngine.executeStitchQueue(enabledBranches);
            }
        }
    });

    const hexToRgba = (hex, alpha) => {
        const clean = hex.replace("#", "");
        const r = parseInt(clean.substring(0, 2), 16);
        const g = parseInt(clean.substring(2, 4), 16);
        const b = parseInt(clean.substring(4, 6), 16);
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    };

    const computeBranchColors = (shots) => {
        const colorMap = new Map();
        let nextColorIdx = 0;

        shots.forEach((shot, sIdx) => {
            const takes = shot.takes || [];
            const edges = sIdx > 0 ? getEdgesBetween(shots, sIdx - 1, sIdx) : [];
            const siblingCounts = new Map();

            takes.forEach((take) => {
                const incoming = edges.filter(e => e.toTake === take.take_num);
                let color = null;

                if (incoming.length > 0) {
                    const pKey = `${sIdx - 1}:${incoming[0].fromTake}`;
                    const count = siblingCounts.get(pKey) || 0;
                    siblingCounts.set(pKey, count + 1);
                    if (count === 0 && colorMap.has(pKey)) {
                        color = colorMap.get(pKey);
                    }
                }

                if (!color) {
                    color = BRANCH_COLORS[nextColorIdx % BRANCH_COLORS.length];
                    nextColorIdx++;
                }
                colorMap.set(`${sIdx}:${take.take_num}`, color);
            });
        });

        return colorMap;
    };

    const drawConnections = (nodeElements, shots, colorMap, visibleCount) => {
        svg.innerHTML = "";

        const canvasRect = canvas.getBoundingClientRect();
        const scaleX = (canvasRect.width > 0 && canvas.offsetWidth > 0) ? canvasRect.width / canvas.offsetWidth : 1;
        const scaleY = (canvasRect.height > 0 && canvas.offsetHeight > 0) ? canvasRect.height / canvas.offsetHeight : 1;

        for (let sIdx = 1; sIdx < shots.length; sIdx++) {
            const prevShot = shots[sIdx - 1];
            const shot = shots[sIdx];
            const edges = getEdgesBetween(shots, sIdx - 1, sIdx);

            edges.forEach(({ fromTake, toTake }) => {
                const parentEl = nodeElements.get(`${sIdx - 1}:${fromTake}`);
                const childEl = nodeElements.get(`${sIdx}:${toTake}`);
                if (!parentEl || !childEl) return;

                const pRect = parentEl.getBoundingClientRect();
                const cRect = childEl.getBoundingClientRect();

                const x1 = (pRect.right - canvasRect.left) / scaleX;
                const y1 = (pRect.top + pRect.height / 2 - canvasRect.top) / scaleY;
                const x2 = (cRect.left - canvasRect.left) / scaleX;
                const y2 = (cRect.top + cRect.height / 2 - canvasRect.top) / scaleY;

                const midX = (x1 + x2) / 2;
                const path = document.createElementNS(svgNS, "path");
                path.setAttribute("d", `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`);
                path.setAttribute("fill", "none");

                const edgeDisabled = isTakeDisabled(shots, sIdx - 1, fromTake) || isTakeDisabled(shots, sIdx, toTake);

                if (edgeDisabled) {
                    path.setAttribute("stroke", "#555555");
                    path.setAttribute("stroke-width", "1.0");
                    path.setAttribute("opacity", "0.3");
                } else {
                    const isActiveBranch =
                        sIdx < visibleCount &&
                        shot.approved_take === toTake &&
                        prevShot &&
                        prevShot.approved_take === fromTake;

                    const branchColor = colorMap.get(`${sIdx - 1}:${fromTake}`) || colorMap.get(`${sIdx}:${toTake}`) || BRANCH_COLORS[0];
                    path.setAttribute("stroke", branchColor);
                    path.setAttribute("stroke-width", isActiveBranch ? "1.8" : "1.1");
                    path.setAttribute("opacity", isActiveBranch ? "0.95" : "0.35");
                }

                svg.appendChild(path);
            });
        }
    };

    const renderGraph = () => {
        canvas.innerHTML = "";
        canvas.appendChild(svg);

        const shots = ctx.stateManager.state.shots || [];
        const visibleCount = ctx.stateManager.visibleShotCount;
        const activeShotIdx = ctx.stateManager.selectedShotIndex;
        const nodeElements = new Map();
        const colorMap = computeBranchColors(shots);

        if (shots.length === 0) {
            const empty = document.createElement("div");
            empty.style.color = "var(--h3-text-disabled, #666)";
            empty.style.fontSize = "10px";
            empty.style.margin = "auto";
            empty.innerText = "No shots yet";
            canvas.appendChild(empty);
            return;
        }

        shots.forEach((shot, sIdx) => {
            const col = document.createElement("div");
            col.style.display = "flex";
            col.style.flexDirection = "column";
            col.style.alignItems = "center";
            col.style.gap = "4px";
            col.style.flex = "0 0 34px";
            col.style.position = "relative";
            col.style.zIndex = "2";

            const header = document.createElement("div");
            header.style.fontSize = "8px";
            header.style.fontFamily = "monospace";
            header.style.fontWeight = sIdx === activeShotIdx ? "700" : "500";
            header.style.color = sIdx === activeShotIdx
                ? "var(--h3-accent-cyan, #4fd1ff)"
                : (sIdx < visibleCount ? "var(--h3-text-dim, #888)" : "#555");
            header.style.marginBottom = "1px";
            header.title = shot.id || "";
            header.innerText = `S${String(sIdx + 1).padStart(2, "0")}`;
            col.appendChild(header);

            const takes = shot.takes || [];
            if (takes.length === 0) {
                const placeholder = document.createElement("div");
                placeholder.style.width = "30px";
                placeholder.style.height = "14px";
                placeholder.style.borderRadius = "2px";
                placeholder.style.border = "1px dashed #333";
                placeholder.style.display = "flex";
                placeholder.style.alignItems = "center";
                placeholder.style.justifyContent = "center";
                placeholder.style.fontSize = "8px";
                placeholder.style.color = "#555";
                placeholder.innerText = "--";
                col.appendChild(placeholder);
            } else {
                takes.forEach((take) => {
                    const isActive = sIdx < visibleCount && shot.approved_take === take.take_num;
                    const isDisabled = Boolean(take.disabled);
                    const branchColor = colorMap.get(`${sIdx}:${take.take_num}`) || BRANCH_COLORS[0];

                    const tag = document.createElement("button");
                    tag.type = "button";
                    tag.style.width = "30px";
                    tag.style.height = "14px";
                    tag.style.padding = "0";
                    tag.style.lineHeight = "12px";
                    tag.style.borderRadius = "2px";
                    tag.style.fontSize = "8px";
                    tag.style.fontFamily = "monospace";
                    tag.style.cursor = "pointer";
                    tag.style.transition = "0.12s";

                    if (isDisabled) {
                        tag.style.border = "1px solid #4a4a4a";
                        tag.style.background = "#2a2a2a";
                        tag.style.color = "#808080";
                        tag.style.fontWeight = "400";
                    } else {
                        tag.style.border = `1px solid ${isActive ? branchColor : hexToRgba(branchColor, 0.4)}`;
                        tag.style.background = isActive
                            ? hexToRgba(branchColor, 0.25)
                            : hexToRgba(branchColor, 0.06);
                        tag.style.color = isActive ? branchColor : hexToRgba(branchColor, 0.7);
                        tag.style.fontWeight = isActive ? "700" : "400";
                    }

                    tag.innerText = `T${String(take.take_num).padStart(2, "0")}`;
                    tag.title = isDisabled
                        ? `${shot.id} Take ${String(take.take_num).padStart(2, "0")} (Disabled — Ctrl+Click to enable)`
                        : `Load branch up to ${shot.id} Take ${String(take.take_num).padStart(2, "0")} (Ctrl+Click to disable)`;

                    tag.addEventListener("click", (e) => {
                        e.stopPropagation();
                        if (e.ctrlKey || e.metaKey) {
                            ctx.stateManager.toggleTakeDisabled(sIdx, take.take_num);
                            return;
                        }
                        ctx.stateManager.selectBranch(sIdx, take.take_num);
                        ctx.stateManager.selectShot(sIdx);
                    });

                    nodeElements.set(`${sIdx}:${take.take_num}`, tag);
                    col.appendChild(tag);
                });
            }

            canvas.appendChild(col);
        });

        requestAnimationFrame(() => drawConnections(nodeElements, shots, colorMap, visibleCount));
    };

    ctx.stateManager.subscribe((event, _sm, payload) => {
        if (event === EVENTS.RENDER_STATE_CHANGED) {
            setStitchingVisual(Boolean(payload?.isRendering), payload?.mode);
        } else if ([
            EVENTS.PROJECT_LOADED,
            EVENTS.SHOT_ADDED,
            EVENTS.SHOT_DELETED,
            EVENTS.HISTORY_RESTORED,
            EVENTS.SHOT_SELECTED,
            EVENTS.TAKE_ADDED,
            EVENTS.TAKE_APPROVED,
            EVENTS.TAKE_DELETED,
            EVENTS.TAKE_DISABLED_CHANGED,
            EVENTS.BRANCH_SELECTED
        ].includes(event)) {
            renderGraph();
        }
    });

    return { element: outer, renderGraph };
}