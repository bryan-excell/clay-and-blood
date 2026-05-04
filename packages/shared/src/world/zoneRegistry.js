const ZONE_SEPARATOR = '::';

const ZONE_DEFINITIONS = Object.freeze({
    millhaven: Object.freeze({
        id: 'millhaven',
        displayName: 'Millhaven',
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
        stageIds: Object.freeze([
            'great-northern-road::road-01',
            'great-northern-road::road-02',
            'great-northern-road::road-03',
            'great-northern-road::road-04',
            'great-northern-road::road-05',
            'great-northern-road::road-06',
            'great-northern-road::road-07',
            'great-northern-road::road-08',
            'great-northern-road::road-09',
            'great-northern-road::road-10',
            'great-northern-road::road-11',
            'great-northern-road::road-12',
            'great-northern-road::road-13',
            'great-northern-road::road-14',
            'great-northern-road::road-15',
        ]),
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
