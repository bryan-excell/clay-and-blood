export const TILE_FLOOR = 0;
export const TILE_WALL = 1;
export const TILE_EXIT = 2;
export const TILE_VOID = 3;
export const TILE_TALL_GRASS = 4;
export const TILE_SHALLOW_WATER = 5;

export const TILE_PROPERTIES = Object.freeze({
    [TILE_FLOOR]: Object.freeze({
        id: 'floor',
        name: 'Floor',
        walkable: true,
        solid: false,
        blocksVision: false,
        speedMultiplier: 1,
        visibilityModifier: 1,
        isExit: false,
        tags: Object.freeze(['ground']),
    }),
    [TILE_TALL_GRASS]: Object.freeze({
        id: 'tall_grass',
        name: 'Tall Grass',
        walkable: true,
        solid: false,
        blocksVision: false,
        speedMultiplier: 0.8,
        visibilityModifier: 0.7,
        concealment: 0.5,
        isExit: false,
        tags: Object.freeze(['ground', 'concealment', 'vegetation']),
    }),
    [TILE_SHALLOW_WATER]: Object.freeze({
        id: 'shallow_water',
        name: 'Shallow Water',
        walkable: true,
        solid: false,
        blocksVision: false,
        speedMultiplier: 0.7,
        visibilityModifier: 1,
        isExit: false,
        tags: Object.freeze(['ground', 'water']),
    }),
    [TILE_WALL]: Object.freeze({
        id: 'wall',
        name: 'Wall',
        walkable: false,
        solid: true,
        blocksVision: true,
        speedMultiplier: 0,
        visibilityModifier: 0,
        isExit: false,
        tags: Object.freeze(['solid', 'structure']),
    }),
    [TILE_EXIT]: Object.freeze({
        id: 'exit',
        name: 'Exit',
        walkable: true,
        solid: false,
        blocksVision: false,
        speedMultiplier: 1,
        visibilityModifier: 1,
        isExit: true,
        tags: Object.freeze(['ground', 'transition']),
    }),
    [TILE_VOID]: Object.freeze({
        id: 'void',
        name: 'Void',
        walkable: false,
        solid: true,
        blocksVision: true,
        speedMultiplier: 0,
        visibilityModifier: 0,
        isExit: false,
        tags: Object.freeze(['solid', 'out_of_bounds']),
    }),
});

const DEFAULT_TILE_PROPERTIES = Object.freeze({
    id: 'unknown',
    name: 'Unknown',
    walkable: false,
    solid: true,
    blocksVision: true,
    speedMultiplier: 0,
    visibilityModifier: 0,
    isExit: false,
    tags: Object.freeze(['unknown']),
});

export function getTileProperties(tileType) {
    return TILE_PROPERTIES[tileType] ?? DEFAULT_TILE_PROPERTIES;
}

export function isSolidTile(tileType) {
    return getTileProperties(tileType).solid === true;
}

export function isWalkableTile(tileType) {
    return getTileProperties(tileType).walkable === true;
}

export function tileBlocksVision(tileType) {
    return getTileProperties(tileType).blocksVision === true;
}

export function tileHasTag(tileType, tag) {
    if (typeof tag !== 'string' || tag.length === 0) return false;
    return getTileProperties(tileType).tags.includes(tag);
}

export function getTileSpeedMultiplier(tileType) {
    const multiplier = getTileProperties(tileType).speedMultiplier;
    return Number.isFinite(multiplier) ? Math.max(0, multiplier) : 1;
}
