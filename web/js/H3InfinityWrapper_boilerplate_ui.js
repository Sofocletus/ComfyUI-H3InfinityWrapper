import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js"; 

window.H3InfinityWrapper = window.H3InfinityWrapper || {};

app.registerExtension({
    name: "ComfyUI.H3InfinityWrapper.Boilerplate",
    
    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name === "H3InfinityWrapper_Controller") {
            
            const onNodeCreated = nodeType.prototype.onNodeCreated;
            nodeType.prototype.onNodeCreated = function () {
                if (onNodeCreated) onNodeCreated.apply(this, arguments);
                
                // ====================================================================
                // 1. ADD BUTTONS
                // ====================================================================
                this.addWidget("button", "▶️ RUN API WORKFLOW", null, async () => {
                    if (this.isCurrentlyRendering) {
                        console.log("H3 Wrapper: Render already in progress. Ignoring click.");
                        return; 
                    }

                    try {
                        this.isCurrentlyRendering = true; 

                        const getW = (name) => {
                            const w = this.widgets.find(w => w.name === name);
                            if (!w) throw new Error(`Missing widget: ${name}`);
                            return w.value;
                        };

                        const payload = {
                            project_name: getW("project_name"),
                            mode: getW("mode"),
                            shot_number: parseInt(getW("shot_number")),
                            take_number: parseInt(getW("take_number")),
                            prompt: getW("prompt"),
                            width: parseInt(getW("width")),
                            height: parseInt(getW("height")),
                            duration: parseFloat(getW("duration")),
                            seed: parseInt(getW("seed")),
                            
                            steps: parseInt(getW("steps")),
                            scheduler: getW("scheduler"),
                            sampler_name: getW("sampler_name"),
                            context_frames: parseInt(getW("context_frames")),
                            unet_model: getW("unet_model"),
                            diffusion_model: getW("diffusion_model"),
                            
                            active_1: Boolean(getW("active_1")),
                            lora_1: getW("lora_1"),
                            lora_strength_1: parseFloat(getW("lora_strength_1")),
                            
                            active_2: Boolean(getW("active_2")),
                            lora_2: getW("lora_2"),
                            lora_strength_2: parseFloat(getW("lora_strength_2")),
                            
                            first_frame_path: getW("first_frame_path"),
                            last_frame_path: getW("last_frame_path"),
                            
                            client_id: api.clientId
                        };

                        const response = await fetch("/h3_wrapper/test_execute", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify(payload)
                        });
                        
                        if (!response.ok) throw new Error(`Server returned ${response.status}`);
                        const result = await response.json();
                        if (result.error) { 
                            throw new Error(result.error); 
                        }

                        if (result.absolute_preview_path) {
                            this.pendingVideoUrl = `/h3_wrapper/view_media?path=${encodeURIComponent(result.absolute_preview_path)}`;
                            
                            if (payload.mode === "Stitch") {
                                this.pendingStitchDestination = result.absolute_preview_path;
                            } else {
                                this.pendingStitchDestination = null; 
                            }
                        }

                        this.monitor.setStatus("Initializing Models...");

                        const queueResp = await fetch("/prompt", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ prompt: result.workflow, client_id: api.clientId })
                        });
                        
                        if (!queueResp.ok) {
                            const errText = await queueResp.text();
                            throw new Error(`Queue Failed: ${errText}`);
                        }
                        
                        const queueData = await queueResp.json();
                        this.pendingPromptId = queueData.prompt_id;
                        
                    } catch (e) {
                        alert("Frontend Error: " + e.message);
                        this.isCurrentlyRendering = false; 
                        this.monitor.setStatus("Error (Ready)");
                    } finally {
                        if (!this.pendingPromptId) {
                            this.isCurrentlyRendering = false;
                        }
                    }
                });

                this.addWidget("button", "✅ APPROVE CURRENT TAKE", null, async () => {
                    try {
                        const payload = {
                            project_name: this.widgets.find(w => w.name === "project_name").value,
                            shot_number: this.widgets.find(w => w.name === "shot_number").value,
                            take_number: this.widgets.find(w => w.name === "take_number").value,
                        };
                        await fetch("/h3_wrapper/approve_take", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
                        alert(`Approved Shot ${payload.shot_number}, Take ${payload.take_number}`);
                    } catch (e) { alert("Error: " + e.message); }
                });

                // ====================================================================
                // 2. DOM MONITOR
                // ====================================================================
                const container = document.createElement("div");
                container.style.width = "100%";
                container.style.height = "100%"; 
                container.style.backgroundColor = "#080808"; 
                container.style.display = "flex";
                container.style.justifyContent = "center";
                container.style.alignItems = "center";
                container.style.borderRadius = "4px";
                container.style.border = "1px solid #333";
                container.style.overflow = "hidden";
                container.style.position = "relative";
                
                const textEl = document.createElement("div");
                textEl.innerText = "Preview Monitor (Ready)";
                textEl.style.color = "#888";
                textEl.style.fontFamily = "monospace";
                container.appendChild(textEl);
                
                const imgEl = document.createElement("img");
                imgEl.style.width = "100%";
                imgEl.style.height = "100%";
                imgEl.style.objectFit = "contain";
                imgEl.style.display = "none";
                container.appendChild(imgEl);

                const vidEl = document.createElement("video");
                vidEl.style.width = "100%";
                vidEl.style.height = "100%";
                vidEl.style.objectFit = "contain";
                vidEl.style.display = "none";
                vidEl.autoplay = true;
                vidEl.loop = true;
                vidEl.muted = true;
                vidEl.controls = true;
                container.appendChild(vidEl);

                const stepEl = document.createElement("div");
                stepEl.style.position = "absolute";
                stepEl.style.bottom = "5px";
                stepEl.style.left = "8px";
                stepEl.style.color = "#00FF00"; 
                stepEl.style.fontSize = "12px";
                stepEl.style.fontFamily = "monospace";
                stepEl.style.textShadow = "1px 1px 2px black";
                stepEl.innerText = "";
                container.appendChild(stepEl);

                const domWidget = this.addDOMWidget("video_monitor", "div", container, { serialize: false, hideOnZoom: false });
                domWidget.computeSize = function() { return [430, 250]; }; 

                this.monitor = {
                    isFinalizing: false,
                    
                    setStatus: (msg) => { 
                        this.monitor.isFinalizing = false; 
                        textEl.style.display="block"; textEl.innerText=msg; 
                        imgEl.style.display="none"; vidEl.style.display="none"; stepEl.innerText=""; 
                    },
                    
                    showLiveFrame: (url, mime) => { 
                        if (this.monitor.isFinalizing) return; 
                        
                        textEl.style.display="none"; 
                        if (mime && mime.includes("video")) {
                            imgEl.style.display="none";
                            vidEl.style.display="block";
                            vidEl.src = url;
                        } else {
                            vidEl.style.display="none";
                            imgEl.style.display="block"; 
                            imgEl.src = url; 
                        }
                    },
                    
                    playFinalVideo: (url) => { 
                        this.monitor.isFinalizing = true; 
                        textEl.style.display="none"; 
                        imgEl.style.display="none"; 
                        vidEl.style.display="block"; 
                        stepEl.innerText="FINAL RENDER"; 
                        
                        vidEl.src = url + "&t=" + Date.now();
                        vidEl.load(); 
                    },
                    
                    updateStep: (step, total) => { 
                        if (this.monitor.isFinalizing) return;
                        stepEl.innerText = `Step: ${step} / ${total}`; 
                    }
                };

                const oldCompute = this.computeSize;
                this.computeSize = function(out) {
                    let s = oldCompute ? oldCompute.apply(this, arguments) : [450, 900];
                    s[0] = Math.max(s[0], 450);
                    s[1] = Math.max(s[1], 900); 
                    return s;
                };

                this.size = [450, 900];
            };
        }
    },

    async setup() {
        api.addEventListener("progress", (event) => {
            const p = event.detail.value;
            const max = event.detail.max;
            const nodes = app.graph.findNodesByType("H3InfinityWrapper_Controller");
            for (const n of nodes) {
                if (n.monitor && p > 0 && n.monitor.stepEl && n.monitor.stepEl.innerText === "") {
                    n.monitor.setStatus(`Generating... (${p} / ${max})`);
                }
            }
        });

        api.addEventListener("kj_preview_override", (event) => {
            const detail = event.detail;
            if (!detail) return;

            const nodes = app.graph.findNodesByType("H3InfinityWrapper_Controller");
            for (const n of nodes) {
                if (n.monitor) {
                    if (detail.step !== undefined && detail.total !== undefined) {
                        n.monitor.updateStep(detail.step, detail.total);
                    }
                    if (detail.image) {
                        const mime = detail.mime || "image/jpeg";
                        const b64Url = `data:${mime};base64,${detail.image}`;
                        n.monitor.showLiveFrame(b64Url, mime);
                    }
                }
            }
        });

        api.addEventListener("execution_error", (event) => {
            const detail = event.detail;
            if (!detail) return;

            const nodes = app.graph.findNodesByType("H3InfinityWrapper_Controller");
            for (const n of nodes) {
                if (n.pendingPromptId === detail.prompt_id || n.isCurrentlyRendering) {
                    console.warn("H3 Wrapper: Execution error detected. Resetting controller state.");
                    n.isCurrentlyRendering = false;
                    n.pendingPromptId = null;
                    n.pendingStitchDestination = null;
                    n.pendingVideoUrl = null;
                    if (n.monitor) {
                        n.monitor.setStatus("Execution Error (Ready)");
                    }
                }
            }
        });

        api.addEventListener("status", async (event) => {
            if (event.detail && event.detail.exec_info && event.detail.exec_info.queue_remaining === 0) {
                const nodes = app.graph.findNodesByType("H3InfinityWrapper_Controller");
                for (const n of nodes) {
                    
                    if (n.isCurrentlyRendering) {
                        n.isCurrentlyRendering = false; 
                        n.pendingPromptId = null;
                        
                        if (n.pendingStitchDestination) {
                            try {
                                await fetch('/h3_wrapper/finalize_video', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ dest_mp4: n.pendingStitchDestination })
                                });
                                console.log(`H3 Wrapper: Moved finalized MP4 to ${n.pendingStitchDestination}`);
                            } catch (e) {
                                console.error("H3 Wrapper Finalize Error: ", e);
                            }
                            n.pendingStitchDestination = null;
                        }
    
                        if (n.monitor && n.pendingVideoUrl) {
                            setTimeout(() => {
                                n.monitor.playFinalVideo(n.pendingVideoUrl);
                                n.pendingVideoUrl = null;
                            }, 500);
                        }
                    }
                }
            }
        });
    }
});