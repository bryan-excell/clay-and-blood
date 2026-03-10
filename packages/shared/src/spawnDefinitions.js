export const WORLD_SPAWN_DEFINITIONS = Object.freeze([
    Object.freeze({
        spawnKey: 'spawn:golem_town_square',
        kind: 'golem',
        levelId: 'town-square',
        tileX: 24,
        tileY: 20,
        tags: Object.freeze(['outdoor', 'town-square']),
    }),
    Object.freeze({
        spawnKey: 'spawn:zombie_west_gate',
        kind: 'zombie',
        levelId: 'west-gate',
        tileX: 6,
        tileY: 4,
        tags: Object.freeze(['outdoor', 'west-gate']),
    }),
]);

export function getWorldSpawnDefinitions() {
    return WORLD_SPAWN_DEFINITIONS;
}

export function getWorldSpawnDefinitionsForLevel(levelId) {
    if (typeof levelId !== 'string') return [];
    return WORLD_SPAWN_DEFINITIONS.filter((entry) => entry.levelId === levelId);
}

export function getWorldSpawnDefinition(spawnKey) {
    if (typeof spawnKey !== 'string') return null;
    return WORLD_SPAWN_DEFINITIONS.find((entry) => entry.spawnKey === spawnKey) ?? null;
}
