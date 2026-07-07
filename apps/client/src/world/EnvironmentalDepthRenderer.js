import { STAGE_RENDER_DEPTH, TILE_SIZE } from '../config.js';
import { zonePalette } from './ZonePalette.js';

const VEIL_COUNT = 9;
const DISTANT_GATE_COUNT = 4;

export class EnvironmentalDepthRenderer {
    constructor(scene, stageData) {
        this.scene = scene;
        this.stageData = stageData;
        this._objects = [];
        this._veils = [];
        this._timeMs = 0;
        this._create();
    }

    update(_camera, deltaMs = 16.67) {
        this._timeMs += deltaMs;
        for (let i = 0; i < this._veils.length; i++) {
            const veil = this._veils[i];
            const phase = this._timeMs / (5200 + i * 430) + veil.phase;
            veil.object.setAlpha(veil.alpha + Math.sin(phase) * 0.025);
            veil.object.setX(veil.baseX + Math.sin(phase * 0.72) * veil.driftX);
        }
    }

    destroy() {
        for (const object of this._objects) object?.destroy?.();
        this._objects = [];
        this._veils = [];
    }

    _create() {
        const widthPx = (this.stageData?.width ?? 1) * TILE_SIZE;
        const heightPx = (this.stageData?.height ?? 1) * TILE_SIZE;
        const palette = zonePalette.getActivePalette();
        const deep = palette.deep ?? 0x11182c;
        const shadow = palette.shadow ?? 0x1e2a4a;
        const surface = palette.surface ?? 0x294a6e;
        const base = palette.base ?? 0xa8c5c2;
        const accent = palette.accent ?? 0x8e84b7;
        const threshold = palette.threshold ?? 0xf0b65a;

        const depth = STAGE_RENDER_DEPTH.floor - 0.7;
        const field = this.scene.add.rectangle(widthPx / 2, heightPx / 2, widthPx, heightPx, deep, 1)
            .setDepth(depth);
        this._objects.push(field);

        this._createDistantGates(widthPx, heightPx, shadow, surface, base, threshold, depth + 0.08);
        this._createVeils(widthPx, heightPx, base, accent, depth + 0.16);
        this._createSymbolicMarks(widthPx, heightPx, base, threshold, depth + 0.2);
    }

    _createDistantGates(widthPx, heightPx, shadow, surface, base, threshold, depth) {
        const horizonY = heightPx * 0.28;
        for (let i = 0; i < DISTANT_GATE_COUNT; i++) {
            const x = widthPx * ((i + 1) / (DISTANT_GATE_COUNT + 1));
            const h = TILE_SIZE * (1.2 + this._noise(i, 3, 1) * 1.8);
            const w = TILE_SIZE * (0.55 + this._noise(i, 4, 2) * 0.55);
            const alpha = 0.12 + this._noise(i, 5, 3) * 0.08;
            const gate = this.scene.add.graphics()
                .setDepth(depth)
                .setAlpha(alpha);
            gate.fillStyle(shadow, 1);
            gate.fillRect(x - w / 2, horizonY - h, w, h);
            gate.fillStyle(surface, 0.64);
            gate.fillRect(x - w * 0.32, horizonY - h * 0.78, w * 0.64, h * 0.16);
            gate.lineStyle(2, base, 0.34);
            gate.strokeRect(x - w / 2, horizonY - h, w, h);
            if (i === 1) {
                gate.fillStyle(threshold, 0.95);
                gate.fillCircle(x, horizonY - h * 0.52, 3);
            }
            this._objects.push(gate);
        }
    }

    _createVeils(widthPx, heightPx, base, accent, depth) {
        for (let i = 0; i < VEIL_COUNT; i++) {
            const x = widthPx * this._noise(i, 7, 4);
            const y = heightPx * (0.08 + this._noise(i, 8, 5) * 0.82);
            const h = heightPx * (0.28 + this._noise(i, 9, 6) * 0.44);
            const w = TILE_SIZE * (0.35 + this._noise(i, 10, 7) * 0.75);
            const color = i % 2 === 0 ? base : accent;
            const alpha = 0.045 + this._noise(i, 11, 8) * 0.045;
            const veil = this.scene.add.rectangle(x, y, w, h, color, alpha)
                .setDepth(depth)
                .setBlendMode('ADD')
                .setAngle(-4 + this._noise(i, 12, 9) * 8);
            this._objects.push(veil);
            this._veils.push({
                object: veil,
                baseX: x,
                driftX: 6 + this._noise(i, 13, 10) * 16,
                alpha,
                phase: this._noise(i, 14, 11) * Math.PI * 2,
            });
        }
    }

    _createSymbolicMarks(widthPx, heightPx, base, threshold, depth) {
        const marks = this.scene.add.graphics().setDepth(depth).setAlpha(0.3);
        const cx = widthPx * 0.5;
        const cy = heightPx * 0.58;
        marks.lineStyle(2, base, 0.2);
        marks.strokeCircle(cx, cy, TILE_SIZE * 1.15);
        marks.strokeCircle(cx, cy, TILE_SIZE * 0.46);
        marks.lineStyle(1, threshold, 0.28);
        for (let i = 0; i < 6; i++) {
            const a = (Math.PI * 2 * i) / 6;
            marks.lineBetween(
                cx + Math.cos(a) * TILE_SIZE * 0.58,
                cy + Math.sin(a) * TILE_SIZE * 0.58,
                cx + Math.cos(a) * TILE_SIZE * 1.04,
                cy + Math.sin(a) * TILE_SIZE * 1.04
            );
        }
        this._objects.push(marks);
    }

    _noise(x, y, salt) {
        const value = Math.sin((x + 1) * 12.9898 + (y + 1) * 78.233 + salt * 37.719);
        return value - Math.floor(value);
    }
}
