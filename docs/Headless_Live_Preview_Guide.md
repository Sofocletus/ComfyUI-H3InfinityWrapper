# Headless ComfyUI: Live Preview & Custom WebSocket Integration Guide

This document details the architecture and solutions required to successfully display live generation previews from a headless (hidden) API workflow on a custom dummy/controller node in ComfyUI.

## 1. The Core Problems

When running a workflow via the API where the execution nodes (like Samplers) do not physically exist on the user's canvas, standard preview mechanics fail due to three primary reasons:

1. **Custom Event Channels:** Optimized preview nodes (like `ModelPreviewOverrideKJ`) often bypass ComfyUI's standard `b_preview` binary channel to send compressed Base64 strings over custom JSON channels (e.g., `kj_preview_override`). 
2. **Missing Target Nodes:** Custom frontend scripts typically intercept these custom messages and attempt to draw the image onto the specific node ID that generated it. Because the API workflow is headless, that node ID doesn't exist on the visual canvas, causing the script to silently discard the frame.
3. **LiteGraph Canvas Collapse:** Attempting to draw custom video frames onto a node using HTML5 Canvas (`ctx.drawImage` via `onDrawBackground`) fails because ComfyUI's underlying engine (LiteGraph) aggressively recalculates node bounding boxes based on UI widgets. It will snap the node shut, completely hiding custom canvas drawings.

---

## 2. The Frontend Solution: HTML DOM Monitors

To prevent LiteGraph from collapsing the node, bypass the canvas completely and inject HTML DOM elements directly into the node. LiteGraph is forced to wrap its bounding box around DOM elements.

### Key Implementation Rules:
* **Widget Order Matters:** You MUST define your standard UI widgets (`this.addWidget`) **before** adding the DOM widget. If the DOM widget is added first, LiteGraph will render the UI buttons physically overlapping the monitor.
* **Prototype Injection:** DOM setup should occur inside a hijacked `nodeType.prototype.onNodeCreated` during the `beforeRegisterNodeDef` phase.

```javascript
// Example of injecting an unbreakable HTML Monitor
const container = document.createElement("div");
container.style.width = "100%";
container.style.height = "100%"; 

const imgEl = document.createElement("img");
imgEl.style.width = "100%";
imgEl.style.height = "100%";
imgEl.style.objectFit = "contain";
container.appendChild(imgEl);

// Hide DOM elements from node serialization
const domWidget = this.addDOMWidget("video_monitor", "div", container, { serialize: false, hideOnZoom: false });
domWidget.computeSize = function() { return [430, 250]; }; // Enforce minimum size for the video player
```

---

## 3. The WebSocket Interceptor

To capture live frames from custom nodes, you must write a global event listener that taps into their specific broadcast channel.

For `ModelPreviewOverrideKJ`, it broadcasts on `kj_preview_override` and delivers a JSON payload containing a Base64 string and MIME type (which can dynamically switch between `image/jpeg`, `image/webp`, or even `video/mp4`).

```javascript
api.addEventListener("kj_preview_override", (event) => {
    const detail = event.detail;
    if (!detail) return;

    // Find our controller nodes on the canvas
    const nodes = app.graph.findNodesByType("H3InfinityWrapper_Controller");
    for (const n of nodes) {
        if (n.monitor) {
            // 1. Update text step counter
            if (detail.step !== undefined) {
                n.monitor.updateStep(detail.step, detail.total);
            }
            
            // 2. Decode Base64 and route to <img> or <video> based on MIME
            if (detail.image) {
                const mime = detail.mime || "image/jpeg";
                const b64Url = `data:${mime};base64,${detail.image}`;
                n.monitor.showLiveFrame(b64Url, mime);
            }
        }
    }
});
```

*Note: To ensure ComfyUI routes the WebSocket messages to your specific browser session during a headless execution, you MUST include `client_id: api.clientId` in your `/prompt` POST request.*

---

## 4. The Backend Solution: Absolute Path Streaming

By default, ComfyUI's native `/view` endpoint restricts access to files generated inside its root `output/` directory for security reasons. If your wrapper saves files to absolute paths (e.g., `D:/Projects/Film/`), the frontend will be blocked from loading the final preview `.mp4`.

**Solution:** Create a custom media-serving route in your `server.py` (or routing file) that accepts absolute paths.

```python
from aiohttp import web
import os

@prompt_server.routes.get("/h3_wrapper/view_media")
async def view_media(request):
    path = request.query.get("path")
    if not path or not os.path.exists(path):
        return web.Response(status=404, text="File not found")
    return web.FileResponse(path)
```
*Frontend Usage:*
`const finalUrl = "/h3_wrapper/view_media?path=" + encodeURIComponent("D:/Projects/video.mp4");`

---

## 5. Crucial Developer Gotchas

1. **The Ghost Node Cache:** If you modify `computeSize`, widget ordering, or prototype methods in your `.js` file, **refreshing the browser is not enough.** ComfyUI saves the old, broken node dimensions in your local browser cache. You MUST delete the node from the canvas and add a new one to inherit the new prototype rules.
2. **Harmless Tracking Errors:** When submitting a headless graph, ComfyUI's `prompt_service.js` will throw an `Uncaught (in promise)` error in the console. This happens because the frontend tries to visually highlight the currently executing node in green, but fails to find it on your canvas. This is purely cosmetic and does not affect the backend generation.