import Phaser from 'phaser';
import { PARTICLE_PROFILES } from '../entities/particleProfiles.js';
import { zonePalette } from './ZonePalette.js';
import { particleBudget } from './ParticleBudget.js';

export function getParticleProfile(profileKey) {
    return PARTICLE_PROFILES[profileKey] ?? null;
}

export function compileParticleProfile(profileKey, options = {}) {
    const profile = getParticleProfile(profileKey);
    if (!profile) return null;
    return {
        profile,
        texture: profile.texture,
        depth: profile.depth ?? 0,
        category: profile.category ?? 'actor',
        maxAlive: particleBudget.getMaxAlive(profile.category, profile.maxAlive),
        config: compileEmitterConfig(profile, options),
    };
}

export function compileEmitterConfig(profile, options = {}) {
    const emitter = {
        ...clonePlain(profile.emitter ?? {}),
        blendMode: profile.blendMode ?? 'NORMAL',
        maxAliveParticles: particleBudget.getMaxAlive(profile.category, profile.maxAlive),
        emitZone: createEmitZone(profile.form, options),
        tint: resolveTint(profile.tint, profile.emitter?.tint),
    };

    if (Number.isFinite(emitter.frequency)) {
        emitter.frequency = particleBudget.scaleFrequency(emitter.frequency, options.camera);
    }
    if (Number.isFinite(emitter.quantity)) {
        emitter.quantity = particleBudget.scaleQuantity(emitter.quantity, options.camera);
    }

    return emitter;
}

export function compileModifierConfig(profileKey, modifierKey, options = {}) {
    const profile = getParticleProfile(profileKey);
    const modifier = profile?.modifiers?.[modifierKey];
    if (!profile || !modifier) return null;
    return normalizeConfigFragment(modifier, options);
}

export function compileBurstConfig(profileKey, burstKey, options = {}) {
    const profile = getParticleProfile(profileKey);
    const burst = profile?.bursts?.[burstKey];
    if (!profile || !burst) return null;
    return normalizeConfigFragment(burst, options);
}

export function normalizeConfigFragment(fragment, options = {}) {
    const config = clonePlain(fragment ?? {});
    if (config.tint) {
        config.tint = resolveTint({ mode: 'fixed', colors: Array.isArray(config.tint) ? config.tint : [config.tint] }, config.tint);
    }
    if (Number.isFinite(config.frequency)) {
        config.frequency = particleBudget.scaleFrequency(config.frequency, options.camera);
    }
    if (Number.isFinite(config.quantity)) {
        config.quantity = particleBudget.scaleQuantity(config.quantity, options.camera);
    }
    return config;
}

export function mergeEmitterConfigs(...configs) {
    const result = {};
    for (const config of configs) {
        if (!config) continue;
        for (const [key, value] of Object.entries(config)) {
            if (key === 'texture') continue;
            result[key] = clonePlain(value);
        }
    }
    return result;
}

function resolveTint(tintSpec, fallback = 0xffffff) {
    if (typeof fallback === 'number' && !tintSpec) return fallback;
    if (Array.isArray(fallback) && !tintSpec) return [...fallback];
    const colors = tintSpec?.colors;
    if (!Array.isArray(colors) || colors.length === 0) return fallback;
    const resolved = colors.map((color) => zonePalette.resolveColor(color, 0xffffff));
    return resolved.length === 1 ? resolved[0] : resolved;
}

function createEmitZone(form, options = {}) {
    const zone = form?.zone ?? 'point';
    if (zone === 'point') return undefined;
    const radius = Number.isFinite(form?.radius) ? form.radius : 16;
    const quantity = Number.isFinite(form?.quantity) ? form.quantity : 12;
    const source = new Phaser.Geom.Circle(0, 0, radius);
    if (zone === 'circleEdge') {
        return { type: 'edge', source, quantity };
    }
    if (zone === 'circleFill') {
        return { type: 'random', source };
    }
    if (zone === 'rectRandom') {
        const width = Number.isFinite(form?.width) ? form.width : 64;
        const height = Number.isFinite(form?.height) ? form.height : 64;
        return {
            type: 'random',
            source: new Phaser.Geom.Rectangle(-width / 2, -height / 2, width, height),
        };
    }
    return undefined;
}

function clonePlain(value) {
    if (Array.isArray(value)) return value.map(clonePlain);
    if (value && typeof value.contains === 'function') return value;
    if (value && typeof value === 'object') {
        const out = {};
        for (const [key, child] of Object.entries(value)) out[key] = clonePlain(child);
        return out;
    }
    return value;
}
