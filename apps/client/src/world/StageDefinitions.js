/**
 * Compatibility wrapper around the shared world registry.
 * Authored stage authority now lives in @clay-and-blood/shared.
 */
import {
    getLevelDisplayName as getSharedLevelDisplayName,
    getStageDefinition as getSharedStageDefinition,
    registerStageDefinition as registerSharedStageDefinition,
} from '@clay-and-blood/shared';

export function getLevelDisplayName(levelId) {
    return getSharedLevelDisplayName(levelId);
}

export function getStageDefinition(levelId) {
    const definition = getSharedStageDefinition(levelId);
    if (!definition) return null;
    return {
        id: definition.id,
        stageSlug: definition.stageSlug ?? definition.id ?? null,
        stageUuid: definition.stageUuid ?? null,
        kind: definition.kind ?? 'procedural',
        type: definition.kind === 'static' ? 'static' : 'random',
        floorTile: definition.floorTile ?? 'floor_dirt',
        width: definition.width,
        height: definition.height,
        tiles: Array.isArray(definition.tiles) ? definition.tiles.map((row) => [...row]) : undefined,
        exits: Array.isArray(definition.exits) ? definition.exits.map((exit) => ({ ...exit })) : undefined,
        terrainFeatures: Array.isArray(definition.terrainFeatures)
            ? definition.terrainFeatures.map((feature) => ({
                ...feature,
                cells: Array.isArray(feature.cells) ? feature.cells.map((cell) => ({ ...cell })) : undefined,
                rect: feature.rect ? { ...feature.rect } : null,
                tags: Array.isArray(feature.tags) ? [...feature.tags] : [],
            }))
            : [],
        spawnPoint: definition.spawnPoint ? { ...definition.spawnPoint } : null,
        connections: Array.isArray(definition.exits)
            ? Object.fromEntries(
                definition.exits
                    .map((exit) => {
                        const connection = definition.connectionsByExitId?.[exit.id];
                        if (!connection) return null;
                        return [exit.exitIndex, {
                            levelId: connection.levelId,
                            exitId: connection.exitId ?? null,
                            exitIndex: Number.isInteger(connection.exitIndex) ? connection.exitIndex : null,
                            arrivalDirection: connection.arrivalDirection ?? null,
                            entryDirection: connection.arrivalDirection ?? null,
                        }];
                    })
                    .filter(Boolean)
            )
            : {},
        generator: definition.generator ?? definition.generationConfig?.generator ?? 'cave',
        regionId: definition.regionId ?? null,
        displayName: definition.displayName ?? null,
        tags: Array.isArray(definition.tags) ? [...definition.tags] : [],
    };
}

export function registerStageDefinition(levelId, definition) {
    registerSharedStageDefinition(levelId, definition);
}
