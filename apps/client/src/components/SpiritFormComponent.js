import Phaser from 'phaser';
import { Component } from './Component.js';
import { STAGE_RENDER_DEPTH } from '../config.js';
import { PARTICLE_SEMANTIC_COLORS } from '../world/ParticleColors.js';
import { PARTICLE_TEXTURES } from '../world/ParticleTextureFactory.js';
import { zonePalette } from '../world/ZonePalette.js';

const ORBIT_MOTE_COUNT = 18;
const TWO_PI = Math.PI * 2;

export class SpiritFormComponent extends Component {
    constructor(options = {}) {
        super('spiritForm');
        this.options = {
            radius: 18,
            coreTint: 0xf5fbff,
            ...options,
        };
        this.core = null;
        this.coreGlow = null;
        this.bodyEmitter = null;
        this.trailEmitter = null;
        this._orbitMotes = [];
        this._activeModifiers = new Set();
        this._maskedObjects = new Set();
        this._lastPosition = null;
        this._velocity = { x: 0, y: 0 };
        this._breathT = 0;
        this._dirty = false;
        this.requireComponent('transform');
    }

    onAttach() {
        if (!super.onAttach()) return false;
        const scene = this.entity?.scene;
        const transform = this.getRequiredComponent('transform');
        if (!scene || !transform) return false;

        const x = transform.position.x;
        const y = transform.position.y;
        this._lastPosition = { x, y };
        this.coreGlow = scene.add.image(x, y, PARTICLE_TEXTURES.spiritCore)
            .setDepth(STAGE_RENDER_DEPTH.actors + 0.8)
            .setBlendMode('ADD')
            .setTint(0x8de8ff)
            .setAlpha(0.34)
            .setScale(1.35);
        this.core = scene.add.image(x, y, PARTICLE_TEXTURES.spiritCore)
            .setDepth(STAGE_RENDER_DEPTH.actors + 1)
            .setBlendMode('ADD')
            .setTint(this.options.coreTint)
            .setAlpha(0.98)
            .setScale(0.68);
        this.core.entity = this.entity;
        this.coreGlow.entity = this.entity;

        this._createOrbitMotes(scene, x, y);
        this._createEmitters(scene, x, y);
        this.tryApplyVisibilityMask();
        return true;
    }

    onDetach() {
        this.clearVisibilityMask();
        this.core?.destroy?.();
        this.coreGlow?.destroy?.();
        this.bodyEmitter?.destroy?.();
        this.trailEmitter?.destroy?.();
        for (const mote of this._orbitMotes) mote.image?.destroy?.();
        this.core = null;
        this.coreGlow = null;
        this.bodyEmitter = null;
        this.trailEmitter = null;
        this._orbitMotes = [];
        this._activeModifiers.clear();
    }

    update(deltaMs = 16.67) {
        this.syncToTransform(deltaMs);
        if (this._dirty) this._applyEmitterState();
        this.tryApplyVisibilityMask();
    }

    syncToTransform(deltaMs = 16.67) {
        const transform = this.getRequiredComponent('transform');
        if (!transform) return;
        const x = transform.position.x;
        const y = transform.position.y;
        const dt = Math.max(1, deltaMs) / 1000;
        const previous = this._lastPosition ?? { x, y };
        this._velocity.x = (x - previous.x) / dt;
        this._velocity.y = (y - previous.y) / dt;
        this._lastPosition = { x, y };
        this._breathT += deltaMs;

        const speed = Math.sqrt(this._velocity.x ** 2 + this._velocity.y ** 2);
        const direction = speed > 8
            ? { x: this._velocity.x / speed, y: this._velocity.y / speed }
            : { x: 0, y: 0 };
        const healthRatio = this._getHealthRatio();
        const wounded = healthRatio < 0.35;
        const dashing = this._activeModifiers.has('dashing');
        const breath = Math.sin(this._breathT / 820);
        const coreScale = (0.58 + healthRatio * 0.16) * (1 + breath * 0.035) * (dashing ? 0.88 : 1);
        const glowScale = (1.15 + healthRatio * 0.38) * (1 + breath * 0.055) * (dashing ? 1.2 : 1);
        const coreAlpha = wounded ? 0.66 + Math.sin(this._breathT / 70) * 0.1 : 0.94 + breath * 0.04;

        this.core?.setPosition(x, y).setScale(coreScale).setAlpha(Phaser.Math.Clamp(coreAlpha, 0.45, 1));
        this.coreGlow?.setPosition(x, y).setScale(glowScale).setAlpha(0.18 + healthRatio * 0.2 + (dashing ? 0.14 : 0));

        const bodyLag = Math.min(dashing ? 18 : 8, speed * (dashing ? 0.045 : 0.025));
        this.bodyEmitter?.setPosition(x - direction.x * bodyLag, y - direction.y * bodyLag);
        this.trailEmitter?.setPosition(x - direction.x * 12, y - direction.y * 12);
        if (speed > 28 || dashing) this.trailEmitter?.start?.();
        else this.trailEmitter?.stop?.();

        this._updateOrbitMotes(x, y, direction, speed, healthRatio, deltaMs);
    }

    applyStateModifier(key) {
        if (!key || this._activeModifiers.has(key)) return;
        this._activeModifiers.add(key);
        this._dirty = true;
    }

    clearStateModifier(key) {
        if (!this._activeModifiers.delete(key)) return;
        this._dirty = true;
    }

    setEmitterVisible(visible) {
        for (const object of this._allMaskableObjects()) {
            object?.setVisible?.(!!visible);
        }
    }

    emitBurst(burstKey, options = {}) {
        const scene = this.entity?.scene;
        const transform = this.getRequiredComponent('transform');
        if (!scene || !transform) return null;
        const burst = this._resolveBurstConfig(burstKey, options);
        if (!burst) return null;
        const x = Number.isFinite(options.x) ? options.x : transform.position.x;
        const y = Number.isFinite(options.y) ? options.y : transform.position.y;
        const quantity = Number.isFinite(options.quantity) ? options.quantity : burst.quantity;
        const emitter = scene.add.particles(x, y, burst.texture, {
            ...burst.config,
            quantity,
            frequency: -1,
            emitting: false,
            maxAliveParticles: Math.max(quantity, burst.config.maxAliveParticles ?? quantity),
        });
        emitter.setDepth(burst.depth);
        emitter.setBlendMode(burst.config.blendMode ?? 'ADD');
        if (this.entity?.scene?.lightingRenderer?.maskGameObject) {
            this.entity.scene.lightingRenderer.maskGameObject(emitter);
        }
        emitter.explode(quantity, x, y);
        scene.time.delayedCall(burst.cleanupMs, () => {
            scene.lightingRenderer?.unmaskGameObject?.(emitter);
            emitter.destroy?.();
        });
        return emitter;
    }

    tryApplyVisibilityMask() {
        const lighting = this.entity?.scene?.lightingRenderer;
        if (!lighting?.maskGameObject) return;
        for (const object of this._allMaskableObjects()) {
            if (!object || this._maskedObjects.has(object)) continue;
            lighting.maskGameObject(object);
            this._maskedObjects.add(object);
        }
    }

    clearVisibilityMask() {
        const lighting = this.entity?.scene?.lightingRenderer;
        for (const object of this._maskedObjects) {
            lighting?.unmaskGameObject?.(object);
        }
        this._maskedObjects.clear();
    }

    _createOrbitMotes(scene, x, y) {
        for (let i = 0; i < ORBIT_MOTE_COUNT; i++) {
            const image = scene.add.image(x, y, PARTICLE_TEXTURES.spiritMote)
                .setDepth(STAGE_RENDER_DEPTH.actors + 0.9)
                .setBlendMode('ADD')
                .setTint(i % 3 === 0 ? zonePalette.getActivePalette().accent : zonePalette.getActivePalette().base)
                .setAlpha(0.72)
                .setScale(0.65);
            image.entity = this.entity;
            this._orbitMotes.push({
                image,
                angle: (i / ORBIT_MOTE_COUNT) * TWO_PI,
                radiusBias: 0.74 + (i % 5) * 0.085,
                speedBias: 0.82 + (i % 4) * 0.12,
            });
        }
    }

    _createEmitters(scene, x, y) {
        const palette = zonePalette.getActivePalette();
        this.bodyEmitter = scene.add.particles(x, y, PARTICLE_TEXTURES.soft, this._buildBodyConfig());
        this.bodyEmitter.entity = this.entity;
        this.bodyEmitter.setDepth(STAGE_RENDER_DEPTH.actors + 0.3);
        this.bodyEmitter.setBlendMode('NORMAL');

        this.trailEmitter = scene.add.particles(x, y, PARTICLE_TEXTURES.streak, {
            blendMode: 'ADD',
            lifespan: { min: 140, max: 260 },
            speed: { min: 8, max: 40 },
            scale: { start: 0.42, end: 0 },
            alpha: { start: 0.36, end: 0 },
            frequency: 24,
            quantity: 2,
            tint: [palette.base, palette.accent],
            maxAliveParticles: 80,
            emitting: false,
        });
        this.trailEmitter.entity = this.entity;
        this.trailEmitter.setDepth(STAGE_RENDER_DEPTH.actors + 0.2);
        this.trailEmitter.stop?.();
    }

    _updateOrbitMotes(x, y, direction, speed, healthRatio, deltaMs) {
        const dashing = this._activeModifiers.has('dashing');
        const lowHp = this._activeModifiers.has('low_hp');
        const controlled = this._activeModifiers.has('controlled');
        const radiusBase = this.options.radius * (lowHp ? 1.18 : 0.98) * (dashing ? 0.76 : 1);
        const orbitSpeed = (lowHp ? 0.0018 : 0.00115) * (controlled ? 1.2 : 1);
        const pullBack = Math.min(dashing ? 22 : 10, speed * (dashing ? 0.055 : 0.025));
        const breath = Math.sin(this._breathT / 780);
        for (let i = 0; i < this._orbitMotes.length; i++) {
            const mote = this._orbitMotes[i];
            mote.angle += deltaMs * orbitSpeed * mote.speedBias;
            const jitter = lowHp ? Math.sin(this._breathT / 60 + i) * 2.4 : 0;
            const radius = radiusBase * mote.radiusBias * (1 + breath * 0.05) + jitter;
            const ellipseY = radius * (dashing ? 0.58 : 0.82);
            const px = Math.cos(mote.angle) * radius - direction.x * pullBack;
            const py = Math.sin(mote.angle) * ellipseY - direction.y * pullBack;
            const alpha = Phaser.Math.Clamp(0.35 + healthRatio * 0.48 + (lowHp ? Math.sin(this._breathT / 90 + i) * 0.18 : 0), 0.14, 0.92);
            mote.image
                ?.setPosition(x + px, y + py)
                .setAlpha(alpha)
                .setScale((0.48 + healthRatio * 0.22) * (dashing ? 0.8 : 1));
        }
    }

    _applyEmitterState() {
        if (!this.bodyEmitter) return;
        this.bodyEmitter.clearEmitZones?.();
        this.bodyEmitter.setConfig(this._buildBodyConfig());
        this.bodyEmitter.setBlendMode('NORMAL');
        if (this._activeModifiers.has('dashing')) {
            this.trailEmitter?.setConfig({
                blendMode: 'ADD',
                lifespan: { min: 180, max: 330 },
                speed: { min: 24, max: 90 },
                scale: { start: 0.62, end: 0 },
                alpha: { start: 0.62, end: 0 },
                frequency: 10,
                quantity: 4,
                tint: [zonePalette.getActivePalette().base, PARTICLE_SEMANTIC_COLORS.CONTROLLED],
                maxAliveParticles: 140,
            });
        } else {
            const palette = zonePalette.getActivePalette();
            this.trailEmitter?.setConfig({
                blendMode: 'ADD',
                lifespan: { min: 140, max: 260 },
                speed: { min: 8, max: 40 },
                scale: { start: 0.42, end: 0 },
                alpha: { start: 0.36, end: 0 },
                frequency: 24,
                quantity: 2,
                tint: [palette.base, palette.accent],
                maxAliveParticles: 80,
            });
        }
        this._dirty = false;
    }

    _buildBodyConfig() {
        const palette = zonePalette.getActivePalette();
        const healthRatio = this._getHealthRatio();
        const lowHp = this._activeModifiers.has('low_hp');
        const controlled = this._activeModifiers.has('controlled');
        const dashing = this._activeModifiers.has('dashing');
        return {
            blendMode: 'NORMAL',
            lifespan: lowHp ? { min: 760, max: 1300 } : { min: 560, max: 900 },
            speed: lowHp ? { min: 12, max: 42 } : { min: 4, max: 18 },
            scale: { start: 0.42 + healthRatio * 0.18 + (dashing ? 0.08 : 0), end: 0.02 },
            alpha: { start: lowHp ? 0.55 : 0.68, end: 0 },
            frequency: dashing ? 18 : (lowHp ? 44 : 30),
            quantity: dashing ? 4 : (lowHp ? 2 : 3),
            tint: controlled ? [palette.base, PARTICLE_SEMANTIC_COLORS.CONTROLLED] : [palette.base, palette.accent],
            maxAliveParticles: 190,
            emitZone: {
                type: lowHp ? 'random' : 'edge',
                source: new Phaser.Geom.Circle(0, 0, this.options.radius * (lowHp ? 1.25 : 1.05)),
                quantity: 18,
            },
        };
    }

    _resolveBurstConfig(burstKey, options = {}) {
        const quantity = Number.isFinite(options.quantity) ? Math.max(1, Math.round(options.quantity)) : null;
        if (burstKey === 'damaged') {
            return {
                texture: PARTICLE_TEXTURES.soft,
                quantity: quantity ?? 26,
                depth: STAGE_RENDER_DEPTH.actors + 1.5,
                cleanupMs: 520,
                config: {
                    blendMode: 'ADD',
                    lifespan: { min: 110, max: 240 },
                    speed: { min: 70, max: 210 },
                    scale: { start: 1.2, end: 0 },
                    alpha: { start: 1, end: 0 },
                    tint: PARTICLE_SEMANTIC_COLORS.DAMAGE,
                },
            };
        }
        if (burstKey === 'death') {
            return {
                texture: PARTICLE_TEXTURES.soft,
                quantity: quantity ?? 80,
                depth: STAGE_RENDER_DEPTH.actors + 1.5,
                cleanupMs: 980,
                config: {
                    blendMode: 'ADD',
                    lifespan: { min: 440, max: 860 },
                    speed: { min: 35, max: 230 },
                    scale: { start: 0.9, end: 0 },
                    alpha: { start: 0.9, end: 0 },
                    tint: PARTICLE_SEMANTIC_COLORS.DEATH,
                },
            };
        }
        if (burstKey === 'flinch') {
            return {
                texture: PARTICLE_TEXTURES.spiritMote,
                quantity: quantity ?? 12,
                depth: STAGE_RENDER_DEPTH.actors + 1.5,
                cleanupMs: 320,
                config: {
                    blendMode: 'ADD',
                    lifespan: { min: 70, max: 140 },
                    speed: { min: 70, max: 170 },
                    scale: { start: 1.1, end: 0 },
                    alpha: { start: 1, end: 0 },
                    tint: PARTICLE_SEMANTIC_COLORS.DAMAGE_FLASH,
                },
            };
        }
        return null;
    }

    _getHealthRatio() {
        const stats = this.entity?.getComponent?.('stats');
        if (!Number.isFinite(stats?.hp) || !Number.isFinite(stats?.hpMax) || stats.hpMax <= 0) return 1;
        return Phaser.Math.Clamp(stats.hp / stats.hpMax, 0, 1);
    }

    _allMaskableObjects() {
        return [
            this.core,
            this.coreGlow,
            this.bodyEmitter,
            this.trailEmitter,
            ...this._orbitMotes.map((mote) => mote.image),
        ];
    }
}
