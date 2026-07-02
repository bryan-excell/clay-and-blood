import Phaser from 'phaser';
import { eventBus } from '../core/EventBus.js';
import { STAGE_RENDER_DEPTH } from '../config.js';
import { zonePalette } from './ZonePalette.js';
import { particleBudget } from './ParticleBudget.js';

const VIEW_MARGIN_PX = 150;
const CAMERA_MOVE_THRESHOLD_PX = 96;

export class ZoneAmbientParticleSystem {
    constructor(scene) {
        this.scene = scene;
        this._emitter = null;
        this._lastZoneKey = null;
        this._lastBounds = null;
        this._unsubscribers = [];
    }

    start() {
        if (this._unsubscribers.length > 0) return;
        this._unsubscribers.push(
            eventBus.on('particle:paletteChanged', ({ palette }) => {
                this._recreateEmitter(palette);
            }),
            eventBus.on('level:transition', () => {
                this._recreateEmitter(zonePalette.getActivePalette());
            })
        );
        this._recreateEmitter(zonePalette.getActivePalette());
    }

    stop() {
        for (const unsubscribe of this._unsubscribers) unsubscribe?.();
        this._unsubscribers = [];
        this._destroyEmitter();
    }

    update(deltaMs = 16.67) {
        if (!this._emitter) return;
        this._updateEmitZone(false);
        const palette = zonePalette.getActivePalette();
        const density = Number.isFinite(palette.ambientDensity) ? palette.ambientDensity : 500;
        this._emitter.maxAliveParticles = Math.max(80, Math.round(density * particleBudget.getEmissionScale(this.scene.cameras?.main)));
    }

    _recreateEmitter(palette) {
        this._destroyEmitter();
        const cam = this.scene.cameras?.main;
        if (!cam) return;
        const texture = palette?.ambientTexture ?? 'particle-dot';
        const density = Number.isFinite(palette?.ambientDensity) ? palette.ambientDensity : 500;
        const drift = palette?.ambientDrift ?? { x: 0, y: -6 };
        const bounds = this._resolveCameraBounds(true);
        this._lastBounds = bounds;

        this._emitter = this.scene.add.particles(bounds.x, bounds.y, texture, {
            blendMode: 'NORMAL',
            lifespan: { min: 1400, max: 2800 },
            speedX: { min: drift.x - 6, max: drift.x + 6 },
            speedY: { min: drift.y - 8, max: drift.y + 4 },
            scale: { start: texture === 'particle-dot' ? 0.7 : 0.34, end: 0 },
            alpha: { start: 0.22, end: 0 },
            frequency: 24,
            quantity: 2,
            tint: [palette.base, palette.accent],
            maxAliveParticles: density,
            emitZone: {
                type: 'random',
                source: new Phaser.Geom.Rectangle(0, 0, bounds.width, bounds.height),
            },
        });
        this._emitter.setDepth(STAGE_RENDER_DEPTH.floor + 0.5);
    }

    _updateEmitZone(force) {
        const bounds = this._resolveCameraBounds(false);
        if (!bounds) return;
        if (!force && this._lastBounds && Math.abs(bounds.x - this._lastBounds.x) < CAMERA_MOVE_THRESHOLD_PX &&
            Math.abs(bounds.y - this._lastBounds.y) < CAMERA_MOVE_THRESHOLD_PX &&
            Math.abs(bounds.width - this._lastBounds.width) < 8 &&
            Math.abs(bounds.height - this._lastBounds.height) < 8) {
            return;
        }
        this._lastBounds = bounds;
        this._emitter.setPosition(bounds.x, bounds.y);
        this._emitter.clearEmitZones?.();
        this._emitter.addEmitZone?.({
            type: 'random',
            source: new Phaser.Geom.Rectangle(0, 0, bounds.width, bounds.height),
        });
    }

    _resolveCameraBounds(forceFallback) {
        const view = this.scene.cameras?.main?.worldView;
        if (!view && !forceFallback) return null;
        const x = (view?.x ?? 0) - VIEW_MARGIN_PX;
        const y = (view?.y ?? 0) - VIEW_MARGIN_PX;
        const width = (view?.width ?? this.scene.scale.width) + VIEW_MARGIN_PX * 2;
        const height = (view?.height ?? this.scene.scale.height) + VIEW_MARGIN_PX * 2;
        return { x, y, width, height };
    }

    _destroyEmitter() {
        this._emitter?.destroy?.();
        this._emitter = null;
        this._lastBounds = null;
    }
}
