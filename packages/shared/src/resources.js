import { ARCHETYPE_CONFIG, RESOURCE_KINDS } from './combatData.js';

function clampNonNegative(value) {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, value);
}

function buildResourcePool(config = {}) {
    const max = clampNonNegative(config.max);
    const current = clampNonNegative(config.current ?? max);
    return {
        current: Math.min(max, current),
        max,
        regenPerSec: clampNonNegative(config.regenPerSec),
        regenDelayMs: clampNonNegative(config.regenDelayMs),
        exhaustedRegenDelayMs: clampNonNegative(config.exhaustedRegenDelayMs),
        lastSpendAtMs: 0,
    };
}

export function createEntityResources(kind) {
    const archetype = (typeof kind === 'string' && ARCHETYPE_CONFIG[kind])
        ? ARCHETYPE_CONFIG[kind]
        : null;
    const cfg = archetype?.resources ?? {};
    return {
        hp: buildResourcePool(cfg.hp),
        stamina: buildResourcePool(cfg.stamina),
        mana: buildResourcePool(cfg.mana),
    };
}

export function cloneResources(resources = {}) {
    return {
        hp: { ...(resources.hp ?? buildResourcePool()) },
        stamina: { ...(resources.stamina ?? buildResourcePool()) },
        mana: { ...(resources.mana ?? buildResourcePool()) },
    };
}

export function getResourcePool(resources, kind) {
    if (!resources || typeof kind !== 'string') return null;
    return resources[kind] ?? null;
}

export function tickResourceRegen(resources, dtMs, nowMs = Date.now()) {
    const next = cloneResources(resources);
    for (const kind of Object.values(RESOURCE_KINDS)) {
        const pool = next[kind];
        if (!pool || pool.max <= 0 || pool.current >= pool.max) continue;
        if (pool.regenPerSec <= 0) continue;
        if ((pool.lastSpendAtMs ?? 0) + pool.regenDelayMs > nowMs) continue;
        pool.current = Math.min(pool.max, pool.current + (pool.regenPerSec * (dtMs / 1000)));
    }
    return next;
}

export function canSpendResource(resources, kind, amount, options = {}) {
    const pool = getResourcePool(resources, kind);
    const required = clampNonNegative(amount);
    if (!pool || required <= 0) return true;
    if (kind === RESOURCE_KINDS.stamina && options.allowPartialStaminaStart) {
        return pool.current > 0;
    }
    return pool.current >= required;
}

export function spendResource(resources, kind, amount, nowMs = Date.now(), options = {}) {
    const required = clampNonNegative(amount);
    const next = cloneResources(resources);
    const pool = getResourcePool(next, kind);
    if (!pool || required <= 0) return next;
    if (!canSpendResource(next, kind, required, options)) return resources;
    pool.current = Math.max(0, pool.current - required);
    const delayMs = (kind === RESOURCE_KINDS.stamina && pool.current <= 0)
        ? Math.max(pool.regenDelayMs, pool.exhaustedRegenDelayMs ?? 0)
        : pool.regenDelayMs;
    pool.lastSpendAtMs = nowMs + Math.max(0, delayMs - pool.regenDelayMs);
    return next;
}

export function drainResource(resources, kind, amount, nowMs = Date.now()) {
    const required = clampNonNegative(amount);
    const next = cloneResources(resources);
    const pool = getResourcePool(next, kind);
    if (!pool || required <= 0) return next;
    pool.current = Math.max(0, pool.current - required);
    const delayMs = (kind === RESOURCE_KINDS.stamina && pool.current <= 0)
        ? Math.max(pool.regenDelayMs, pool.exhaustedRegenDelayMs ?? 0)
        : pool.regenDelayMs;
    pool.lastSpendAtMs = nowMs + Math.max(0, delayMs - pool.regenDelayMs);
    return next;
}

export function restoreResource(resources, kind, amount) {
    const restored = clampNonNegative(amount);
    const next = cloneResources(resources);
    const pool = getResourcePool(next, kind);
    if (!pool || restored <= 0) return next;
    pool.current = Math.min(pool.max, pool.current + restored);
    return next;
}

export function fillResource(resources, kind) {
    const next = cloneResources(resources);
    const pool = getResourcePool(next, kind);
    if (!pool) return next;
    pool.current = pool.max;
    return next;
}

export function damageHealth(resources, amount, nowMs = Date.now()) {
    return drainResource(resources, RESOURCE_KINDS.hp, amount, nowMs);
}

export function healHealth(resources, amount) {
    return restoreResource(resources, RESOURCE_KINDS.hp, amount);
}

export function canPayResourceCosts(resources, costs = {}) {
    const staminaCost = clampNonNegative(costs.stamina ?? 0);
    const manaCost = clampNonNegative(costs.mana ?? 0);
    if (!canSpendResource(resources, RESOURCE_KINDS.stamina, staminaCost, { allowPartialStaminaStart: true })) {
        return false;
    }
    if (!canSpendResource(resources, RESOURCE_KINDS.mana, manaCost)) {
        return false;
    }
    return true;
}

export function payResourceCosts(resources, costs = {}, nowMs = Date.now()) {
    if (!canPayResourceCosts(resources, costs)) return resources;
    let next = cloneResources(resources);
    const staminaCost = clampNonNegative(costs.stamina ?? 0);
    const manaCost = clampNonNegative(costs.mana ?? 0);
    if (staminaCost > 0) {
        next = spendResource(next, RESOURCE_KINDS.stamina, staminaCost, nowMs, { allowPartialStaminaStart: true });
    }
    if (manaCost > 0) {
        next = spendResource(next, RESOURCE_KINDS.mana, manaCost, nowMs);
    }
    return next;
}

export function summarizeResources(resources = {}) {
    return {
        hp: {
            current: getResourcePool(resources, RESOURCE_KINDS.hp)?.current ?? 0,
            max: getResourcePool(resources, RESOURCE_KINDS.hp)?.max ?? 0,
        },
        stamina: {
            current: getResourcePool(resources, RESOURCE_KINDS.stamina)?.current ?? 0,
            max: getResourcePool(resources, RESOURCE_KINDS.stamina)?.max ?? 0,
        },
        mana: {
            current: getResourcePool(resources, RESOURCE_KINDS.mana)?.current ?? 0,
            max: getResourcePool(resources, RESOURCE_KINDS.mana)?.max ?? 0,
        },
    };
}
