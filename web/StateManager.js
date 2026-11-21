import {
    getIncomingLinks as _getIncomingLinks,
    getOutgoingLinks as _getOutgoingLinks,
    getParentTake as _getParentTake
} from "./UI_BranchGraph.js";

export const EVENTS = {
    STATE_UPDATED: "STATE_UPDATED",
    OPTIONS_LOADED: "OPTIONS_LOADED",
    PROJECT_LOADED: "PROJECT_LOADED",
    GLOBAL_UPDATED: "GLOBAL_UPDATED",
    SHOT_ADDED: "SHOT_ADDED",
    SHOT_DELETED: "SHOT_DELETED",
    SHOT_SELECTED: "SHOT_SELECTED",
    SHOT_UPDATED: "SHOT_UPDATED",
    TAKE_ADDED: "TAKE_ADDED",
    TAKE_APPROVED: "TAKE_APPROVED",
    TAKE_DELETED: "TAKE_DELETED",
    TAKE_DISABLED_CHANGED: "TAKE_DISABLED_CHANGED",
    BRANCH_SELECTED: "BRANCH_SELECTED",
    HISTORY_RESTORED: "HISTORY_RESTORED",
    RENDER_STATE_CHANGED: "RENDER_STATE_CHANGED"
};

export class H3StateManager {
    constructor(api) {
        this.api = api;
        this.listeners = [];
        this.maxHistory = 3;
        this._saveTimer = null;
        this._saveDebounceMs = 300;
        this.options = {
            workflows: [],
            unet_models: [],
            diffusion_models: [],
            loras: [],
            samplers: [],
            schedulers: []
        };

        this.state = {
            project_name: "My_First_Film",
            global: {
                workflow: "Default",
                unet_model: "",
                diffusion_model: "",
                steps: 20,
                sampler_name: "euler",
                scheduler: "normal",
                context_frames: 39,
                width: 864,
                height: 480,
                global_lora_active: false,
                global_lora: "None",
                global_lora_strength: 1.0,
                global_prompt_enabled: false,
                global_prompt: ""
            },
            shots: [],
            history: []
        };

        this.selectedShotIndex = -1;
        this.visibleShotCount = 0;
        this.activeTake = null;
    }

    // --- Event System ---
    subscribe(callback) {
        this.listeners.push(callback);
    }

    notify(eventType = EVENTS.STATE_UPDATED, payload = null) {
        this.listeners.forEach(cb => cb(eventType, this, payload));
    }

    // --- Non-Destructive Timeline History (Last 3 Structural Changes) ---
    pushHistory() {
        if (!Array.isArray(this.state.history)) {
            this.state.history = [];
        }
        const snapshot = {
            shots: JSON.parse(JSON.stringify(this.state.shots || [])),
            selectedShotIndex: this.selectedShotIndex,
            visibleShotCount: this.visibleShotCount
        };
        this.state.history.push(snapshot);
        if (this.state.history.length > this.maxHistory) {
            this.state.history = this.state.history.slice(-this.maxHistory);
        }
    }

    canUndo() {
        return Array.isArray(this.state.history) && this.state.history.length > 0;
    }

    getUndoCount() {
        return Array.isArray(this.state.history) ? this.state.history.length : 0;
    }

    undo() {
        if (!this.canUndo()) return;
        const snapshot = this.state.history.pop();
        this.state.shots = snapshot.shots || [];
        this.visibleShotCount = Math.min(
            snapshot.visibleShotCount || this.state.shots.length,
            this.state.shots.length
        );
        this.selectedShotIndex = Math.min(
            snapshot.selectedShotIndex !== undefined ? snapshot.selectedShotIndex : 0,
            this.state.shots.length - 1
        );
        this.notify(EVENTS.HISTORY_RESTORED);
        this.saveProject(true);
    }

    // --- Timestamp Shot ID Generator (YYMMDD_HHMMt) ---
    generateShotId() {
        const now = new Date();
        const yy = String(now.getFullYear()).slice(-2);
        const mm = String(now.getMonth() + 1).padStart(2, "0");
        const dd = String(now.getDate()).padStart(2, "0");
        const hh = String(now.getHours()).padStart(2, "0");
        const min = String(now.getMinutes()).padStart(2, "0");
        const tenth = String(Math.floor(now.getSeconds() / 6));
        const base = `${yy}${mm}${dd}_${hh}${min}${tenth}`;

        const existingIds = new Set((this.state.shots || []).map(s => s.id));
        if (!existingIds.has(base)) return base;

        let suffix = 1;
        while (existingIds.has(`${base}_${suffix}`)) {
            suffix++;
        }
        return `${base}_${suffix}`;
    }

    // --- Shared Shot / Take Helpers ---
    getActiveTake(shot) {
        if (!shot || !shot.takes || shot.takes.length === 0) return null;
        return shot.takes.find(t => t.take_num === shot.approved_take) || shot.takes[shot.takes.length - 1];
    }

    getShotVideoPath(shot) {
        const take = this.getActiveTake(shot);
        return take ? take.preview_path : null;
    }

    hasGeneratedTake(shot) {
        return Boolean(shot && shot.takes && shot.takes.length > 0 && shot.approved_take !== null && shot.approved_take !== undefined);
    }

    detectShotMode(index) {
        const shots = this.getVisibleShots();
        if (index < 0 || index >= shots.length) return "Start";

        const prevShot = index > 0 ? shots[index - 1] : null;
        const nextShot = index < shots.length - 1 ? shots[index + 1] : null;

        const hasPrev = this.hasGeneratedTake(prevShot);
        const hasNext = this.hasGeneratedTake(nextShot);

        if (hasPrev && hasNext) return "Bridge";
        if (!hasPrev && hasNext) return "Lead";
        if (hasPrev && !hasNext) return "Continue";
        return "Start";
    }

    getShotDisplayMode(index) {
        const shots = this.getVisibleShots();
        const shot = shots[index];
        if (!shot) return "Start";
        const activeTake = this.getActiveTake(shot);
        if (activeTake && activeTake.mode) return activeTake.mode;
        return this.detectShotMode(index);
    }

    // --- Lineage Delegators (Consolidated in UI_BranchGraph.js) ---
    getIncomingLinks(shotIndex, takeNum) {
        return _getIncomingLinks(this.state.shots || [], shotIndex, takeNum);
    }

    getOutgoingLinks(shotIndex, takeNum) {
        return _getOutgoingLinks(this.state.shots || [], shotIndex, takeNum);
    }

    getParentTake(shotIndex, take) {
        return _getParentTake(this.state.shots || [], shotIndex, take);
    }

    toggleTakeDisabled(shotIndex, takeNum) {
        const shot = (this.state.shots || [])[shotIndex];
        if (!shot || !shot.takes) return;
        const take = shot.takes.find(t => t.take_num === takeNum);
        if (!take) return;

        this.pushHistory();
        take.disabled = !take.disabled;
        this.notify(EVENTS.TAKE_DISABLED_CHANGED, { shotIndex, takeNum, disabled: take.disabled });
        this.saveProject(true);
    }

    async syncTakeApproval(shotIndex, takeNum) {
        const shot = (this.state.shots || [])[shotIndex];
        try {
            await fetch("/h3_wrapper/approve_take", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    project_name: this.state.project_name,
                    shot_id: shot ? shot.id : undefined,
                    shot_number: shotIndex + 1,
                    take_number: takeNum
                })
            });
        } catch (e) {
            console.error("H3 Wrapper: Error syncing take approval", e);
        }
    }

    async approveTakeAndSync(shotIndex, takeNum) {
        await this.syncTakeApproval(shotIndex, takeNum);
        this.approveTake(shotIndex, takeNum);
    }

    // --- Backend Options ---
    async fetchOptions() {
        try {
            const resp = await fetch("/h3_wrapper/get_options");
            const data = await resp.json();
            if (data.status === "success") {
                this.options = {
                    workflows: data.workflows || [],
                    unet_models: data.unet_models || [],
                    diffusion_models: data.diffusion_models || [],
                    loras: data.loras || [],
                    samplers: data.samplers || [],
                    schedulers: data.schedulers || []
                };
                if (this.options.workflows.length > 0) {
                    const wfNames = this.options.workflows.map(w => w.name);
                    if (!this.state.global.workflow || !wfNames.includes(this.state.global.workflow)) {
                        this.state.global.workflow = wfNames[0];
                    }
                }
                if (!this.state.global.unet_model && this.options.unet_models.length > 0) {
                    this.state.global.unet_model = this.options.unet_models[0];
                }
                if (!this.state.global.diffusion_model && this.options.diffusion_models.length > 0) {
                    this.state.global.diffusion_model = this.options.diffusion_models[0];
                }
                this.notify(EVENTS.OPTIONS_LOADED);
            }
        } catch (e) {
            console.error("H3 Wrapper: Error fetching options", e);
        }
    }

    // --- UI State (ui_state.json in custom node folder) ---
    async loadUiState() {
        try {
            const resp = await fetch("/h3_wrapper/ui_state");
            const data = await resp.json();
            if (data.status === "success" && data.ui_state) {
                return data.ui_state;
            }
        } catch (e) {
            console.error("H3 Wrapper: Error loading ui_state.json", e);
        }
        return {};
    }

    async saveUiState(projectName) {
        try {
            await fetch("/h3_wrapper/ui_state", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ last_project: projectName })
            });
        } catch (e) {
            console.error("H3 Wrapper: Error saving ui_state.json", e);
        }
    }

    // --- Project I/O ---
    async loadProject(projectName) {
        if (this._saveTimer) {
            clearTimeout(this._saveTimer);
            this._saveTimer = null;
        }
        try {
            const resp = await fetch(`/h3_wrapper/load_state?project_name=${encodeURIComponent(projectName)}`);
            const data = await resp.json();

            if (data.status === "success" && data.state && Object.keys(data.state).length > 0) {
                this.state = data.state;
                this.state.project_name = projectName;
                if (!this.state.global) this.state.global = {};
                if (!Array.isArray(this.state.history)) this.state.history = [];
                if (!this.state.global.workflow) {
                    this.state.global.workflow = this.options.workflows[0]?.name || "Default";
                }
                if (this.state.global.global_lora_active === undefined) {
                    this.state.global.global_lora_active = false;
                }
                if (this.state.global.global_lora === undefined) {
                    this.state.global.global_lora = "None";
                }
                if (this.state.global.global_lora_strength === undefined) {
                    this.state.global.global_lora_strength = 1.0;
                }
                if (this.state.global.global_prompt_enabled === undefined) {
                    this.state.global.global_prompt_enabled = false;
                }
                if (this.state.global.global_prompt === undefined) {
                    this.state.global.global_prompt = "";
                }
                (this.state.shots || []).forEach(shot => {
                    if (shot.duration_frames === undefined) shot.duration_frames = 124;
                    if (shot.seed === undefined) shot.seed = 123456789;
                });
            } else {
                this.state.project_name = projectName;
                this.state.shots = [];
                this.state.history = [];
                this.insertShotAfter(true);
            }

            this.visibleShotCount = this.state.shots.length;
            this.selectedShotIndex = this.state.shots.length > 0 ? 0 : -1;
            this.saveUiState(projectName);
            this.notify(EVENTS.PROJECT_LOADED);
        } catch (e) {
            console.error("H3 Wrapper: Error loading project state", e);
        }
    }

    async _flushSaveProject() {
        try {
            await fetch("/h3_wrapper/save_state", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    project_name: this.state.project_name,
                    state: this.state
                })
            });
        } catch (e) {
            console.error("H3 Wrapper: Error saving project state", e);
        }
    }

    saveProject(immediate = false) {
        if (this._saveTimer) {
            clearTimeout(this._saveTimer);
            this._saveTimer = null;
        }
        if (immediate) {
            return this._flushSaveProject();
        }
        this._saveTimer = setTimeout(() => {
            this._saveTimer = null;
            this._flushSaveProject();
        }, this._saveDebounceMs);
    }

    // --- Global Settings ---
    updateGlobal(key, value) {
        if (this.state.global[key] !== value) {
            this.state.global[key] = value;
            this.notify(EVENTS.GLOBAL_UPDATED, { key, value });
            this.saveProject();
        }
    }

    updateDimensions(width, height) {
        let changed = false;
        if (this.state.global.width !== width) {
            this.state.global.width = width;
            changed = true;
        }
        if (this.state.global.height !== height) {
            this.state.global.height = height;
            changed = true;
        }
        if (changed) {
            this.notify(EVENTS.GLOBAL_UPDATED, { key: "dimensions", value: { width, height } });
            this.saveProject();
        }
    }

    // --- Shot Management (Insert Before / After) ---
    _createShotObject(refShot) {
        return {
            id: this.generateShotId(),
            prompt: "",
            duration_frames: 124,
            seed: Math.floor(Math.random() * 1000000000),
            active_1: refShot ? Boolean(refShot.active_1) : false,
            lora_1: refShot ? (refShot.lora_1 || "None") : "None",
            lora_strength_1: refShot && refShot.lora_strength_1 !== undefined ? refShot.lora_strength_1 : 0,
            active_2: refShot ? Boolean(refShot.active_2) : false,
            lora_2: refShot ? (refShot.lora_2 || "None") : "None",
            lora_strength_2: refShot && refShot.lora_strength_2 !== undefined ? refShot.lora_strength_2 : 0,
            first_frame: "",
            last_frame: "",
            takes: [],
            approved_take: null
        };
    }

    insertShotBefore() {
        this.pushHistory();
        const insertIdx = this.selectedShotIndex >= 0 ? this.selectedShotIndex : 0;
        const refShot = this.state.shots[insertIdx] || this.state.shots[insertIdx - 1] || null;
        const newShot = this._createShotObject(refShot);

        this.state.shots.splice(insertIdx, 0, newShot);
        this.visibleShotCount = Math.min(this.state.shots.length, (this.visibleShotCount || 0) + 1);
        this.selectedShotIndex = insertIdx;
        this.notify(EVENTS.SHOT_ADDED);
        this.saveProject(true);
    }

    insertShotAfter(skipHistory = false) {
        if (!skipHistory) this.pushHistory();
        const insertIdx = this.selectedShotIndex >= 0
            ? this.selectedShotIndex + 1
            : this.state.shots.length;
        const refShot = this.state.shots[insertIdx - 1] || null;
        const newShot = this._createShotObject(refShot);

        this.state.shots.splice(insertIdx, 0, newShot);
        this.visibleShotCount = Math.min(this.state.shots.length, (this.visibleShotCount || 0) + 1);
        this.selectedShotIndex = insertIdx;
        this.notify(EVENTS.SHOT_ADDED);
        this.saveProject(true);
    }

    deleteShot(index) {
        if (index < 0 || index >= this.state.shots.length) return;
        this.pushHistory();
        this.state.shots.splice(index, 1);

        this.visibleShotCount = Math.min(this.visibleShotCount, this.state.shots.length);
        if (this.selectedShotIndex >= this.visibleShotCount) {
            this.selectedShotIndex = this.visibleShotCount - 1;
        }

        this.notify(EVENTS.SHOT_DELETED);
        this.saveProject(true);
    }

    selectShot(index) {
        if (index >= 0 && index < this.state.shots.length && this.selectedShotIndex !== index) {
            this.selectedShotIndex = index;
            this.notify(EVENTS.SHOT_SELECTED);
        }
    }

    updateActiveShot(key, value) {
        if (this.selectedShotIndex < 0) return;
        const shot = this.state.shots[this.selectedShotIndex];
        if (shot[key] !== value) {
            shot[key] = value;
            this.notify(EVENTS.SHOT_UPDATED, { index: this.selectedShotIndex, key, value });
            this.saveProject();
        }
    }

    // --- Take & Branch Management ---
    applyTakeMetadataToShot(shot, takeNum) {
        if (!shot || !shot.takes) return;
        const takeObj = shot.takes.find(t => t.take_num === takeNum);
        if (!takeObj) return;

        if (takeObj.prompt !== undefined) shot.prompt = takeObj.prompt;
        if (takeObj.seed !== undefined) shot.seed = takeObj.seed;
        if (takeObj.duration_frames !== undefined) shot.duration_frames = takeObj.duration_frames;
        if (takeObj.active_1 !== undefined) shot.active_1 = takeObj.active_1;
        if (takeObj.lora_1 !== undefined) shot.lora_1 = takeObj.lora_1;
        if (takeObj.lora_strength_1 !== undefined) shot.lora_strength_1 = takeObj.lora_strength_1;
        if (takeObj.active_2 !== undefined) shot.active_2 = takeObj.active_2;
        if (takeObj.lora_2 !== undefined) shot.lora_2 = takeObj.lora_2;
        if (takeObj.lora_strength_2 !== undefined) shot.lora_strength_2 = takeObj.lora_strength_2;
        if (takeObj.first_frame !== undefined) shot.first_frame = takeObj.first_frame;
        if (takeObj.last_frame !== undefined) shot.last_frame = takeObj.last_frame;
    }

    addTakeToActiveShot(takeData) {
        if (this.selectedShotIndex < 0) return;
        const shot = this.state.shots[this.selectedShotIndex];
        shot.takes.push(takeData);
        shot.approved_take = takeData.take_num;
        this.notify(EVENTS.TAKE_ADDED);
        this.saveProject(true);
    }

    approveTake(shotIndex, takeNum) {
        const shot = this.state.shots[shotIndex];
        if (!shot) return;
        shot.approved_take = takeNum;
        this.applyTakeMetadataToShot(shot, takeNum);
        this.notify(EVENTS.TAKE_APPROVED, { shotIndex, takeNum });
        this.saveProject(true);
    }

    deleteTake(shotIndex, takeNum) {
        const shot = (this.state.shots || [])[shotIndex];
        if (!shot || !shot.takes) return;
        const idx = shot.takes.findIndex(t => t.take_num === takeNum);
        if (idx === -1) return;

        this.pushHistory();
        shot.takes.splice(idx, 1);

        if (shot.approved_take === takeNum) {
            const fallback = shot.takes.length > 0 ? shot.takes[shot.takes.length - 1].take_num : null;
            shot.approved_take = fallback;
            if (fallback !== null) {
                this.applyTakeMetadataToShot(shot, fallback);
                this.syncTakeApproval(shotIndex, fallback);
            }
        }

        this.notify(EVENTS.TAKE_DELETED, { shotIndex, takeNum: shot.approved_take });
        this.saveProject(true);
    }

    async selectBranch(shotIndex, takeNum) {
        const shots = this.state.shots || [];
        if (shotIndex < 0 || shotIndex >= shots.length) return;

        const updates = [];

        // 1. Activate selected take and trace backward along explicit links
        let currIdx = shotIndex;
        let currTakeNum = takeNum;
        while (currIdx >= 0 && currTakeNum !== null && currTakeNum !== undefined) {
            const shot = shots[currIdx];
            if (!shot) break;

            shot.approved_take = currTakeNum;
            this.applyTakeMetadataToShot(shot, currTakeNum);
            updates.push({ shotIndex: currIdx, takeNum: currTakeNum });

            if (currIdx === 0) break;
            const takeObj = (shot.takes || []).find(t => t.take_num === currTakeNum);
            currTakeNum = takeObj ? this.getParentTake(currIdx, takeObj) : null;
            currIdx--;
        }

        // 2. Trace forward along explicit next_take links (Lead / Bridge)
        let fwdIdx = shotIndex;
        let fwdTakeNum = takeNum;
        let maxActiveIdx = shotIndex;
        while (fwdIdx < shots.length - 1 && fwdTakeNum !== null && fwdTakeNum !== undefined) {
            const shot = shots[fwdIdx];
            const takeObj = (shot?.takes || []).find(t => t.take_num === fwdTakeNum);
            const nextTake = takeObj && takeObj.next_take !== undefined ? takeObj.next_take : null;
            if (nextTake === null) break;

            fwdIdx++;
            const nextShot = shots[fwdIdx];
            if (!nextShot || !(nextShot.takes || []).some(t => t.take_num === nextTake)) break;

            nextShot.approved_take = nextTake;
            this.applyTakeMetadataToShot(nextShot, nextTake);
            updates.push({ shotIndex: fwdIdx, takeNum: nextTake });
            maxActiveIdx = fwdIdx;
            fwdTakeNum = nextTake;
        }

        let endCount = maxActiveIdx + 1;
        while (endCount < shots.length && (!shots[endCount].takes || shots[endCount].takes.length === 0)) {
            endCount++;
        }
        this.visibleShotCount = Math.max(this.visibleShotCount, endCount);

        for (const u of updates) {
            await this.syncTakeApproval(u.shotIndex, u.takeNum);
        }

        this.notify(EVENTS.BRANCH_SELECTED, { shotIndex, takeNum });
        this.saveProject(true);
    }

    getVisibleShots() {
        const shots = this.state.shots || [];
        const count = this.visibleShotCount > 0 ? Math.min(this.visibleShotCount, shots.length) : shots.length;
        return shots.slice(0, count);
    }

    getActiveShot() {
        return this.state.shots[this.selectedShotIndex] || null;
    }
}