import { gameState } from '../core/GameState.js';

export class StageResidencyManager {
    constructor(options = {}) {
        this.maxStageData = Math.max(1, Math.floor(options.maxStageData ?? 30));
        this._stageData = new Map();
        this._touchOrder = [];
        this._proceduralConnections = new Map();
    }

    get(stageId) {
        const value = this._stageData.get(stageId) ?? null;
        if (value) this._touch(stageId);
        return value;
    }

    set(stageData, activeStageId = null) {
        if (!stageData?.id) return stageData ?? null;
        this._stageData.set(stageData.id, stageData);
        this._applyProceduralConnections(stageData);
        this._touch(stageData.id);
        this._evict(activeStageId ?? gameState.currentLevelId ?? stageData.id);
        this._syncGameStateLevels();
        return stageData;
    }

    rememberConnection(stageId, exitIndex, connection, stageKind = null) {
        if (stageKind === 'static') return;
        if (typeof stageId !== 'string' || !Number.isInteger(exitIndex) || !connection) return;
        const existing = this._proceduralConnections.get(stageId) ?? {};
        existing[exitIndex] = { ...connection };
        this._proceduralConnections.set(stageId, existing);

        const stageData = this._stageData.get(stageId);
        if (stageData) {
            stageData.exitConnections = { ...(stageData.exitConnections ?? {}), [exitIndex]: { ...connection } };
            this._syncGameStateLevels();
        }
    }

    destroyStage(stageId) {
        this._stageData.delete(stageId);
        this._touchOrder = this._touchOrder.filter((id) => id !== stageId);
        this._syncGameStateLevels();
    }

    _applyProceduralConnections(stageData) {
        const remembered = this._proceduralConnections.get(stageData.id);
        if (!remembered) return;
        stageData.exitConnections = { ...(stageData.exitConnections ?? {}), ...remembered };
    }

    _touch(stageId) {
        this._touchOrder = this._touchOrder.filter((id) => id !== stageId);
        this._touchOrder.push(stageId);
    }

    _evict(activeStageId) {
        let attempts = this._touchOrder.length;
        while (this._stageData.size > this.maxStageData && attempts > 0) {
            const candidate = this._touchOrder.shift();
            if (!candidate) break;
            if (candidate === activeStageId) {
                this._touchOrder.push(candidate);
                attempts--;
                continue;
            }
            this._stageData.delete(candidate);
            attempts = this._touchOrder.length;
        }
    }

    _syncGameStateLevels() {
        gameState.levels = Object.fromEntries(this._stageData.entries());
    }
}
