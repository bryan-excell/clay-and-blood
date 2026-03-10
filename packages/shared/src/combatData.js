// Shared combat/archetype tuning data.
// Authoritative simulation reads from here; clients can also consume for UI/FX.

export const TEAM_IDS = Object.freeze({
    players: 'players',
    golems: 'golems',
    zombies: 'zombies',
    neutral: 'neutral',
});

export const DRAGGABLE_WORLD_KINDS = Object.freeze([
    'corpse',
]);

export const REACTION_CONFIG = Object.freeze({
    flinchDurationMs: 160,
    staggerDurationMs: 1000,
});

export const ARCHETYPE_CONFIG = Object.freeze({
    player: Object.freeze({
        teamId: TEAM_IDS.players,
        hitRadius: 16,
        sightRadius: 320,
        hpMax: 100,
        poise: Object.freeze({
            max: 10,
            flinchThreshold: 2,
            regenDelayMs: 1200,
            regenPerSec: 3,
        }),
    }),
    golem: Object.freeze({
        teamId: TEAM_IDS.golems,
        hitRadius: 20,
        sightRadius: 260,
        hpMax: 160,
        poise: Object.freeze({
            max: 18,
            flinchThreshold: 4,
            regenDelayMs: 1200,
            regenPerSec: 3.5,
        }),
    }),
    zombie: Object.freeze({
        teamId: TEAM_IDS.zombies,
        hitRadius: 18,
        sightRadius: 140,
        hpMax: 50,
        poise: Object.freeze({
            max: 6,
            flinchThreshold: 1,
            regenDelayMs: 1200,
            regenPerSec: 2.5,
        }),
        ai: Object.freeze({
            detectionRange: 140,
            leashRange: 300,
            attackRange: 65,
            reelBackMs: 500,
            reelBackDistance: 32,
            windupMs: 200,
            windupDistance: 50,
            recoverMs: 800,
            shambleSpeed: 65,
            chaseSpeed: 80,
            shambleWalkMinMs: 1500,
            shambleWalkMaxMs: 2500,
            shamblePauseMinMs: 800,
            shamblePauseMaxMs: 1800,
        }),
    }),
    corpse: Object.freeze({
        teamId: TEAM_IDS.neutral,
        hitRadius: 18,
        sightRadius: 0,
        hpMax: 0,
        decayDurationMs: 120000,
        poise: Object.freeze({
            max: 0,
            flinchThreshold: 0,
            regenDelayMs: 0,
            regenPerSec: 0,
        }),
    }),
});

export const MELEE_WEAPON_CONFIG = Object.freeze({
    unarmed: Object.freeze({
        queueGraceMs: 120,
        phases: Object.freeze([
            Object.freeze({
                windupMs: 100,
                activeMs: 100,
                stepDistance: 12,
                finishLockoutMs: 0,
                damage: 4,
                poiseDamage: 2,
                radius: 66,
                arc: Math.PI * 0.56,
                hyperArmorMs: 0,
                visual: Object.freeze({ color: 0xff9b47, alpha: 0.85 }),
            }),
        ]),
    }),
    sword: Object.freeze({
        queueGraceMs: 120,
        phases: Object.freeze([
            Object.freeze({
                windupMs: 200,
                activeMs: 100,
                stepDistance: 20,
                finishLockoutMs: 0,
                damage: 6,
                poiseDamage: 3,
                radius: 58,
                arc: Math.PI * 0.62,
                hyperArmorMs: 0,
                visual: Object.freeze({ color: 0xd2d8ff, alpha: 0.78 }),
            }),
            Object.freeze({
                windupMs: 200,
                activeMs: 100,
                stepDistance: 24,
                finishLockoutMs: 0,
                damage: 6,
                poiseDamage: 4,
                radius: 74,
                arc: Math.PI * 0.72,
                hyperArmorMs: 0,
                visual: Object.freeze({ color: 0xc4ceff, alpha: 0.80 }),
            }),
            Object.freeze({
                windupMs: 300,
                activeMs: 500,
                stepDistance: 34,
                finishLockoutMs: 140,
                damage: 10,
                poiseDamage: 5,
                radius: 102,
                arc: Math.PI * 0.88,
                hyperArmorMs: 420,
                visual: Object.freeze({ color: 0xb8c2ff, alpha: 0.84 }),
            }),
        ]),
    }),
    zombie_strike: Object.freeze({
        queueGraceMs: 0,
        phases: Object.freeze([
            Object.freeze({
                windupMs: 400,
                activeMs: 150,
                stepDistance: 60,
                finishLockoutMs: 0,
                damage: 6,
                poiseDamage: 2,
                radius: 52,
                arc: Math.PI * 0.5,
                hyperArmorMs: 0,
                visual: Object.freeze({ color: 0x44ff66, alpha: 0.72 }),
            }),
        ]),
    }),
});

export const MELEE_ATTACK_CONFIG = Object.freeze({
    unarmed: MELEE_WEAPON_CONFIG.unarmed.phases,
    sword: MELEE_WEAPON_CONFIG.sword.phases,
    zombie_strike: MELEE_WEAPON_CONFIG.zombie_strike.phases,
});

export const PROJECTILE_POISE_DAMAGE = Object.freeze({
    bullet: 1,
    arrow: 1,
});

export const SPELL_CONFIG = Object.freeze({
    imposing_flame: Object.freeze({
        id: 'imposing_flame',
        castMode: 'click',
        windupMs: 200,
        windupMoveSpeedMultiplier: 0.5,
        cooldownMs: 1000,
        projectile: Object.freeze({
            speed: 220,
            maxRange: 520,
            maxLifetimeMs: 1500,
            spawnOffset: 24,
        }),
        burst: Object.freeze({
            damage: 20,
            poiseDamage: 5,
            radius: 72,
        }),
    }),
    gelid_cradle: Object.freeze({
        id: 'gelid_cradle',
        castMode: 'hold_release',
        windupMs: 200,
        manifestDelayMs: 500,
        windupMoveSpeedMultiplier: 0.5,
        cooldownMs: 1500,
        burst: Object.freeze({
            damage: 15,
            poiseDamage: 10,
            radius: 80,
        }),
        indicator: Object.freeze({
            radius: 80,
            color: 0x7ad2ff,
            alpha: 0.22,
            outlineColor: 0xc7ecff,
            outlineAlpha: 0.9,
            outlineWidth: 2,
        }),
    }),
    arc_flash: Object.freeze({
        id: 'arc_flash',
        castMode: 'target_click',
        windupMs: 300,
        manifestDelayMs: 1000,
        windupMoveSpeedMultiplier: 0.5,
        cooldownMs: 1000,
        cooldownStartsAt: 'resolution',
        strike: Object.freeze({
            damage: 30,
            poiseDamage: 5,
        }),
    }),
    traction: Object.freeze({
        id: 'traction',
        castMode: 'target_click',
        windupMs: 800,
        windupMoveSpeedMultiplier: 0.5,
        cooldownMs: 0,
        traction: Object.freeze({
            dragMoveSpeedMultiplier: 0.75,
            followDistance: 28,
        }),
        targeting: Object.freeze({
            draggableKinds: DRAGGABLE_WORLD_KINDS,
        }),
    }),
});

export function resolveArchetypeConfig(kind) {
    if (typeof kind !== 'string') return null;
    return ARCHETYPE_CONFIG[kind] ?? null;
}

export function resolveMeleeAttackProfile(weaponId, phaseIndex = 0) {
    const weapon = resolveMeleeWeaponConfig(weaponId);
    const phases = weapon.phases;
    const index = Number.isFinite(phaseIndex)
        ? Math.max(0, Math.min(phases.length - 1, Math.floor(phaseIndex)))
        : 0;
    return phases[index];
}

export function resolveMeleeWeaponConfig(weaponId) {
    const key = MELEE_WEAPON_CONFIG[weaponId] ? weaponId : 'unarmed';
    return MELEE_WEAPON_CONFIG[key];
}

export function resolveSpellConfig(spellId) {
    if (typeof spellId !== 'string') return null;
    return SPELL_CONFIG[spellId] ?? null;
}

export function isDraggableWorldKind(kind) {
    return typeof kind === 'string' && DRAGGABLE_WORLD_KINDS.includes(kind);
}
