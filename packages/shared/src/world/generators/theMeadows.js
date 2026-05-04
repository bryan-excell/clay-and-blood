import { createAuthoredStageDefinition } from '../authoredStage.js';
import { createRng, intRange } from './rng.js';

export const THE_MEADOWS_ZONE_ID = 'the-meadows';
export const THE_MEADOWS_DEFAULT_WORLD_SEED = 'meadows-map-01';

const GRID_SIZE = 5;
const ENTRY_COORD = Object.freeze({ x: 0, y: 2 });
const CLEARING_COORD = Object.freeze({ x: 2, y: 2 });
export const A_CLEARING_STAGE_ID = `${THE_MEADOWS_ZONE_ID}::a-clearing`;
const OMITTED_COORDS = Object.freeze(new Set([
    '4,0',
    '0,4',
]));

const SIDE_ORDER = Object.freeze(['north', 'east', 'south', 'west']);
const SIDE_MARKERS = Object.freeze({
    north: 'A',
    east: 'B',
    south: 'C',
    west: 'D',
});
const SIDE_VECTORS = Object.freeze({
    north: Object.freeze({ dx: 0, dy: -1 }),
    east: Object.freeze({ dx: 1, dy: 0 }),
    south: Object.freeze({ dx: 0, dy: 1 }),
    west: Object.freeze({ dx: -1, dy: 0 }),
});
const OPPOSITE_SIDE = Object.freeze({
    north: 'south',
    east: 'west',
    south: 'north',
    west: 'east',
});

function coordKey(x, y) {
    return `${x},${y}`;
}

function stageIdForCoord(x, y) {
    if (x === CLEARING_COORD.x && y === CLEARING_COORD.y) return A_CLEARING_STAGE_ID;
    return `${THE_MEADOWS_ZONE_ID}::meadow-r${y + 1}c${x + 1}`;
}

function displayNameForCoord(x, y) {
    if (x === CLEARING_COORD.x && y === CLEARING_COORD.y) return 'A Clearing';
    return `The Meadows ${y + 1}-${x + 1}`;
}

function hasStageAt(x, y) {
    return x >= 0 && x < GRID_SIZE && y >= 0 && y < GRID_SIZE && !OMITTED_COORDS.has(coordKey(x, y));
}

function getStageCoords() {
    const coords = [];
    for (let y = 0; y < GRID_SIZE; y++) {
        for (let x = 0; x < GRID_SIZE; x++) {
            if (hasStageAt(x, y)) coords.push(Object.freeze({ x, y }));
        }
    }
    return coords;
}

function isEntryCoord(x, y) {
    return x === ENTRY_COORD.x && y === ENTRY_COORD.y;
}

function isClearingCoord(x, y) {
    return x === CLEARING_COORD.x && y === CLEARING_COORD.y;
}

function getExitSidesForCoord(x, y) {
    return SIDE_ORDER.filter((side) => {
        const vector = SIDE_VECTORS[side];
        return hasStageAt(x + vector.dx, y + vector.dy) || (side === 'west' && isEntryCoord(x, y));
    });
}

function exitIdForSide(side) {
    return `${side}-path`;
}

function exitPositionForSide(side, width, height) {
    switch (side) {
        case 'north': return { x: Math.floor(width / 2), y: 0 };
        case 'east': return { x: width - 1, y: Math.floor(height / 2) };
        case 'south': return { x: Math.floor(width / 2), y: height - 1 };
        case 'west': return { x: 0, y: Math.floor(height / 2) };
        default: return { x: Math.floor(width / 2), y: Math.floor(height / 2) };
    }
}

function arrivalForSide(side, width, height) {
    const position = exitPositionForSide(side, width, height);
    switch (side) {
        case 'north': return { x: position.x, y: 1, facing: 'south' };
        case 'east': return { x: width - 2, y: position.y, facing: 'west' };
        case 'south': return { x: position.x, y: height - 2, facing: 'north' };
        case 'west': return { x: 1, y: position.y, facing: 'east' };
        default: return { x: position.x, y: position.y, facing: null };
    }
}

function carveLine(grid, from, to, char = '.') {
    let x = from.x;
    let y = from.y;
    while (x !== to.x) {
        grid[y][x] = char;
        x += x < to.x ? 1 : -1;
    }
    while (y !== to.y) {
        grid[y][x] = char;
        y += y < to.y ? 1 : -1;
    }
    grid[y][x] = char;
}

function addPatch(grid, rng, char, radiusMin, radiusMax) {
    const height = grid.length;
    const width = grid[0].length;
    const cx = intRange(rng, 4, width - 5);
    const cy = intRange(rng, 4, height - 5);
    const rx = intRange(rng, radiusMin, radiusMax);
    const ry = intRange(rng, radiusMin, radiusMax);
    for (let y = Math.max(1, cy - ry); y < Math.min(height - 1, cy + ry + 1); y++) {
        for (let x = Math.max(1, cx - rx); x < Math.min(width - 1, cx + rx + 1); x++) {
            const nx = (x - cx) / Math.max(1, rx);
            const ny = (y - cy) / Math.max(1, ry);
            if ((nx * nx) + (ny * ny) > 1 + rng() * 0.3) continue;
            grid[y][x] = char;
        }
    }
}

function buildMeadowAscii({ width, height, exitSides, rng }) {
    const grid = Array.from({ length: height }, (_, y) => (
        Array.from({ length: width }, (_, x) => (x === 0 || y === 0 || x === width - 1 || y === height - 1 ? '^' : '.'))
    ));

    for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
            if (rng() < 0.44) grid[y][x] = ',';
        }
    }

    for (let i = 0; i < intRange(rng, 4, 8); i++) addPatch(grid, rng, ',', 3, 8);
    for (let i = 0; i < intRange(rng, 1, 3); i++) addPatch(grid, rng, '~', 2, 5);
    for (let i = 0; i < intRange(rng, 2, 5); i++) addPatch(grid, rng, '.', 4, 9);

    const center = { x: Math.floor(width / 2), y: Math.floor(height / 2) };
    grid[center.y][center.x] = '.';
    for (const side of exitSides) {
        const arrival = arrivalForSide(side, width, height);
        carveLine(grid, center, arrival, '.');
        const marker = SIDE_MARKERS[side];
        const exit = exitPositionForSide(side, width, height);
        grid[exit.y][exit.x] = marker;
        grid[arrival.y][arrival.x] = '.';
    }

    return grid.map((row) => row.join('')).join('\n');
}

function createClearingStage(coord, options = {}) {
    const width = 25;
    const height = 19;
    const exitSides = getExitSidesForCoord(coord.x, coord.y);
    const exitMarkers = Object.fromEntries(exitSides.map((side) => {
        const sideIndex = SIDE_ORDER.indexOf(side);
        return [SIDE_MARKERS[side], Object.freeze({
            id: exitIdForSide(side),
            exitIndex: sideIndex,
            connectionRole: side,
            arrival: Object.freeze(arrivalForSide(side, width, height)),
        })];
    }));
    exitMarkers.X = Object.freeze({
        id: 'grotto-mouth',
        exitIndex: 4,
        connectionRole: 'grotto',
        side: 'interior',
        arrival: Object.freeze({ x: 12, y: 8, facing: 'south' }),
    });

    const stage = createAuthoredStageDefinition({
        id: A_CLEARING_STAGE_ID,
        stageSlug: A_CLEARING_STAGE_ID,
        displayName: 'A Clearing',
        zoneId: THE_MEADOWS_ZONE_ID,
        tags: Object.freeze(['outdoor', 'field', 'meadow', 'landmark', 'static']),
        floorTile: 'floor_dirt',
        map: `
^^^^^^^^^^^^A^^^^^^^^^^^^
^^^^^^^...........^^^^^^^
^^^^.................^^^^
^^^...................^^^
^^.....................^^
^.........,,,,,.........^
^.......,,,,,,,,,.......^
^......,,,,~~~,,,,......^
^......,,,~~~~~,,,......^
D......,,~~~X~~~,,......B
^......,,,~~~~~,,,......^
^......,,,,~~~,,,,......^
^.......,,,,,,,,,.......^
^.........,,,,,.........^
^^.....................^^
^^^...................^^^
^^^^.................^^^^
^^^^^^^...........^^^^^^^
^^^^^^^^^^^^C^^^^^^^^^^^^
`,
        exitMarkers: Object.freeze(exitMarkers),
        spawnPoint: Object.freeze({ x: 12, y: 9 }),
        connectionsByExitId: Object.freeze({
            'grotto-mouth': Object.freeze({
                levelId: 'the-grotto::grotto-01',
                exitId: 'meadow-light',
                exitIndex: 0,
                arrivalDirection: 'south',
            }),
        }),
        generationConfig: Object.freeze({
            generator: 'static-clearing',
            worldSeed: options.worldSeed ?? THE_MEADOWS_DEFAULT_WORLD_SEED,
            gridX: coord.x,
            gridY: coord.y,
        }),
    });

    return {
        stage,
        coord,
        kind: 'static-landmark',
        landmarkId: 'a-clearing',
        seed: null,
        gridX: coord.x,
        gridY: coord.y,
    };
}

function createMeadowStage(coord, options = {}) {
    if (isClearingCoord(coord.x, coord.y)) return createClearingStage(coord, options);

    const worldSeed = options.worldSeed ?? THE_MEADOWS_DEFAULT_WORLD_SEED;
    const rng = createRng(`${worldSeed}:${THE_MEADOWS_ZONE_ID}:${coord.x},${coord.y}`);
    const width = intRange(rng, 52, 68);
    const height = intRange(rng, 38, 52);
    const exitSides = getExitSidesForCoord(coord.x, coord.y);
    const exitMarkers = Object.fromEntries(exitSides.map((side) => {
        const sideIndex = SIDE_ORDER.indexOf(side);
        return [SIDE_MARKERS[side], Object.freeze({
            id: exitIdForSide(side),
            exitIndex: sideIndex,
            connectionRole: side,
            arrival: Object.freeze(arrivalForSide(side, width, height)),
        })];
    }));

    const stage = createAuthoredStageDefinition({
        id: stageIdForCoord(coord.x, coord.y),
        stageSlug: stageIdForCoord(coord.x, coord.y),
        displayName: displayNameForCoord(coord.x, coord.y),
        zoneId: THE_MEADOWS_ZONE_ID,
        tags: Object.freeze(['outdoor', 'field', 'meadow', 'generated']),
        floorTile: 'floor_dirt',
        map: buildMeadowAscii({ width, height, exitSides, rng }),
        exitMarkers: Object.freeze(exitMarkers),
        spawnPoint: Object.freeze({ x: Math.floor(width / 2), y: Math.floor(height / 2) }),
        generationConfig: Object.freeze({
            generator: 'meadow-grid',
            worldSeed,
            gridX: coord.x,
            gridY: coord.y,
        }),
    });

    return {
        stage,
        coord,
        kind: 'generated',
        seed: `${worldSeed}:${THE_MEADOWS_ZONE_ID}:${coord.x},${coord.y}`,
        gridX: coord.x,
        gridY: coord.y,
    };
}

function makeConnection(targetStage, targetExit, arrivalDirection) {
    return Object.freeze({
        levelId: targetStage.id,
        exitId: targetExit.id,
        exitIndex: targetExit.exitIndex,
        arrivalDirection,
    });
}

function arrivalDirectionForTargetSide(side) {
    return OPPOSITE_SIDE[side] ?? null;
}

function getExitForSide(stage, side) {
    return stage.exits.find((exit) => exit.id === exitIdForSide(side)) ?? null;
}

function withConnections(stage, connectionsByExitId) {
    return Object.freeze({
        ...stage,
        connectionsByExitId: Object.freeze(connectionsByExitId),
    });
}

export function buildTheMeadowsStageEntries(options = {}) {
    const entries = getStageCoords().map((coord) => createMeadowStage(coord, options));
    const entryByCoord = new Map(entries.map((entry) => [coordKey(entry.coord.x, entry.coord.y), entry]));
    const compiledEntries = entries.map((entry) => {
        const connectionsByExitId = { ...(entry.stage.connectionsByExitId ?? {}) };
        for (const side of getExitSidesForCoord(entry.coord.x, entry.coord.y)) {
            const sourceExit = getExitForSide(entry.stage, side);
            if (!sourceExit) continue;

            if (side === 'west' && isEntryCoord(entry.coord.x, entry.coord.y)) {
                connectionsByExitId[sourceExit.id] = Object.freeze({
                    levelId: 'town-square',
                    exitId: 'east-road',
                    exitIndex: 3,
                    arrivalDirection: 'west',
                });
                continue;
            }

            const vector = SIDE_VECTORS[side];
            const neighbor = entryByCoord.get(coordKey(entry.coord.x + vector.dx, entry.coord.y + vector.dy));
            if (!neighbor) continue;
            const targetSide = OPPOSITE_SIDE[side];
            const targetExit = getExitForSide(neighbor.stage, targetSide);
            connectionsByExitId[sourceExit.id] = makeConnection(neighbor.stage, targetExit, arrivalDirectionForTargetSide(targetSide));
        }

        return {
            ...entry,
            stage: withConnections(entry.stage, connectionsByExitId),
        };
    });

    return compiledEntries;
}

export function buildTheMeadowsStages(options = {}) {
    return buildTheMeadowsStageEntries(options).map((entry) => entry.stage);
}

export function getTheMeadowsStageIds(options = {}) {
    return getStageCoords().map((coord) => stageIdForCoord(coord.x, coord.y));
}

export function getTheMeadowsEntryStageId() {
    return stageIdForCoord(ENTRY_COORD.x, ENTRY_COORD.y);
}
