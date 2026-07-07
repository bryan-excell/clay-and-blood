import Phaser from 'phaser';
import { eventBus } from '../core/EventBus.js';
import { STAGE_RENDER_DEPTH } from '../config.js';
import { zonePalette } from './ZonePalette.js';
import { particleBudget } from './ParticleBudget.js';

const VIEW_MARGIN_PX = 150;
const CAMERA_MOVE_THRESHOLD_PX = 96;
const MIN_AMBIENT_PARTICLES = 12;
const AMBIENT_EMIT_FREQUENCY_MS = 180;

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
        const density = Number.isFinite(palette.ambientDensity) ? palette.ambientDensity : 90;
        this._emitter.maxAliveParticles = Math.max(
            MIN_AMBIENT_PARTICLES,
            Math.round(density * particleBudget.getEmissionScale(this.scene.cameras?.main))
        );
    }

    _recreateEmitter(palette) {
        this._destroyEmitter();
        const cam = this.scene.cameras?.main;
        if (!cam) return;
        const texture = palette?.ambientTexture ?? 'particle-soft';
        const density = Number.isFinite(palette?.ambientDensity) ? palette.ambientDensity : 90;
        const drift = palette?.ambientDrift ?? { x: 0, y: -6 };
        const alpha = Number.isFinite(palette?.ambientAlpha) ? palette.ambientAlpha : 0.06;
        const scale = Number.isFinite(palette?.ambientScale) ? palette.ambientScale : 0.22;
        const bounds = this._resolveCameraBounds(true);
        this._lastBounds = bounds;

        this._emitter = this.scene.add.particles(bounds.x, bounds.y, texture, {
            blendMode: 'NORMAL',
            lifespan: { min: 3400, max: 6800 },
            speedX: { min: drift.x - 4, max: drift.x + 4 },
            speedY: { min: drift.y - 3, max: drift.y + 5 },
            scale: { start: scale, end: 0 },
            alpha: { start: alpha, end: 0 },
            frequency: AMBIENT_EMIT_FREQUENCY_MS,
            quantity: 1,
            tint: [palette.base, palette.accent],
            maxAliveParticles: Math.max(MIN_AMBIENT_PARTICLES, density),
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
