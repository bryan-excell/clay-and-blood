export const PARTICLE_SEMANTIC_COLORS = Object.freeze({
    HOSTILE: 0xcc2222,
    QUEST: 0xf5d87c,
    INTERACTABLE_NPC: 0x4dd4c0,
    DAMAGE_FLASH: 0xffffff,
    DAMAGE: 0xd23558,
    DEATH: 0x6633aa,
    CONTROLLED: 0x9ee7ff,
    POSSESSED: 0xb18cff,
    SAFE: 0xd9b66f,
});

export const DEFAULT_ZONE_PALETTE = Object.freeze({
    base: 0x8ab4f8,
    accent: 0xc2a0f0,
    shadow: 0x151926,
    ambientDensity: 500,
    ambientDrift: Object.freeze({ x: 0, y: -6 }),
    ambientTexture: 'particle-dot',
});

export const ZONE_PARTICLE_PALETTES = Object.freeze({
    lunavik: Object.freeze({
        base: 0xcfd7ff,
        accent: 0x4dd4c0,
        shadow: 0x101723,
        ambientDensity: 520,
        ambientDrift: Object.freeze({ x: 1, y: -5 }),
        ambientTexture: 'particle-dot',
    }),
    'western-wilds': Object.freeze({
        base: 0x94b884,
        accent: 0xb999ff,
        shadow: 0x121a14,
        ambientDensity: 620,
        ambientDrift: Object.freeze({ x: -2, y: -4 }),
        ambientTexture: 'particle-dot',
    }),
    'great-northern-road': Object.freeze({
        base: 0x8ab4f8,
        accent: 0xb7a6ff,
        shadow: 0x111827,
        ambientDensity: 560,
        ambientDrift: Object.freeze({ x: 0, y: -8 }),
        ambientTexture: 'particle-dot',
    }),
    'the-meadows': Object.freeze({
        base: 0x9ed7a6,
        accent: 0xd3a8ff,
        shadow: 0x152216,
        ambientDensity: 760,
        ambientDrift: Object.freeze({ x: 2, y: -4 }),
        ambientTexture: 'particle-dot',
    }),
    'the-grotto': Object.freeze({
        base: 0x5fd6d1,
        accent: 0x7d8cff,
        shadow: 0x0d1024,
        ambientDensity: 680,
        ambientDrift: Object.freeze({ x: 0, y: -3 }),
        ambientTexture: 'particle-soft',
    }),
    'the-misty-path': Object.freeze({
        base: 0xb7c7db,
        accent: 0xc7a7ff,
        shadow: 0x111821,
        ambientDensity: 720,
        ambientDrift: Object.freeze({ x: -1, y: -6 }),
        ambientTexture: 'particle-soft',
    }),
    'rolling-hills': Object.freeze({
        base: 0xb8d49b,
        accent: 0x9fc7ff,
        shadow: 0x172115,
        ambientDensity: 640,
        ambientDrift: Object.freeze({ x: 2, y: -5 }),
        ambientTexture: 'particle-dot',
    }),
});
