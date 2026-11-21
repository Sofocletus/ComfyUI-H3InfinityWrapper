export function createExecutionEngine(ctx) {
    let isRendering = false;
    let renderingMode = null; // "Generate" | "Stitch" | null
    let pendingPromptId = null;
    let pendingJob = null;
    let stitchQueue = [];
    let pendingShotQueue = [];
    let currentPreviewUrl = null;

    const setRenderingState = (active, mode = null) => {
        isRendering = active;
        renderingMode = active ? mode : null;
        ctx.stateManager.notify("RENDER_STATE_CHANGED", { isRendering: active, mode: renderingMode });
    };

    const setStatus = (text, color = "var(--h3-text-secondary)") => {
        ctx.components.centerPlayer?.setStatusText?.(text, color);
    };

    const clearPreview = () => {
        if (currentPreviewUrl) {
            URL.revokeObjectURL(currentPreviewUrl);
            currentPreviewUrl = null;
        }
        ctx.components.centerPlayer?.clearLivePreview?.();
    };

    const cancelGeneration = async () => {
        pendingShotQueue = [];
        stitchQueue = [];
        pendingJob = null;
        pendingPromptId = null;
        setRenderingState(false, null);
        clearPreview();
        setStatus("Cancelled", "var(--h3-accent-red)");

        try {
            await fetch("/interrupt", { method: "POST" });
        } catch (e) {
            console.error("H3 Wrapper: Failed to interrupt ComfyUI execution", e);
        }

        setTimeout(() => {
            if (!isRendering) setStatus("Ready");
        }, 2000);
    };

    const validateWorkflowSupportsMode = (mode) => {
        if (mode !== "Lead" && mode !== "Bridge") return true;
        const wfName = ctx.stateManager.state.global.workflow || "Default";
        const wfMeta = (ctx.stateManager.options.workflows || []).find(w => w.name === wfName);
        if (!wfMeta) return true;

        if (mode === "Lead" && !wfMeta.has_lead) {
            alert(`Workflow "${wfName}" does not have an api_lead template.`);
            return false;
        }
        if (mode === "Bridge" && !wfMeta.has_bridge) {
            alert(`Workflow "${wfName}" does not have an api_bridge template.`);
            return false;
        }
        return true;
    };

    const executeWorkflow = async (mode = null, shotIndex = 0, stitchConfig = null) => {
        if (isRendering) return;

        const resolvedMode = stitchConfig
            ? "Stitch"
            : (mode || ctx.stateManager.detectShotMode(shotIndex));

        if (!validateWorkflowSupportsMode(resolvedMode)) return;

        ctx.components.centerPlayer?.stopPlayback?.();
        setRenderingState(true, resolvedMode === "Stitch" ? "Stitch" : "Generate");

        const state = ctx.stateManager.state;
        const shot = state.shots[shotIndex] || {};
        const statusLabel = stitchConfig
            ? `Stitching branch${String(stitchConfig.branchIndex).padStart(2, "0")}...`
            : `Initializing ${resolvedMode} (${shot.id || `S${shotIndex + 1}`})...`;
        setStatus(statusLabel, "var(--h3-accent-amber)");
        clearPreview();

        try {
            const global = state.global;
            const visibleShots = ctx.stateManager.getVisibleShots();
            const prevShot = shotIndex > 0 ? visibleShots[shotIndex - 1] : null;
            const nextShot = shotIndex < visibleShots.length - 1 ? visibleShots[shotIndex + 1] : null;

            const frames = shot.duration_frames !== undefined ? shot.duration_frames : 124;
            const durationSec = Number((frames / 24.0).toFixed(4));
            const nextTakeNum = (shot.takes?.length || 0) + 1;
            const shotSeed = shot.seed !== undefined ? shot.seed : 123456789;
            const parentTake = prevShot && ctx.stateManager.hasGeneratedTake(prevShot)
                ? prevShot.approved_take
                : null;
            const nextTake = nextShot && ctx.stateManager.hasGeneratedTake(nextShot)
                ? nextShot.approved_take
                : null;

            const shotPrompt = (shot.prompt || "").trim();
            let finalPrompt = shotPrompt;
            if (global.global_prompt && global.global_prompt.trim()) {
                finalPrompt = finalPrompt
                    ? `${finalPrompt}\n${global.global_prompt.trim()}`
                    : global.global_prompt.trim();
            }

            const payload = {
                project_name: state.project_name,
                mode: resolvedMode,
                workflow_name: global.workflow || "Default",
                shot_id: shot.id,
                shot_number: shotIndex + 1,
                take_number: nextTakeNum,
                prev_shot_id: prevShot ? prevShot.id : null,
                prev_take_number: parentTake,
                next_shot_id: nextShot ? nextShot.id : null,
                next_take_number: nextTake,
                width: global.width,
                height: global.height,
                steps: global.steps,
                scheduler: global.scheduler,
                sampler_name: global.sampler_name,
                context_frames: global.context_frames,
                unet_model: global.unet_model,
                diffusion_model: global.diffusion_model,
                global_lora_active: global.global_lora_active || false,
                global_lora: global.global_lora || "",
                global_lora_strength: global.global_lora_strength !== undefined ? global.global_lora_strength : 1.0,
                duration: durationSec,
                seed: shotSeed,
                prompt: finalPrompt,
                shot_prompt: shotPrompt,
                active_1: shot.active_1 || false,
                lora_1: shot.lora_1 || "",
                lora_strength_1: shot.lora_strength_1 !== undefined ? shot.lora_strength_1 : 0,
                active_2: shot.active_2 || false,
                lora_2: shot.lora_2 || "",
                lora_strength_2: shot.lora_strength_2 !== undefined ? shot.lora_strength_2 : 0,
                first_frame_path: shot.first_frame || "",
                last_frame_path: shot.last_frame || "",
                client_id: ctx.api.clientId
            };

            if (stitchConfig) {
                payload.stitch_takes = stitchConfig.takes;
                payload.branch_index = stitchConfig.branchIndex;
            }

            const response = await fetch("/h3_wrapper/test_execute", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });

            const result = await response.json();
            if (result.error) throw new Error(result.error);

            pendingJob = {
                mode: resolvedMode,
                shotIndex,
                takeNum: nextTakeNum,
                parentTake,
                nextTake,
                prompt: shotPrompt,
                seed: shotSeed,
                duration_frames: frames,
                active_1: shot.active_1 || false,
                lora_1: shot.lora_1 || "None",
                lora_strength_1: shot.lora_strength_1 !== undefined ? shot.lora_strength_1 : 0,
                active_2: shot.active_2 || false,
                lora_2: shot.lora_2 || "None",
                lora_strength_2: shot.lora_strength_2 !== undefined ? shot.lora_strength_2 : 0,
                first_frame: shot.first_frame || "",
                last_frame: shot.last_frame || "",
                preview_path: result.absolute_preview_path,
                project_name: state.project_name
            };

            const queueResp = await fetch("/prompt", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ prompt: result.workflow, client_id: ctx.api.clientId })
            });

            const queueData = await queueResp.json();
            if (queueData.error) throw new Error(queueData.error);
            pendingPromptId = queueData.prompt_id;

        } catch (e) {
            console.error("Execution Error:", e);
            setStatus("Error!", "var(--h3-accent-red)");
            pendingJob = null;
            stitchQueue = [];
            pendingShotQueue = [];
            setRenderingState(false, null);
            clearPreview();
        }
    };

    const executeStitchQueue = (branches) => {
        if (isRendering || !Array.isArray(branches) || branches.length === 0) return;
        stitchQueue = branches.slice();
        const first = stitchQueue.shift();
        executeWorkflow("Stitch", 0, first);
    };

    const executePendingQueue = (shotIndices) => {
        if (isRendering || !Array.isArray(shotIndices) || shotIndices.length === 0) return;
        pendingShotQueue = shotIndices.slice();
        const firstIdx = pendingShotQueue.shift();
        ctx.stateManager.selectShot(firstIdx);
        executeWorkflow(null, firstIdx);
    };

    // ==========================================
    // WEBSOCKET LISTENERS
    // ==========================================
    ctx.api.addEventListener("progress", (event) => {
        if (!isRendering) return;
        const p = event.detail.value;
        const max = event.detail.max;
        setStatus(`Generating (${p}/${max})...`, "var(--h3-accent-amber)");
    });

    ctx.api.addEventListener("b_preview", (event) => {
        if (!isRendering || !event.detail) return;
        if (currentPreviewUrl) URL.revokeObjectURL(currentPreviewUrl);
        currentPreviewUrl = URL.createObjectURL(event.detail);
        ctx.components.centerPlayer?.showLiveFrame?.(currentPreviewUrl, event.detail.type || "image/jpeg");
    });

    ctx.api.addEventListener("kj_preview_override", (event) => {
        if (!isRendering) return;
        const detail = event.detail;
        if (!detail) return;

        if (detail.step !== undefined && detail.total !== undefined) {
            setStatus(`Step: ${detail.step} / ${detail.total}`, "var(--h3-accent-amber)");
        }
        if (detail.image) {
            const mime = detail.mime || "image/jpeg";
            ctx.components.centerPlayer?.showLiveFrame?.(`data:${mime};base64,${detail.image}`, mime);
        }
    });

    ctx.api.addEventListener("execution_error", (event) => {
        const detail = event.detail;
        if (!detail) return;
        if (pendingPromptId === detail.prompt_id || isRendering) {
            pendingPromptId = null;
            pendingJob = null;
            stitchQueue = [];
            pendingShotQueue = [];
            setRenderingState(false, null);
            clearPreview();
            setStatus("Execution Error", "var(--h3-accent-red)");
        }
    });

    ctx.api.addEventListener("status", async (event) => {
        if (isRendering && event.detail?.exec_info?.queue_remaining === 0) {
            const finishedJob = pendingJob;
            pendingPromptId = null;
            pendingJob = null;
            clearPreview();

            if (finishedJob) {
                if (finishedJob.mode === "Stitch") {
                    try {
                        await fetch("/h3_wrapper/finalize_video", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ dest_mp4: finishedJob.preview_path })
                        });
                        if (stitchQueue.length > 0) {
                            const nextBranch = stitchQueue.shift();
                            isRendering = false;
                            setTimeout(() => executeWorkflow("Stitch", 0, nextBranch), 300);
                            return;
                        }
                        setRenderingState(false, null);
                        setStatus("Complete", "var(--h3-accent-green)");
                        setTimeout(() => {
                            ctx.components.centerPlayer?.loadVideoPath?.(finishedJob.preview_path, -1, 0, false, true);
                        }, 500);
                    } catch (e) {
                        console.error("H3 Wrapper: Error finalizing stitched video", e);
                        stitchQueue = [];
                        setRenderingState(false, null);
                    }
                } else {
                    const shot = ctx.stateManager.state.shots[finishedJob.shotIndex];
					if (shot) {
                        ctx.stateManager.selectShot(finishedJob.shotIndex);
                        ctx.stateManager.addTakeToActiveShot({
                            take_num: finishedJob.takeNum,
                            mode: finishedJob.mode,
                            parent_take: finishedJob.parentTake,
                            next_take: finishedJob.nextTake,
                            preview_path: finishedJob.preview_path,
                            prompt: finishedJob.prompt,
                            seed: finishedJob.seed,
                            duration_frames: finishedJob.duration_frames,
                            active_1: finishedJob.active_1,
                            lora_1: finishedJob.lora_1,
                            lora_strength_1: finishedJob.lora_strength_1,
                            active_2: finishedJob.active_2,
                            lora_2: finishedJob.lora_2,
                            lora_strength_2: finishedJob.lora_strength_2,
                            first_frame: finishedJob.first_frame,
                            last_frame: finishedJob.last_frame
                        });

                        if (needsApproval) {
                            await ctx.stateManager.syncTakeApproval(finishedJob.shotIndex, finishedJob.takeNum);
                        }

                        if (pendingShotQueue.length > 0) {
                            const nextIdx = pendingShotQueue.shift();
                            ctx.stateManager.selectShot(nextIdx);
                            isRendering = false;
                            setTimeout(() => executeWorkflow(null, nextIdx), 300);
                            return;
                        }

                        setRenderingState(false, null);
                        setStatus("Complete", "var(--h3-accent-green)");

                        const range = ctx.components.timeline?.getShotTimeRange(finishedJob.shotIndex);
                        const startOffset = range ? range.headTrimSec : 0;
                        setTimeout(() => {
                            ctx.components.centerPlayer?.loadVideoPath?.(finishedJob.preview_path, finishedJob.shotIndex, startOffset, false, true);
                        }, 500);
                    } else {
                        setRenderingState(false, null);
                    }
                }
            } else {
                setRenderingState(false, null);
            }

            setTimeout(() => {
                if (!isRendering) setStatus("Ready");
            }, 2000);
        }
    });

    return {
        executeWorkflow,
        executeStitchQueue,
        executePendingQueue,
        cancelGeneration,
        getIsRendering: () => isRendering,
        getRenderingMode: () => renderingMode
    };
}