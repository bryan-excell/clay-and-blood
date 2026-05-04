import { getGreatNorthernRoadStageIds } from './generators/greatNorthernRoad.js';

const ZONE_SEPARATOR = '::';

const ZONE_DEFINITIONS = Object.freeze({
    lunavik: Object.freeze({
        id: 'lunavik',
        displayName: 'Lunavik',
        biome: 'town',
        tags: Object.freeze(['safe-zone', 'settlement']),
        hubStageId: 'town-square',
        stageIds: Object.freeze(['town-square', 'west-gate', 'inn', 'shop-1', 'northern-gate']),
        proceduralPrefix: null,
        defaultStage: Object.freeze({
            kind: 'procedural',
            width: 20,
            height: 20,
            floorTile: 'floor_dirt',
            generator: 'cave',
            generationConfig: Object.freeze({ generator: 'cave' }),
            tags: Object.freeze(['town']),
        }),
    }),
    'great-northern-road': Object.freeze({
        id: 'great-northern-road',
        displayName: 'The Great Northern Road',
        biome: 'road',
        tags: Object.freeze(['outdoor', 'road', 'travel']),
        hubStageId: 'great-northern-road::road-01',
        stageIds: Object.freeze(getGreatNorthernRoadStageIds()),
        proceduralPrefix: null,
        defaultStage: Object.freeze({
            kind: 'procedural',
            width: 32,
            height: 12,
            floorTile: 'floor_dirt',
            generator: 'road',
            generationConfig: Object.freeze({ generator: 'road' }),
            tags: Object.freeze(['outdoor', 'road']),
        }),
    }),
    'western-wilds': Object.freeze({
        id: 'western-wilds',
        displayName: 'Western Wilds',
        biome: 'wilds',
        tags: Object.freeze(['outdoor', 'hostile']),
        hubStageId: null,
        stageIds: Object.freeze([]),
        proceduralPrefix: `western-wilds${ZONE_SEPARATOR}`,
        defaultStage: Object.freeze({
            kind: 'procedural',
            width: 20,
            height: 20,
            floorTile: 'floor_dirt',
            generator: 'cave',
            generationConfig: Object.freeze({ generator: 'cave' }),
            tags: Object.freeze(['procedural', 'wilds']),
        }),
    }),
});

function cloneZoneDefinition(definition) {
    if (!definition) return null;
    return {
        ...definition,
        tags: Array.isArray(definition.tags) ? [...definition.tags] : [],
        stageIds: Array.isArray(definition.stageIds) ? [...definition.stageIds] : [],
        defaultStage: definition.defaultStage ? {
            ...definition.defaultStage,
            tags: Array.isArray(definition.defaultStage.tags) ? [...definition.defaultStage.tags] : [],
            generationConfig: definition.defaultStage.generationConfig
                ? { ...definition.defaultStage.generationConfig }
                : undefined,
        } : null,
    };
}

export function getZoneDefinition(zoneId) {
    return typeof zoneId === 'string' ? cloneZoneDefinition(ZONE_DEFINITIONS[zoneId]) : null;
}

export function getAllZoneDefinitions() {
    return Object.values(ZONE_DEFINITIONS).map(cloneZoneDefinition);
}

export function getZoneIdFromStageId(stageId) {
    if (typeof stageId !== 'string' || stageId.length === 0) return null;
    const separatorIndex = stageId.indexOf(ZONE_SEPARATOR);
    if (separatorIndex > 0) {
        const zoneId = stageId.slice(0, separatorIndex);
        return ZONE_DEFINITIONS[zoneId] ? zoneId : null;
    }

    for (const definition of Object.values(ZONE_DEFINITIONS)) {
        if (definition.stageIds.includes(stageId)) return definition.id;
    }
    return null;
}

export function getDefaultZoneId() {
    return 'western-wilds';
}

export function formatProceduralStageId(zoneId, localId) {
    const zone = getZoneDefinition(zoneId) ?? getZoneDefinition(getDefaultZoneId());
    const normalizedLocalId = typeof localId === 'string' && localId.length > 0
        ? localId
        : 'proc-unknown';
    return `${zone.id}${ZONE_SEPARATOR}${normalizedLocalId}`;
}
