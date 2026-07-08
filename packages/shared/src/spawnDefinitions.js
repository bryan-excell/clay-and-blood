export const WORLD_SPAWN_DEFINITIONS = Object.freeze([]);

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
