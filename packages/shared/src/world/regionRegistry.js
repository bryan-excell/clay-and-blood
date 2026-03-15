const REGION_DEFINITIONS = Object.freeze({
    millhaven: Object.freeze({
        id: 'millhaven',
        displayName: 'Millhaven',
        biome: 'town',
        stageIds: Object.freeze(['town-square', 'west-gate', 'inn', 'shop-1']),
        tags: Object.freeze(['safe-zone', 'settlement']),
    }),
    'western-wilds': Object.freeze({
        id: 'western-wilds',
        displayName: 'Western Wilds',
        biome: 'wilds',
        stageIds: Object.freeze([]),
        tags: Object.freeze(['outdoor']),
    }),
});

export function getRegionDefinition(regionId) {
    return typeof regionId === 'string' ? REGION_DEFINITIONS[regionId] ?? null : null;
}

export function getAllRegionDefinitions() {
    return Object.values(REGION_DEFINITIONS);
}
