import {
    TILE_EXIT,
    TILE_FLOOR,
    TILE_SHALLOW_WATER,
    TILE_TALL_GRASS,
    TILE_VOID,
    TILE_WALL,
} from './tileRegistry.js';

function cloneExit(exit) {
    return {
        ...exit,
        entryDirection: typeof exit?.entryDirection === 'string' ? exit.entryDirection : null,
    };
}

function cloneTerrainFeature(feature) {
    if (!feature || typeof feature !== 'object') return null;
    return {
        ...feature,
        cells: Array.isArray(feature.cells)
            ? feature.cells
                .filter((cell) => Number.isFinite(cell?.x) && Number.isFinite(cell?.y))
                .map((cell) => ({ x: cell.x, y: cell.y }))
            : undefined,
        rect: feature.rect && typeof feature.rect === 'object'
            ? {
                x: feature.rect.x,
                y: feature.rect.y,
                width: feature.rect.width,
                height: feature.rect.height,
            }
            : null,
        tags: Array.isArray(feature.tags) ? [...feature.tags] : [],
    };
}

function fnv1a32(input) {
    let hash = 0x811c9dc5;
    for (let i = 0; i < input.length; i++) {
        hash ^= input.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash >>> 0;
}

function formatUuidFromWords(a, b, c, d) {
    const p1 = a.toString(16).padStart(8, '0');
    const p2 = ((b >>> 16) & 0xffff).toString(16).padStart(4, '0');
    const rawP3 = (b & 0xffff);
    const p3 = (((rawP3 & 0x0fff) | 0x5000) >>> 0).toString(16).padStart(4, '0');
    const rawP4 = ((c >>> 16) & 0xffff);
    const p4 = (((rawP4 & 0x3fff) | 0x8000) >>> 0).toString(16).padStart(4, '0');
    const p5 = ((((c & 0xffff) << 16) | (d >>> 16)) >>> 0).toString(16).padStart(8, '0') +
        (d & 0xffff).toString(16).padStart(4, '0');
    return `${p1}-${p2}-${p3}-${p4}-${p5}`;
}

export function generateStageUuid(stageId) {
    const normalized = typeof stageId === 'string' && stageId.length > 0 ? stageId : 'unknown-stage';
    return formatUuidFromWords(
        fnv1a32(`stage:${normalized}:a`),
        fnv1a32(`stage:${normalized}:b`),
        fnv1a32(`stage:${normalized}:c`),
        fnv1a32(`stage:${normalized}:d`)
    );
}

function cloneStageDefinition(definition) {
    if (!definition) return null;
    return {
        ...definition,
        stageUuid: typeof definition.stageUuid === 'string'
            ? definition.stageUuid
            : generateStageUuid(definition.id ?? definition.stageSlug ?? 'unknown-stage'),
        stageSlug: definition.stageSlug ?? definition.id ?? null,
        tags: Array.isArray(definition.tags) ? [...definition.tags] : [],
        tiles: Array.isArray(definition.tiles) ? definition.tiles.map((row) => [...row]) : undefined,
        exits: Array.isArray(definition.exits) ? definition.exits.map(cloneExit) : undefined,
        terrainFeatures: Array.isArray(definition.terrainFeatures)
            ? definition.terrainFeatures.map(cloneTerrainFeature).filter(Boolean)
            : [],
        spawnPoint: definition.spawnPoint ? { ...definition.spawnPoint } : null,
        connectionsByExitId: definition.connectionsByExitId
            ? Object.fromEntries(
                Object.entries(definition.connectionsByExitId).map(([exitId, connection]) => [exitId, { ...connection }])
            )
            : {},
        generationConfig: definition.generationConfig ? { ...definition.generationConfig } : undefined,
    };
}

function emptyRoom(w, h) {
    return Array.from({ length: h }, (_, y) =>
        Array.from({ length: w }, (_, x) =>
            x === 0 || x === w - 1 || y === 0 || y === h - 1 ? TILE_WALL : TILE_FLOOR
        )
    );
}

function freezeGrid(grid) {
    return Object.freeze(grid.map((row) => Object.freeze([...row])));
}

const AUTHORED_STAGE_DEFINITIONS = {
    'town-square': (() => {
        const w = 40;
        const h = 40;
        const tiles = emptyRoom(w, h);
        const midX = Math.floor(w / 2);
        const midY = Math.floor(h / 2);

        tiles[0][midX] = TILE_EXIT;
        tiles[h - 1][midX] = TILE_EXIT;
        tiles[midY][0] = TILE_EXIT;
        tiles[midY][w - 1] = TILE_EXIT;

        for (let bx = 4; bx <= 10; bx++) {
            tiles[3][bx] = TILE_WALL;
            tiles[9][bx] = TILE_WALL;
        }
        for (let by = 4; by <= 8; by++) {
            tiles[by][4] = TILE_WALL;
            tiles[by][10] = TILE_WALL;
        }
        tiles[9][7] = TILE_EXIT;

        for (let bx = 29; bx <= 35; bx++) {
            tiles[3][bx] = TILE_WALL;
            tiles[9][bx] = TILE_WALL;
        }
        for (let by = 4; by <= 8; by++) {
            tiles[by][29] = TILE_WALL;
            tiles[by][35] = TILE_WALL;
        }
        tiles[9][32] = TILE_EXIT;

        const shallowWaterCells = [
            [5, 28], [6, 28], [7, 28], [8, 28], [9, 28],
            [4, 29], [5, 29], [6, 29], [7, 29], [8, 29], [9, 29], [10, 29],
            [4, 30], [5, 30], [6, 30], [7, 30], [8, 30], [9, 30], [10, 30],
            [3, 31], [4, 31], [5, 31], [6, 31], [7, 31], [8, 31], [9, 31], [10, 31],
            [3, 32], [4, 32], [5, 32], [6, 32], [7, 32], [8, 32], [9, 32],
            [4, 33], [5, 33], [6, 33], [7, 33], [8, 33], [9, 33],
            [5, 34], [6, 34], [7, 34], [8, 34],
        ];
        for (const [x, y] of shallowWaterCells) {
            if (tiles[y]?.[x] === TILE_FLOOR) {
                tiles[y][x] = TILE_SHALLOW_WATER;
            }
        }

        const tallGrassCells = [
            [30, 28], [31, 28], [32, 28], [33, 28], [34, 28], [35, 28],
            [29, 29], [30, 29], [31, 29], [32, 29], [33, 29], [34, 29], [35, 29], [36, 29],
            [29, 30], [30, 30], [31, 30], [32, 30], [33, 30], [34, 30], [35, 30], [36, 30],
            [28, 31], [29, 31], [30, 31], [31, 31], [32, 31], [33, 31], [34, 31], [35, 31], [36, 31],
            [28, 32], [29, 32], [30, 32], [31, 32], [32, 32], [33, 32], [34, 32], [35, 32], [36, 32],
            [29, 33], [30, 33], [31, 33], [32, 33], [33, 33], [34, 33], [35, 33], [36, 33],
            [30, 34], [31, 34], [32, 34], [33, 34], [34, 34], [35, 34],
        ];
        for (const [x, y] of tallGrassCells) {
            if (tiles[y]?.[x] === TILE_FLOOR) {
                tiles[y][x] = TILE_TALL_GRASS;
            }
        }

        return Object.freeze({
            id: 'town-square',
            stageSlug: 'town-square',
            stageUuid: '8e9d3f30-9793-4f6e-99a4-c5ef3e8c6c95',
            displayName: 'Town Square',
            kind: 'static',
            regionId: 'millhaven',
            tags: Object.freeze(['outdoor', 'hub', 'town']),
            floorTile: 'floor_dirt',
            width: w,
            height: h,
            tiles: freezeGrid(tiles),
            exits: Object.freeze([
                Object.freeze({ id: 'north-road', x: midX, y: 0, exitIndex: 0, side: 'north' }),
                Object.freeze({ id: 'south-road', x: midX, y: h - 1, exitIndex: 1, side: 'south' }),
                Object.freeze({ id: 'west-gate', x: 0, y: midY, exitIndex: 2, side: 'west' }),
                Object.freeze({ id: 'east-road', x: w - 1, y: midY, exitIndex: 3, side: 'east' }),
                Object.freeze({ id: 'inn-door', x: 7, y: 9, exitIndex: 4, side: 'interior' }),
                Object.freeze({ id: 'shop-door', x: 32, y: 9, exitIndex: 5, side: 'interior' }),
            ]),
            terrainFeatures: Object.freeze([]),
            spawnPoint: Object.freeze({ x: 20, y: 20 }),
            connectionsByExitId: Object.freeze({
                'west-gate': Object.freeze({ levelId: 'west-gate', exitId: 'east-road', exitIndex: 1, entryDirection: 'west' }),
                'inn-door': Object.freeze({ levelId: 'inn', exitId: 'front-door', exitIndex: 0, entryDirection: 'north' }),
                'shop-door': Object.freeze({ levelId: 'shop-1', exitId: 'front-door', exitIndex: 0, entryDirection: 'north' }),
            }),
        });
    })(),
    'west-gate': (() => {
        const w = 20;
        const h = 9;
        const tiles = emptyRoom(w, h);
        const midY = Math.floor(h / 2);
        tiles[midY][0] = TILE_EXIT;
        tiles[midY][w - 1] = TILE_EXIT;
        return Object.freeze({
            id: 'west-gate',
            stageSlug: 'west-gate',
            stageUuid: '454d9e2f-4639-4b46-b5a2-1be820f21dfe',
            displayName: 'West Gate',
            kind: 'static',
            regionId: 'millhaven',
            tags: Object.freeze(['outdoor', 'gatehouse']),
            floorTile: 'floor_dirt',
            width: w,
            height: h,
            tiles: freezeGrid(tiles),
            exits: Object.freeze([
                Object.freeze({ id: 'west-road', x: 0, y: midY, exitIndex: 0, side: 'west' }),
                Object.freeze({ id: 'east-road', x: w - 1, y: midY, exitIndex: 1, side: 'east' }),
            ]),
            terrainFeatures: Object.freeze([]),
            spawnPoint: Object.freeze({ x: 10, y: 4 }),
            connectionsByExitId: Object.freeze({
                'east-road': Object.freeze({ levelId: 'town-square', exitId: 'west-gate', exitIndex: 2, entryDirection: 'east' }),
            }),
        });
    })(),
    inn: (() => {
        const w = 16;
        const h = 12;
        const tiles = Array.from({ length: h }, () => new Array(w).fill(TILE_VOID));
        for (let y = 0; y <= 5; y++) {
            for (let x = 0; x <= 7; x++) {
                tiles[y][x] = (x === 0 || x === 7 || y === 0) ? TILE_WALL : TILE_FLOOR;
            }
        }
        for (let y = 6; y <= 11; y++) {
            for (let x = 0; x <= 15; x++) {
                tiles[y][x] = (x === 0 || x === 15 || y === 11) ? TILE_WALL : TILE_FLOOR;
            }
        }
        for (let x = 7; x <= 15; x++) {
            tiles[6][x] = TILE_WALL;
        }
        tiles[11][5] = TILE_EXIT;
        return Object.freeze({
            id: 'inn',
            stageSlug: 'inn',
            stageUuid: '8b385533-3fc4-4d45-8c4d-1c800f984f45',
            displayName: 'The Inn',
            kind: 'static',
            regionId: 'millhaven',
            tags: Object.freeze(['interior', 'town']),
            floorTile: 'floor_dirt',
            width: w,
            height: h,
            tiles: freezeGrid(tiles),
            exits: Object.freeze([
                Object.freeze({ id: 'front-door', x: 5, y: 11, exitIndex: 0, side: 'south' }),
            ]),
            terrainFeatures: Object.freeze([]),
            spawnPoint: Object.freeze({ x: 3, y: 9 }),
            connectionsByExitId: Object.freeze({
                'front-door': Object.freeze({ levelId: 'town-square', exitId: 'inn-door', exitIndex: 4, entryDirection: 'south' }),
            }),
        });
    })(),
    'shop-1': (() => {
        const w = 12;
        const h = 10;
        const tiles = emptyRoom(w, h);
        for (let x = 2; x <= 9; x++) tiles[2][x] = TILE_WALL;
        tiles[2][5] = TILE_FLOOR;
        tiles[h - 1][Math.floor(w / 2)] = TILE_EXIT;
        return Object.freeze({
            id: 'shop-1',
            stageSlug: 'shop-1',
            stageUuid: 'bb87d99a-7de5-4a3f-a409-e27baac84176',
            displayName: 'The Shop',
            kind: 'static',
            regionId: 'millhaven',
            tags: Object.freeze(['interior', 'merchant']),
            floorTile: 'floor_dirt',
            width: w,
            height: h,
            tiles: freezeGrid(tiles),
            exits: Object.freeze([
                Object.freeze({ id: 'front-door', x: Math.floor(w / 2), y: h - 1, exitIndex: 0, side: 'south' }),
            ]),
            terrainFeatures: Object.freeze([]),
            spawnPoint: Object.freeze({ x: Math.floor(w / 2), y: h - 2 }),
            connectionsByExitId: Object.freeze({
                'front-door': Object.freeze({ levelId: 'town-square', exitId: 'shop-door', exitIndex: 5, entryDirection: 'south' }),
            }),
        });
    })(),
};

const registry = new Map(
    Object.entries(AUTHORED_STAGE_DEFINITIONS).map(([stageId, definition]) => [stageId, cloneStageDefinition(definition)])
);

export const DEFAULT_STAGE_DEFINITION = Object.freeze({
    kind: 'procedural',
    width: 20,
    height: 20,
    floorTile: 'floor_dirt',
    generator: 'cave',
    generationConfig: Object.freeze({ generator: 'cave' }),
    regionId: 'western-wilds',
    tags: Object.freeze(['procedural', 'wilds']),
    terrainFeatures: Object.freeze([]),
});

export function getStageDefinition(stageId) {
    const stage = registry.get(stageId);
    if (stage) return cloneStageDefinition(stage);
    return {
        id: stageId,
        stageSlug: stageId,
        stageUuid: generateStageUuid(stageId),
        displayName: 'The Wilds',
        ...cloneStageDefinition(DEFAULT_STAGE_DEFINITION),
    };
}

export function registerStageDefinition(stageId, definition) {
    if (typeof stageId !== 'string' || !definition || typeof definition !== 'object') return;
    registry.set(stageId, {
        id: stageId,
        ...cloneStageDefinition(definition),
    });
}

export function getAllAuthoredStageDefinitions() {
    return [...registry.values()].map(cloneStageDefinition);
}

export function getLevelDisplayName(stageId) {
    return getStageDefinition(stageId)?.displayName ?? 'The Wilds';
}

export function getExitById(stageId, exitId) {
    const definition = getStageDefinition(stageId);
    if (!Array.isArray(definition?.exits)) return null;
    return definition.exits.find((exit) => exit.id === exitId) ?? null;
}

export function getExitByIndex(stageId, exitIndex) {
    const definition = getStageDefinition(stageId);
    if (!Array.isArray(definition?.exits)) return null;
    return definition.exits.find((exit) => exit.exitIndex === exitIndex) ?? null;
}

// Compatibility bridge for legacy callers. Migrate consumers to getStageDefinition.
export const STATIC_STAGE_LAYOUTS = new Proxy({}, {
    get(_target, prop) {
        if (typeof prop !== 'string') return undefined;
        const definition = registry.get(prop);
        if (!definition?.tiles) return undefined;
        return {
            width: definition.width,
            height: definition.height,
            tiles: definition.tiles.map((row) => [...row]),
            exits: definition.exits.map(cloneExit),
        };
    },
    ownKeys() {
        return [...registry.keys()];
    },
    getOwnPropertyDescriptor() {
        return { enumerable: true, configurable: true };
    },
});

// Compatibility bridge for legacy callers. Migrate consumers to getStageDefinition.
export const STATIC_EXIT_CONNECTIONS = new Proxy({}, {
    get(_target, prop) {
        if (typeof prop !== 'string') return undefined;
        const definition = registry.get(prop);
        if (!definition?.connectionsByExitId || !Array.isArray(definition.exits)) return undefined;
        const connections = {};
        for (const exit of definition.exits) {
            const connection = definition.connectionsByExitId[exit.id];
            if (!connection) continue;
            connections[exit.exitIndex] = {
                levelId: connection.levelId,
                exitId: connection.exitId ?? null,
                exitIndex: Number.isInteger(connection.exitIndex) ? connection.exitIndex : null,
                entryDirection: connection.entryDirection ?? null,
            };
        }
        return connections;
    },
    ownKeys() {
        return [...registry.keys()];
    },
    getOwnPropertyDescriptor() {
        return { enumerable: true, configurable: true };
    },
});

// Compatibility bridge for legacy callers. Migrate consumers to getStageDefinition.
export const STATIC_STAGE_SPAWN_POINTS = new Proxy({}, {
    get(_target, prop) {
        if (typeof prop !== 'string') return undefined;
        const definition = registry.get(prop);
        return definition?.spawnPoint ? { ...definition.spawnPoint } : undefined;
    },
    ownKeys() {
        return [...registry.keys()];
    },
    getOwnPropertyDescriptor() {
        return { enumerable: true, configurable: true };
    },
});
