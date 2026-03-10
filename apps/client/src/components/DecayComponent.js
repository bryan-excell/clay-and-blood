import { Component } from './Component.js';

export class DecayComponent extends Component {
    constructor(totalMs = 0, remainingMs = 0) {
        super('decay');
        this.totalMs = Math.max(0, totalMs);
        this.remainingMs = Math.max(0, remainingMs);
    }

    setTiming(totalMs = this.totalMs, remainingMs = this.remainingMs) {
        this.totalMs = Math.max(0, totalMs);
        this.remainingMs = Math.max(0, remainingMs);
    }

    getRatio() {
        if (this.totalMs <= 0) return 0;
        return Math.max(0, Math.min(1, this.remainingMs / this.totalMs));
    }

    update(deltaTime) {
        if (!Number.isFinite(deltaTime) || deltaTime <= 0) return;
        this.remainingMs = Math.max(0, this.remainingMs - deltaTime);
    }
}
