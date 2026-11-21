import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import { H3StateManager } from "./StateManager.js";
import { createExecutionEngine } from "./ExecutionEngine.js";

import { createLeftPanel } from "./UI_LeftPanel.js";
import { createCenterPlayer } from "./UI_CenterPlayer.js";
import { createRightPanel } from "./UI_RightPanel.js";
import { createTimeline } from "./UI_Timeline.js";
import { createGallery } from "./UI_Gallery.js";

// Inject CSS automatically
const cssUrl = new URL("style.css", import.meta.url).href;
const link = document.createElement("link");
link.rel = "stylesheet";
link.type = "text/css";
link.href = cssUrl;
document.head.appendChild(link);

app.registerExtension({
    name: "ComfyUI.H3InfinityWrapper.ProjectManager",
    
    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name === "H3InfinityWrapper_ProjectManager") {
            
            const onNodeCreated = nodeType.prototype.onNodeCreated;
            nodeType.prototype.onNodeCreated = function () {
                if (onNodeCreated) onNodeCreated.apply(this, arguments);

                const stateManager = new H3StateManager(api);

                const container = document.createElement("div");
                container.className = "h3-container";
                
                const topLayout = document.createElement("div");
                topLayout.className = "h3-top-layout";
                
                const timelineContainer = document.createElement("div");
                const galleryContainer = document.createElement("div");

                const ctx = {
                    node: this,
                    app: app,
                    api: api,
                    stateManager: stateManager,
                    executionEngine: null,
                    components: {} 
                };

                ctx.executionEngine = createExecutionEngine(ctx);

                ctx.components.leftPanel = createLeftPanel(ctx);
                ctx.components.centerPlayer = createCenterPlayer(ctx);
                ctx.components.rightPanel = createRightPanel(ctx);
                ctx.components.timeline = createTimeline(ctx);
                ctx.components.gallery = createGallery(ctx);

                topLayout.appendChild(ctx.components.leftPanel.element);
                topLayout.appendChild(ctx.components.centerPlayer.element);
                topLayout.appendChild(ctx.components.rightPanel.element);
                
                timelineContainer.appendChild(ctx.components.timeline.element);
                galleryContainer.appendChild(ctx.components.gallery.element);

                container.appendChild(topLayout);
                container.appendChild(timelineContainer);
                container.appendChild(galleryContainer);

                const domWidget = this.addDOMWidget("h3_nle_ui", "div", container, { serialize: false, hideOnZoom: false });
                domWidget.computeSize = function() { 
                    return [1340, 748]; 
                }; 
                this.size = [1340, 748];

                // Load Options, then restore last project from ui_state.json
                (async () => {
                    await stateManager.fetchOptions();
                    const uiState = await stateManager.loadUiState();
                    const initialProject = uiState.last_project || "My_Project";
                    await stateManager.loadProject(initialProject);
                })();
            };
        }
    }
});