import { Component } from './Component.js';
import {
    compileBurstConfig,
    compileEmitterConfig,
    compileParticleProfile,
    compileModifierConfig,
    getParticleProfile,
    mergeEmitterConfigs,
} from '../world/ParticleProfileCompiler.js';

export class ParticleComponent extends Component {
    constructor(profileKey, options = {}) {
        super('particle');
        this.profileKey = profileKey;
        this.options = { ...options };
        this.emitter = null;
        this._compiled = null;
        this._activeModifiers = new Map();
        this._dirty = false;
        this._masked = false;
        this.requireComponent('transform');
    }

    onAttach() {
        if (!super.onAttach()) return false;
        const transform = this.getRequiredComponent('transform');
        const scene = this.entity?.scene;
        if (!scene || !transform) return false;

        this._compiled = compileParticleProfile(this.profileKey, {
            camera: scene.cameras?.main,
            entity: this.entity,
        });
        if (!this._compiled) {
            console.warn(`Particle profile "${this.profileKey}" not found for entity ${this.entity?.id}`);
            return false;
        }

        this.emitter = scene.add.particles(
            transform.position.x,
            transform.position.y,
            this._compiled.texture,
            this._compiled.config
        );
        this.emitter.entity = this.entity;
        this.emitter.setDepth(this._compiled.depth);
        this.emitter.setBlendMode(this._compiled.config.blendMode ?? 'NORMAL');
        this.tryApplyVisibilityMask();
        return true;
    }

    onDetach() {
        this.clearVisibilityMask();
        this.emitter?.destroy?.();
        this.emitter = null;
        this._activeModifiers.clear();
    }

    update() {
        this.syncToTransform();
        if (this._dirty) this._applyActiveConfig();
        this.tryApplyVisibilityMask();
    }

    syncToTransform() {
        if (!this.emitter) return;
        const transform = this.getRequiredComponent('transform');
        if (!transform) return;
        this.emitter.setPosition(transform.position.x, transform.position.y);
        if (typeof this.emitter.setRotation === 'function') {
            this.emitter.setRotation(transform.rotation ?? 0);
        }
    }

    setEmitterVisible(visible) {
        this.emitter?.setVisible?.(!!visible);
    }

    applyStateModifier(key) {
        if (!key || this._activeModifiers.has(key)) return;
        const config = compileModifierConfig(this.profileKey, key, {
            camera: this.entity?.scene?.cameras?.main,
            entity: this.entity,
        });
        if (!config) return;
        this._activeModifiers.set(key, config);
        this._dirty = true;
    }

    clearStateModifier(key) {
        if (!this._activeModifiers.delete(key)) return;
        this._dirty = true;
    }

    emitBurst(burstKey, options = {}) {
        const scene = this.entity?.scene;
        const transform = this.getRequiredComponent('transform');
        if (!scene || !transform) return null;
        const profile = getParticleProfile(this.profileKey);
        const burst = compileBurstConfig(this.profileKey, burstKey, {
            camera: scene.cameras?.main,
            entity: this.entity,
        });
        if (!profile || !burst) return null;

        const quantity = Number.isFinite(options.quantity)
            ? Math.max(1, Math.round(options.quantity))
            : (Number.isFinite(burst.quantity) ? burst.quantity : 12);
        const texture = burst.texture ?? profile.texture;
        const config = {
            ...burst,
            quantity,
            frequency: -1,
            emitting: false,
            maxAliveParticles: Math.max(quantity, burst.maxAliveParticles ?? quantity),
        };
        delete config.texture;

        const x = Number.isFinite(options.x) ? options.x : transform.position.x;
        const y = Number.isFinite(options.y) ? options.y : transform.position.y;
        const burstEmitter = scene.add.particles(x, y, texture, config);
        burstEmitter.setDepth(options.depth ?? this._compiled?.depth ?? 0);
        burstEmitter.setBlendMode(config.blendMode ?? profile.blendMode ?? 'ADD');
        if (this._masked && scene.lightingRenderer?.maskGameObject) {
            scene.lightingRenderer.maskGameObject(burstEmitter);
        }
        burstEmitter.explode(quantity, x, y);

        const lifetime = resolveMaxLifetime(config.lifespan);
        scene.time.delayedCall(Math.max(180, lifetime + 120), () => {
            scene.lightingRenderer?.unmaskGameObject?.(burstEmitter);
            burstEmitter.destroy?.();
        });
        return burstEmitter;
    }

    tryApplyVisibilityMask() {
        if (this._masked || !this.emitter) return;
        const scene = this.entity?.scene;
        if (!scene?.lightingRenderer?.maskGameObject) return;
        scene.lightingRenderer.maskGameObject(this.emitter);
        this._masked = true;
    }

    clearVisibilityMask() {
        if (!this._masked || !this.emitter) return;
        this.entity?.scene?.lightingRenderer?.unmaskGameObject?.(this.emitter);
        this._masked = false;
    }

    _applyActiveConfig() {
        if (!this.emitter || !this._compiled?.profile) return;
        const baseConfig = compileEmitterConfig(this._compiled.profile, {
            camera: this.entity?.scene?.cameras?.main,
            entity: this.entity,
        });
        const nextConfig = mergeEmitterConfigs(baseConfig, ...this._activeModifiers.values());
        this.emitter.clearEmitZones?.();
        this.emitter.setConfig(nextConfig);
        this.emitter.setBlendMode(nextConfig.blendMode ?? this._compiled.profile.blendMode ?? 'NORMAL');
        this._dirty = false;
    }
}

function resolveMaxLifetime(lifespan) {
    if (Number.isFinite(lifespan)) return lifespan;
    if (Number.isFinite(lifespan?.max)) return lifespan.max;
    if (Number.isFinite(lifespan?.min)) return lifespan.min;
    return 600;
}
