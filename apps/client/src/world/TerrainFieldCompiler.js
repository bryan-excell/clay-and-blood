import {
    TILE_EXIT,
    TILE_FLOOR,
    TILE_SHALLOW_WATER,
    TILE_TALL_GRASS,
    TILE_VOID,
    TILE_WALL,
    getTileProperties,
    tileHasTag,
} from '@clay-and-blood/shared';

export const TERRAIN_MATERIAL = Object.freeze({
    floor: 0,
    grass: 1,
    water: 2,
    wall: 3,
    void: 4,
    exit: 5,
});

const FEATURE_TYPE_TO_MATERIAL = Object.freeze({
    grass_patch: TERRAIN_MATERIAL.grass,
    tall_grass_patch: TERRAIN_MATERIAL.grass,
    water_pool: TERRAIN_MATERIAL.water,
    shallow_water_pool: TERRAIN_MATERIAL.water,
});

const INF = 1_000_000;
const DIAGONAL_COST = Math.SQRT2;

export function compileTerrainFields(stageData) {
    const width = Math.max(0, Math.floor(stageData?.width ?? 0));
    const height = Math.max(0, Math.floor(stageData?.height ?? 0));
    const cellCount = width * height;
    const material = new Uint8Array(cellCount);
    const walkable = new Uint8Array(cellCount);
    const solid = new Uint8Array(cellCount);
    const grassMask = new Uint8Array(cellCount);
    const waterMask = new Uint8Array(cellCount);
    const wallMask = new Uint8Array(cellCount);
    const noiseA = new Float32Array(cellCount);
    const noiseB = new Float32Array(cellCount);
    const noiseC = new Float32Array(cellCount);

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const index = fieldIndex(width, x, y);
            const tile = stageData.grid?.[y]?.[x] ?? TILE_VOID;
            const tileMaterial = materialFromTile(tile);
            const properties = getTileProperties(tile);
            material[index] = tileMaterial;
            walkable[index] = properties.walkable ? 1 : 0;
            solid[index] = properties.solid || tileHasTag(tile, 'out_of_bounds') ? 1 : 0;
        }
    }

    applyFeatureMaterials(stageData?.terrainFeatures ?? [], width, height, material);

    for (let index = 0; index < cellCount; index++) {
        grassMask[index] = material[index] === TERRAIN_MATERIAL.grass ? 1 : 0;
        waterMask[index] = material[index] === TERRAIN_MATERIAL.water ? 1 : 0;
        wallMask[index] = solid[index] || material[index] === TERRAIN_MATERIAL.wall || material[index] === TERRAIN_MATERIAL.void ? 1 : 0;
    }

    const distToGrass = computeDistanceToMask(width, height, grassMask);
    const distToNonGrass = computeDistanceToMask(width, height, invertMask(grassMask));
    const distToWater = computeDistanceToMask(width, height, waterMask);
    const distToNonWater = computeDistanceToMask(width, height, invertMask(waterMask));
    const wallDist = computeDistanceToMask(width, height, wallMask);
    const signedGrassDist = new Float32Array(cellCount);
    const signedWaterDist = new Float32Array(cellCount);
    const openness = new Float32Array(cellCount);
    const seed = hashString(stageData?.stageUuid ?? stageData?.stageSlug ?? stageData?.id ?? 'terrain');

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const index = fieldIndex(width, x, y);
            signedGrassDist[index] = grassMask[index]
                ? clampDistance(distToNonGrass[index])
                : -clampDistance(distToGrass[index]);
            signedWaterDist[index] = waterMask[index]
                ? clampDistance(distToNonWater[index])
                : -clampDistance(distToWater[index]);
            openness[index] = computeOpenness(width, height, solid, wallDist, x, y);
            noiseA[index] = hashNoise(seed, x, y, 1);
            noiseB[index] = hashNoise(seed, x, y, 2);
            noiseC[index] = hashNoise(seed, x, y, 3);
        }
    }

    return {
        version: 1,
        width,
        height,
        material,
        walkable,
        solid,
        grassMask,
        waterMask,
        wallMask,
        signedGrassDist,
        signedWaterDist,
        wallDist,
        openness,
        noiseA,
        noiseB,
        noiseC,
    };
}

export function fieldIndex(width, x, y) {
    return y * width + x;
}

export function sampleField(fields, arrayName, x, y, fallback = 0) {
    if (!fields || !fields[arrayName]) return fallback;
    const tx = Math.floor(x);
    const ty = Math.floor(y);
    if (tx < 0 || ty < 0 || tx >= fields.width || ty >= fields.height) return fallback;
    return fields[arrayName][fieldIndex(fields.width, tx, ty)] ?? fallback;
}

function materialFromTile(tile) {
    if (tile === TILE_TALL_GRASS) return TERRAIN_MATERIAL.grass;
    if (tile === TILE_SHALLOW_WATER) return TERRAIN_MATERIAL.water;
    if (tile === TILE_WALL) return TERRAIN_MATERIAL.wall;
    if (tile === TILE_VOID) return TERRAIN_MATERIAL.void;
    if (tile === TILE_EXIT) return TERRAIN_MATERIAL.exit;
    if (tile === TILE_FLOOR) return TERRAIN_MATERIAL.floor;
    const properties = getTileProperties(tile);
    if (properties.solid) return TERRAIN_MATERIAL.wall;
    return TERRAIN_MATERIAL.floor;
}

function applyFeatureMaterials(features, width, height, material) {
    for (const feature of features) {
        const nextMaterial = FEATURE_TYPE_TO_MATERIAL[feature?.type];
        if (!Number.isFinite(nextMaterial)) continue;
        for (const cell of expandFeatureCells(feature)) {
            if (cell.x < 0 || cell.y < 0 || cell.x >= width || cell.y >= height) continue;
            const index = fieldIndex(width, cell.x, cell.y);
            if (material[index] === TERRAIN_MATERIAL.wall || material[index] === TERRAIN_MATERIAL.void) continue;
            material[index] = nextMaterial;
        }
    }
}

function expandFeatureCells(feature) {
    const cells = [];
    if (Array.isArray(feature?.cells)) {
        for (const cell of feature.cells) {
            if (!Number.isFinite(cell?.x) || !Number.isFinite(cell?.y)) continue;
            cells.push({ x: Math.floor(cell.x), y: Math.floor(cell.y) });
        }
    }
    if (feature?.rect && Number.isFinite(feature.rect.x) && Number.isFinite(feature.rect.y) &&
        Number.isFinite(feature.rect.width) && Number.isFinite(feature.rect.height)) {
        const startX = Math.floor(feature.rect.x);
        const startY = Math.floor(feature.rect.y);
        const endX = Math.ceil(feature.rect.x + feature.rect.width);
        const endY = Math.ceil(feature.rect.y + feature.rect.height);
        for (let y = startY; y < endY; y++) {
            for (let x = startX; x < endX; x++) {
                cells.push({ x, y });
            }
        }
    }
    return cells;
}

function computeDistanceToMask(width, height, mask) {
    const dist = new Float32Array(width * height);
    for (let i = 0; i < dist.length; i++) {
        dist[i] = mask[i] ? 0 : INF;
    }

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const i = fieldIndex(width, x, y);
            let best = dist[i];
            if (x > 0) best = Math.min(best, dist[i - 1] + 1);
            if (y > 0) best = Math.min(best, dist[i - width] + 1);
            if (x > 0 && y > 0) best = Math.min(best, dist[i - width - 1] + DIAGONAL_COST);
            if (x < width - 1 && y > 0) best = Math.min(best, dist[i - width + 1] + DIAGONAL_COST);
            dist[i] = best;
        }
    }

    for (let y = height - 1; y >= 0; y--) {
        for (let x = width - 1; x >= 0; x--) {
            const i = fieldIndex(width, x, y);
            let best = dist[i];
            if (x < width - 1) best = Math.min(best, dist[i + 1] + 1);
            if (y < height - 1) best = Math.min(best, dist[i + width] + 1);
            if (x < width - 1 && y < height - 1) best = Math.min(best, dist[i + width + 1] + DIAGONAL_COST);
            if (x > 0 && y < height - 1) best = Math.min(best, dist[i + width - 1] + DIAGONAL_COST);
            dist[i] = best;
        }
    }

    return dist;
}

function invertMask(mask) {
    const inverted = new Uint8Array(mask.length);
    for (let i = 0; i < mask.length; i++) inverted[i] = mask[i] ? 0 : 1;
    return inverted;
}

function clampDistance(value) {
    if (!Number.isFinite(value) || value >= INF * 0.5) return 999;
    return Math.min(999, value);
}

function computeOpenness(width, height, solid, wallDist, x, y) {
    let openCount = 0;
    let total = 0;
    for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
            total++;
            if (!solid[fieldIndex(width, nx, ny)]) openCount++;
        }
    }
    const localOpen = total > 0 ? openCount / total : 0;
    const distanceOpen = Math.min(1, clampDistance(wallDist[fieldIndex(width, x, y)]) / 5);
    return localOpen * 0.55 + distanceOpen * 0.45;
}

function hashString(input) {
    let hash = 2166136261;
    const text = String(input ?? '');
    for (let i = 0; i < text.length; i++) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}

function hashNoise(seed, x, y, salt) {
    let h = seed ^ Math.imul(x + 0x9e3779b9, 0x85ebca6b);
    h ^= Math.imul(y + 0xc2b2ae35, 0x27d4eb2d);
    h ^= Math.imul(salt + 0x165667b1, 0x9e3779b1);
    h ^= h >>> 16;
    h = Math.imul(h, 0x7feb352d);
    h ^= h >>> 15;
    h = Math.imul(h, 0x846ca68b);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967295;
}
