import Phaser from 'phaser';
import { Component } from './Component.js';
import { STAGE_RENDER_DEPTH } from '../config.js';
import { PARTICLE_SEMANTIC_COLORS } from '../world/ParticleColors.js';
import { PARTICLE_TEXTURES } from '../world/ParticleTextureFactory.js';

const BOUNDARY_EMISSION_COUNT = 64;
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
        this._coreGlowLobes = [];
        this.bodyEmitter = null;
        this.trailEmitter = null;
        this._dashTrace = null;
        this._dashTraceStart = null;
        this._wasDashing = false;
        this._orbitMotes = [];
        this._wakeMotes = new Set();
        this._lastWakeDropMs = 0;
        this._activeModifiers = new Set();
        this._maskedObjects = new Set();
        this._lastPosition = null;
        this._velocity = { x: 0, y: 0 };
        this._breathT = 0;
        this._dirty = false;
        this._suppressVelocityNextUpdate = false;
        // Render offset used to smoothly absorb server corrections without popping.
        // Set to -errX/-errY on correction, decays to 0 each render frame.
        this._renderOffsetX = 0;
        this._renderOffsetY = 0;
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
            .setAlpha(0.22)
            .setScale(0.98);
        this._createCoreGlowLobes(scene, x, y);
        this.core = scene.add.image(x, y, PARTICLE_TEXTURES.spiritCore)
            .setDepth(STAGE_RENDER_DEPTH.actors + 1)
            .setBlendMode('ADD')
            .setTint(this.options.coreTint)
            .setAlpha(0.82)
            .setScale(0.46);
        this.core.entity = this.entity;
        this.coreGlow.entity = this.entity;

        this._createBoundaryEmissions(scene, x, y);
        this._createEmitters(scene, x, y);
        this.tryApplyVisibilityMask();
        return true;
    }

    onDetach() {
        this.clearVisibilityMask();
        this.core?.destroy?.();
        this.coreGlow?.destroy?.();
        for (const lobe of this._coreGlowLobes) lobe.image?.destroy?.();
        this.bodyEmitter?.destroy?.();
        this.trailEmitter?.destroy?.();
        this._destroyDashTrace();
        for (const mote of this._wakeMotes) {
            this.entity?.scene?.lightingRenderer?.unmaskGameObject?.(mote);
            mote.destroy?.();
        }
        for (const mote of this._orbitMotes) mote.image?.destroy?.();
        this.core = null;
        this.coreGlow = null;
        this._coreGlowLobes = [];
        this.bodyEmitter = null;
        this.trailEmitter = null;
        this._dashTrace = null;
        this._dashTraceStart = null;
        this._wasDashing = false;
        this._orbitMotes = [];
        this._wakeMotes.clear();
        this._activeModifiers.clear();
    }

    update(deltaMs = 16.67) {
        this.syncToTransform(deltaMs);
        if (this._dirty) this._applyEmitterState();
        this.tryApplyVisibilityMask();
    }

    /**
     * Called on a server position correction to smoothly absorb the snap.
     * offsetX/offsetY are the NEGATIVE of the correction vector (i.e. how far
     * the visual is behind the new logical position). Both this render offset and
     * the camera's followOffset are set to the same value so the player stays
     * centred on screen while both glide to zero over ~3 render frames.
     */
    beginCorrectionBlend(offsetX, offsetY) {
        this._renderOffsetX += offsetX;
        this._renderOffsetY += offsetY;
        this._suppressVelocityNextUpdate = true;
    }

    syncToTransform(deltaMs = 16.67) {
        const transform = this.getRequiredComponent('transform');
        if (!transform) return;
        const x = transform.position.x;
        const y = transform.position.y;
        const previous = this._lastPosition ?? { x, y };
        const dx = x - previous.x;
        const dy = y - previous.y;
        this._lastPosition = { x, y };
        this._breathT += deltaMs;

        if (this._suppressVelocityNextUpdate) {
            // Server position correction: the snap distance is not real movement.
            // Zero velocity so orbit motes and emitter offsets don't spike for one frame.
            this._suppressVelocityNextUpdate = false;
            this._velocity.x = 0;
            this._velocity.y = 0;
        } else if (dx !== 0 || dy !== 0) {
            // Position changed this frame (fixedUpdate ran and player moved).
            // Use the fixed timestep constant rather than the variable render delta so that
            // at high framerates (>60 Hz) — where fixedUpdate fires less than once per frame —
            // velocity doesn't alternate between 2× and 0, which causes orbit-mote jitter.
            const FIXED_DT_S = 0.01667;
            this._velocity.x = dx / FIXED_DT_S;
            this._velocity.y = dy / FIXED_DT_S;
        } else {
            // No movement this frame (player stood still, or no fixedUpdate ran at this
            // render tick). Decay smoothly so the motes glide to rest instead of snapping.
            const decay = Math.pow(0.78, deltaMs / 16.67);
            this._velocity.x *= decay;
            this._velocity.y *= decay;
        }

        // Decay the correction render offset. Absorbs ~80% per 16ms so a 5px correction
        // blends out in ~3 frames (~50ms) — fast enough to be invisible.
        if (this._renderOffsetX !== 0 || this._renderOffsetY !== 0) {
            const decay = Math.pow(0.2, deltaMs / 16.67);
            this._renderOffsetX *= decay;
            this._renderOffsetY *= decay;
            if (Math.abs(this._renderOffsetX) < 0.05) this._renderOffsetX = 0;
            if (Math.abs(this._renderOffsetY) < 0.05) this._renderOffsetY = 0;
        }
        // vx/vy: visual render position (lags the logical position during a correction)
        const vx = x + this._renderOffsetX;
        const vy = y + this._renderOffsetY;

        const speed = Math.sqrt(this._velocity.x ** 2 + this._velocity.y ** 2);
        const direction = speed > 8
            ? { x: this._velocity.x / speed, y: this._velocity.y / speed }
            : { x: 0, y: 0 };
        const healthRatio = this._getHealthRatio();
        const wounded = healthRatio < 0.35;
        const dashing = this._activeModifiers.has('dashing');
        const calmBreath = Math.sin(this._breathT / 980);
        const breathIn = (calmBreath + 1) * 0.5;
        const distress = Phaser.Math.Clamp((0.7 - healthRatio) / 0.7, 0, 1);
        const sputter =
            (Math.sin(this._breathT / 73) * 0.55 +
            Math.sin(this._breathT / 117 + 1.7) * 0.35 +
            Math.sin(this._breathT / 41 + 0.8) * 0.1) * distress;
        const heartbeat = this._resolveHeartbeatPulse(healthRatio);
        const coreBaseScale = 0.255 + healthRatio * 0.085;
        const coreScale = coreBaseScale
            * (1 + calmBreath * 0.035 + heartbeat * (0.82 + distress * 0.24) + sputter * 0.035)
            * 1;
        const glowScale = (0.72 + healthRatio * 0.22)
            * (1 + breathIn * (0.12 + distress * 0.05) + Math.max(0, sputter) * 0.05);
        const coreAlpha = wounded
            ? 0.5 + heartbeat * 0.42 + sputter * 0.1
            : 0.48 + heartbeat * 0.44;

        this.core?.setPosition(vx, vy).setScale(coreScale).setAlpha(Phaser.Math.Clamp(coreAlpha, 0.45, 1));
        const glowAlpha = 0.12 + healthRatio * 0.12 + breathIn * 0.04;
        this.coreGlow?.setPosition(vx, vy).setScale(glowScale * 0.86).setAlpha(glowAlpha);
        this._updateCoreGlowLobes(vx, vy, glowScale, glowAlpha, breathIn, distress);

        const bodyLag = Math.min(8, speed * 0.025);
        this.bodyEmitter?.setPosition(vx - direction.x * bodyLag, vy - direction.y * bodyLag);
        this.trailEmitter?.setPosition(vx - direction.x * 12, vy - direction.y * 12);
        this.trailEmitter?.stop?.();
        this._updateDashTrace(vx, vy, dashing);
        if (!dashing && speed > 32) this._emitMovementWake(vx, vy, direction, speed, healthRatio);

        this._updateBoundaryEmissions(vx, vy, direction, speed, healthRatio, deltaMs);
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

    _createBoundaryEmissions(scene, x, y) {
        for (let i = 0; i < BOUNDARY_EMISSION_COUNT; i++) {
            const image = scene.add.image(x, y, PARTICLE_TEXTURES.spiritMote)
                .setDepth(STAGE_RENDER_DEPTH.actors + 0.9)
                .setBlendMode('ADD')
                .setTint(0xf7fbff)
                .setAlpha(0)
                .setScale(0.34);
            image.entity = this.entity;
            this._orbitMotes.push({
                image,
                angle: ((i * 0.38196601125 + ((i * 7) % 5) * 0.137) % 1) * TWO_PI,
                phase: i * 0.73,
                lifeOffset: ((i * 487) + ((i * i) * 173)) % 2400,
                radiusBias: 0.96 + (i % 3) * 0.025,
                driftBias: 0.75 + (i % 4) * 0.1,
            });
        }
    }

    _createCoreGlowLobes(scene, x, y) {
        const configs = [
            { angle: 0.04, radius: 3.8, scale: 0.78, phase: 0.2 },
            { angle: 1.02, radius: 4.5, scale: 0.56, phase: 1.4 },
            { angle: 2.25, radius: 3.4, scale: 0.72, phase: 2.5 },
            { angle: 3.18, radius: 4.2, scale: 0.52, phase: 3.2 },
            { angle: 4.05, radius: 3.7, scale: 0.62, phase: 4.1 },
            { angle: 5.38, radius: 4.7, scale: 0.68, phase: 5.0 },
        ];
        this._coreGlowLobes = configs.map((config) => {
            const image = scene.add.image(x, y, PARTICLE_TEXTURES.spiritCore)
                .setDepth(STAGE_RENDER_DEPTH.actors + 0.75)
                .setBlendMode('ADD')
                .setTint(0xf0f8ff)
                .setAlpha(0.18)
                .setScale(0.58);
            image.entity = this.entity;
            return { image, ...config };
        });
    }

    _createEmitters(scene, x, y) {
        this.bodyEmitter = scene.add.particles(x, y, PARTICLE_TEXTURES.soft, this._buildBodyConfig());
        this.bodyEmitter.entity = this.entity;
        this.bodyEmitter.setDepth(STAGE_RENDER_DEPTH.actors + 0.3);
        this.bodyEmitter.setBlendMode('NORMAL');
        this.bodyEmitter.stop?.();

        this.trailEmitter = scene.add.particles(x, y, PARTICLE_TEXTURES.soft, {
            blendMode: 'ADD',
            lifespan: { min: 420, max: 760 },
            speed: { min: 0, max: 8 },
            scale: { start: 0.26, end: 0.02 },
            alpha: { start: 0.18, end: 0 },
            frequency: 42,
            quantity: 1,
            tint: [0xf3f8ff, 0xffffff],
            maxAliveParticles: 64,
            emitting: false,
        });
        this.trailEmitter.entity = this.entity;
        this.trailEmitter.setDepth(STAGE_RENDER_DEPTH.actors + 0.2);
        this.trailEmitter.stop?.();
    }

    _updateBoundaryEmissions(x, y, direction, speed, healthRatio, deltaMs) {
        const dashing = this._activeModifiers.has('dashing');
        const lowHp = this._activeModifiers.has('low_hp');
        const controlled = this._activeModifiers.has('controlled');
        const radiusBase = this.options.radius * (lowHp ? 1.08 : 0.98);
        const pullBack = Math.min(5, speed * 0.012);
        const cycleMs = (lowHp ? 590 : 1100) * (controlled ? 0.96 : 1);
        const startRadius = Math.max(3, this.options.radius * 0.16);
        for (let i = 0; i < this._orbitMotes.length; i++) {
            const mote = this._orbitMotes[i];
            const t = ((this._breathT + mote.lifeOffset) % cycleMs) / cycleMs;
            const travelT = Phaser.Math.Clamp(t / 0.8, 0, 1);
            const caughtT = Phaser.Math.Clamp((t - 0.8) / 0.08, 0, 1);
            const fadeT = Phaser.Math.Clamp((t - 0.88) / 0.12, 0, 1);
            const easedTravel = 1 - Math.pow(1 - travelT, 2.4);
            const catchFlash = Math.sin(caughtT * Math.PI);
            const angleDrift = Math.sin(this._breathT / (3600 + i * 150) + mote.phase) * 0.16 * mote.driftBias;
            const radiusJitter = Math.sin(this._breathT / (1900 + i * 120) + mote.phase) * 0.45 * mote.driftBias;
            const boundaryRadius = radiusBase * mote.radiusBias + radiusJitter;
            const radius = Phaser.Math.Linear(startRadius, boundaryRadius, easedTravel);
            const angle = mote.angle + angleDrift;
            const px = Math.cos(angle) * radius - direction.x * pullBack;
            const py = Math.sin(angle) * radius - direction.y * pullBack;
            const travelAlpha = Math.sin(travelT * Math.PI) * 0.18;
            const catchAlpha = catchFlash * (0.1 + healthRatio * 0.14 + (lowHp ? 0.12 : 0));
            const alpha = Phaser.Math.Clamp((travelAlpha + catchAlpha) * (1 - fadeT), 0, 0.58);
            mote.image
                ?.setPosition(x + px, y + py)
                .setAlpha(alpha)
                .setScale(0.16 + travelT * 0.07 + catchFlash * 0.1 + healthRatio * 0.05);
        }
    }

    _updateDashTrace(x, y, dashing) {
        const scene = this.entity?.scene;
        if (!scene?.add) return;

        if (dashing && !this._wasDashing) {
            this._destroyDashTrace();
            this._dashTraceStart = { x, y };
            this._dashTrace = scene.add.graphics()
                .setDepth(STAGE_RENDER_DEPTH.actors + 0.12)
                .setBlendMode('ADD');
            scene.lightingRenderer?.maskGameObject?.(this._dashTrace);
        }

        if (dashing && this._dashTrace && this._dashTraceStart) {
            this._dashTrace.clear();
            this._dashTrace.lineStyle(8, 0x9ee7ff, 0.14);
            this._dashTrace.beginPath();
            this._dashTrace.moveTo(this._dashTraceStart.x, this._dashTraceStart.y);
            this._dashTrace.lineTo(x, y);
            this._dashTrace.strokePath();
            this._dashTrace.lineStyle(3, 0xf5fbff, 0.68);
            this._dashTrace.beginPath();
            this._dashTrace.moveTo(this._dashTraceStart.x, this._dashTraceStart.y);
            this._dashTrace.lineTo(x, y);
            this._dashTrace.strokePath();
        }

        if (!dashing && this._wasDashing && this._dashTrace) {
            const trace = this._dashTrace;
            this._dashTrace = null;
            this._dashTraceStart = null;
            scene.tweens?.add?.({
                targets: trace,
                alpha: 0,
                duration: 220,
                ease: 'Sine.easeOut',
                onComplete: () => {
                    scene.lightingRenderer?.unmaskGameObject?.(trace);
                    trace.destroy?.();
                },
            });
        }

        this._wasDashing = dashing;
    }

    _destroyDashTrace() {
        if (!this._dashTrace) {
            this._dashTraceStart = null;
            return;
        }
        this.entity?.scene?.lightingRenderer?.unmaskGameObject?.(this._dashTrace);
        this._dashTrace.destroy?.();
        this._dashTrace = null;
        this._dashTraceStart = null;
    }

    _updateCoreGlowLobes(x, y, glowScale, glowAlpha, breathIn, distress) {
        for (let i = 0; i < this._coreGlowLobes.length; i++) {
            const lobe = this._coreGlowLobes[i];
            const driftA = lobe.angle + Math.sin(this._breathT / (2400 + i * 180) + lobe.phase) * 0.58;
            const driftR = lobe.radius
                * (0.68 + breathIn * 0.36)
                * (1 + Math.sin(this._breathT / (3000 + i * 220) + lobe.phase) * 0.22);
            const wobble = 1 + Math.sin(this._breathT / (2600 + i * 210) + lobe.phase) * (0.13 + distress * 0.05);
            lobe.image
                ?.setPosition(x + Math.cos(driftA) * driftR, y + Math.sin(driftA) * driftR)
                .setScale(glowScale * lobe.scale * wobble)
                .setAlpha(Phaser.Math.Clamp(glowAlpha * (0.68 + breathIn * 0.26), 0.06, 0.42));
        }
    }

    _emitMovementWake(x, y, direction, speed, healthRatio) {
        const scene = this.entity?.scene;
        if (!scene?.add || !scene?.time) return;
        const now = scene.time.now ?? this._breathT;
        const intervalMs = Phaser.Math.Clamp(82 - speed * 0.04, 38, 82);
        if (now - this._lastWakeDropMs < intervalMs) return;
        this._lastWakeDropMs = now;

        const side = { x: -direction.y, y: direction.x };
        const lateral = Phaser.Math.FloatBetween(-5.5, 5.5);
        const back = Phaser.Math.FloatBetween(1.5, 6.5);
        const mote = scene.add.image(
            x - direction.x * back + side.x * lateral,
            y - direction.y * back + side.y * lateral,
            PARTICLE_TEXTURES.soft
        )
            .setDepth(STAGE_RENDER_DEPTH.actors + 0.05)
            .setBlendMode('ADD')
            .setTint(0xf3f8ff)
            .setAlpha(0.28 + healthRatio * 0.08)
            .setScale(0.26 + healthRatio * 0.08);

        this._wakeMotes.add(mote);
        scene.lightingRenderer?.maskGameObject?.(mote);

        const driftX = Phaser.Math.FloatBetween(-3.5, 3.5);
        const driftY = Phaser.Math.FloatBetween(-3.5, 3.5);
        scene.tweens?.add?.({
            targets: mote,
            x: mote.x + driftX,
            y: mote.y + driftY,
            alpha: 0,
            scale: 0.04,
            duration: Phaser.Math.Between(1150, 1680),
            ease: 'Sine.easeOut',
            onComplete: () => {
                scene.lightingRenderer?.unmaskGameObject?.(mote);
                this._wakeMotes.delete(mote);
                mote.destroy?.();
            },
        });
    }

    _applyEmitterState() {
        if (!this.bodyEmitter) return;
        this.bodyEmitter.clearEmitZones?.();
        this.bodyEmitter.setConfig(this._buildBodyConfig());
        this.bodyEmitter.setBlendMode('NORMAL');
        if (this._activeModifiers.has('low_hp')) {
            this.bodyEmitter.start?.();
        } else {
            this.bodyEmitter.stop?.();
        }
        this.trailEmitter?.setConfig({
            blendMode: 'ADD',
            lifespan: { min: 420, max: 760 },
            speed: { min: 0, max: 8 },
            scale: { start: 0.26, end: 0.02 },
            alpha: { start: 0.18, end: 0 },
            frequency: 42,
            quantity: 1,
            tint: [0xf3f8ff, 0xffffff],
            maxAliveParticles: 64,
        });
        this.trailEmitter?.stop?.();
        this._dirty = false;
    }

    _buildBodyConfig() {
        const healthRatio = this._getHealthRatio();
        const lowHp = this._activeModifiers.has('low_hp');
        const activeBody = lowHp;
        return {
            blendMode: 'NORMAL',
            lifespan: lowHp ? { min: 680, max: 1120 } : { min: 520, max: 820 },
            speed: lowHp ? { min: 10, max: 34 } : { min: 3, max: 13 },
            scale: { start: 0.28 + healthRatio * 0.1, end: 0.02 },
            alpha: { start: lowHp ? 0.26 : 0.3, end: 0 },
            frequency: lowHp ? 76 : 72,
            quantity: 1,
            tint: [0xf3f8ff, 0xffffff],
            maxAliveParticles: 72,
            emitting: activeBody,
            emitZone: {
                type: lowHp ? 'random' : 'edge',
                source: new Phaser.Geom.Circle(0, 0, this.options.radius * (lowHp ? 1.08 : 0.9)),
                quantity: 8,
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

    _resolveHeartbeatPulse(healthRatio) {
        const distress = Phaser.Math.Clamp((0.7 - healthRatio) / 0.7, 0, 1);
        const cycleMs = Phaser.Math.Linear(1180, 760, distress);
        const t = (this._breathT % cycleMs) / cycleMs;
        const lub = Math.exp(-Math.pow((t - 0.08) / 0.038, 2));
        const dub = Math.exp(-Math.pow((t - 0.22) / 0.052, 2)) * 0.58;
        const afterglow = Math.exp(-Math.pow((t - 0.34) / 0.12, 2)) * 0.12;
        return Phaser.Math.Clamp(lub + dub + afterglow, 0, 1);
    }

    _allMaskableObjects() {
        return [
            this.core,
            this.coreGlow,
            ...this._coreGlowLobes.map((lobe) => lobe.image),
            this.bodyEmitter,
            this.trailEmitter,
            ...this._orbitMotes.map((mote) => mote.image),
        ];
    }
}
