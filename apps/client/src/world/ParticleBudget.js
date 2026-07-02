const DEFAULT_CATEGORY_BUDGETS = Object.freeze({
    actor: 2600,
    projectile: 900,
    interactable: 800,
    ambient: 900,
    combat: 700,
    spell: 900,
});

class ParticleBudget {
    constructor() {
        this.globalEmissionScale = 1;
        this.categoryBudgets = { ...DEFAULT_CATEGORY_BUDGETS };
        this._lastFramePressure = 1;
    }

    getMaxAlive(category, profileMaxAlive) {
        const categoryMax = this.categoryBudgets[category] ?? 300;
        if (!Number.isFinite(profileMaxAlive)) return categoryMax;
        return Math.max(1, Math.min(categoryMax, Math.floor(profileMaxAlive)));
    }

    getEmissionScale(camera = null) {
        const zoom = Number.isFinite(camera?.zoom) ? camera.zoom : 1;
        const zoomScale = zoom < 0.5 ? 0.55 : (zoom < 0.75 ? 0.75 : 1);
        return Math.max(0.15, Math.min(1, this.globalEmissionScale * this._lastFramePressure * zoomScale));
    }

    scaleQuantity(quantity, camera = null) {
        const base = Number.isFinite(quantity) ? quantity : 1;
        return Math.max(1, Math.round(base * this.getEmissionScale(camera)));
    }

    scaleFrequency(frequency, camera = null) {
        if (!Number.isFinite(frequency) || frequency < 0) return frequency;
        const scale = this.getEmissionScale(camera);
        return Math.max(16, Math.round(frequency / Math.max(0.2, scale)));
    }

    updateFramePressure(deltaMs) {
        if (!Number.isFinite(deltaMs) || deltaMs <= 0) return;
        if (deltaMs > 28) {
            this._lastFramePressure = Math.max(0.4, this._lastFramePressure - 0.04);
        } else if (deltaMs < 19) {
            this._lastFramePressure = Math.min(1, this._lastFramePressure + 0.02);
        }
    }
}

export const particleBudget = new ParticleBudget();
