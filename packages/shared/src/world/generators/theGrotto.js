import { createAuthoredStageDefinition } from '../authoredStage.js';
import { A_CLEARING_STAGE_ID } from './theMeadows.js';
import { createRng, intRange } from './rng.js';

export const THE_GROTTO_ZONE_ID = 'the-grotto';
export const THE_GROTTO_DEFAULT_WORLD_SEED = 'grotto-map-01';
export const THE_GROTTO_ENTRY_STAGE_ID = `${THE_GROTTO_ZONE_ID}::grotto-01`;

const WIDTH = 27;
const HEIGHT = 19;
const CENTER = Object.freeze({ x: Math.floor(WIDTH / 2), y: Math.floor(HEIGHT / 2) });
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

const NODES = Object.freeze([
    Object.freeze({ slot: 1, x: 0, y: 0, title: 'Mouth' }),
    Object.freeze({ slot: 2, x: 1, y: 0, title: 'Low Crawl' }),
    Object.freeze({ slot: 3, x: 1, y: 1, title: 'Wet Bend' }),
    Object.freeze({ slot: 4, x: 2, y: 1, title: 'Split Vein' }),
    Object.freeze({ slot: 5, x: 2, y: 2, title: 'Slick Descent' }),
    Object.freeze({ slot: 6, x: 1, y: 2, title: 'Echo Pocket' }),
    Object.freeze({ slot: 7, x: 1, y: 3, title: 'Root Snarl' }),
    Object.freeze({ slot: 8, x: 0, y: 3, title: 'Black Loam' }),
    Object.freeze({ slot: 9, x: 0, y: 4, title: 'Still Pool' }),
    Object.freeze({ slot: 10, x: 1, y: 4, title: 'Deep Turn' }),
]);

const EDGES = Object.freeze([
    Object.freeze([1, 2]),
    Object.freeze([2, 3]),
    Object.freeze([3, 4]),
    Object.freeze([4, 5]),
    Object.freeze([5, 6]),
    Object.freeze([6, 7]),
    Object.freeze([7, 8]),
    Object.freeze([8, 9]),
    Object.freeze([9, 10]),
    Object.freeze([3, 6]),
    Object.freeze([7, 10]),
]);

function padSlot(slot) {
    return String(slot).padStart(2, '0');
}

function stageIdForSlot(slot) {
    return `${THE_GROTTO_ZONE_ID}::grotto-${padSlot(slot)}`;
}

function displayNameForNode(node) {
    return `The Grotto ${padSlot(node.slot)}: ${node.title}`;
}

function nodeKey(node) {
    return `${node.x},${node.y}`;
}

function sideBetween(a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    if (dx === 1 && dy === 0) return 'east';
    if (dx === -1 && dy === 0) return 'west';
    if (dx === 0 && dy === 1) return 'south';
    if (dx === 0 && dy === -1) return 'north';
    throw new Error(`Grotto nodes ${a.slot} and ${b.slot} are not cardinal neighbors`);
}

function exitIdForSide(side) {
    return side === 'north' ? 'north-tunnel'
        : side === 'east' ? 'east-tunnel'
            : side === 'south' ? 'south-tunnel'
                : 'west-tunnel';
}

function exitPositionForSide(side) {
    switch (side) {
        case 'north': return { x: Math.floor(WIDTH / 2), y: 0 };
        case 'east': return { x: WIDTH - 1, y: Math.floor(HEIGHT / 2) };
        case 'south': return { x: Math.floor(WIDTH / 2), y: HEIGHT - 1 };
        case 'west': return { x: 0, y: Math.floor(HEIGHT / 2) };
        default: return { ...CENTER };
    }
}

function arrivalForSide(side) {
    const position = exitPositionForSide(side);
    switch (side) {
        case 'north': return { x: position.x, y: 1, facing: 'south' };
        case 'east': return { x: WIDTH - 2, y: position.y, facing: 'west' };
        case 'south': return { x: position.x, y: HEIGHT - 2, facing: 'north' };
        case 'west': return { x: 1, y: position.y, facing: 'east' };
        default: return { ...CENTER, facing: null };
    }
}

function carveDisk(grid, cx, cy, rx, ry, char = '.') {
    for (let y = Math.max(1, cy - ry); y <= Math.min(HEIGHT - 2, cy + ry); y++) {
        for (let x = Math.max(1, cx - rx); x <= Math.min(WIDTH - 2, cx + rx); x++) {
            const nx = (x - cx) / Math.max(1, rx);
            const ny = (y - cy) / Math.max(1, ry);
            if ((nx * nx) + (ny * ny) <= 1.05) grid[y][x] = char;
        }
    }
}

function carveStep(grid, x, y, radius) {
    for (let yy = y - radius; yy <= y + radius; yy++) {
        for (let xx = x - radius; xx <= x + radius; xx++) {
            if (xx <= 0 || xx >= WIDTH - 1 || yy <= 0 || yy >= HEIGHT - 1) continue;
            grid[yy][xx] = '.';
        }
    }
}

function carveWindingTunnel(grid, rng, from, to) {
    let x = from.x;
    let y = from.y;
    const radius = rng() < 0.24 ? 2 : 1;
    const horizontalFirst = rng() < 0.5;
    const mid = horizontalFirst
        ? { x: to.x + intRange(rng, -2, 2), y: from.y + intRange(rng, -3, 3) }
        : { x: from.x + intRange(rng, -3, 3), y: to.y + intRange(rng, -2, 2) };
    const waypoints = [
        {
            x: Math.max(2, Math.min(WIDTH - 3, mid.x)),
            y: Math.max(2, Math.min(HEIGHT - 3, mid.y)),
        },
        to,
    ];

    for (const point of waypoints) {
        while (x !== point.x) {
            carveStep(grid, x, y, radius);
            x += x < point.x ? 1 : -1;
            if (rng() < 0.28 && y > 2 && y < HEIGHT - 3) y += rng() < 0.5 ? -1 : 1;
        }
        while (y !== point.y) {
            carveStep(grid, x, y, radius);
            y += y < point.y ? 1 : -1;
            if (rng() < 0.28 && x > 2 && x < WIDTH - 3) x += rng() < 0.5 ? -1 : 1;
        }
    }
    carveStep(grid, to.x, to.y, radius);
}

function addSmallFeatures(grid, rng) {
    for (let i = 0; i < intRange(rng, 1, 3); i++) {
        const cx = intRange(rng, 5, WIDTH - 6);
        const cy = intRange(rng, 4, HEIGHT - 5);
        if (grid[cy][cx] !== '.') continue;
        carveDisk(grid, cx, cy, intRange(rng, 2, 3), intRange(rng, 1, 2), '.');
    }
    for (let i = 0; i < intRange(rng, 1, 2); i++) {
        const cx = intRange(rng, 5, WIDTH - 6);
        const cy = intRange(rng, 4, HEIGHT - 5);
        if (grid[cy][cx] !== '.') continue;
        carveDisk(grid, cx, cy, 1, 1, '~');
    }
}

function buildGrottoAscii({ sides, rng }) {
    const grid = Array.from({ length: HEIGHT }, () => Array.from({ length: WIDTH }, () => '#'));
    carveDisk(grid, CENTER.x, CENTER.y, 2, 2, '.');

    for (const side of sides) {
        const arrival = arrivalForSide(side);
        carveWindingTunnel(grid, rng, CENTER, arrival);
        const exit = exitPositionForSide(side);
        const marker = SIDE_MARKERS[side];
        grid[exit.y][exit.x] = marker;
        grid[arrival.y][arrival.x] = '.';
    }

    addSmallFeatures(grid, rng);
    grid[CENTER.y][CENTER.x] = '.';
    return grid.map((row) => row.join('')).join('\n');
}

function makeConnection(targetStage, targetExit, arrivalDirection) {
    return Object.freeze({
        levelId: targetStage.id,
        exitId: targetExit.id,
        exitIndex: targetExit.exitIndex,
        arrivalDirection,
    });
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

function buildNeighborSidesBySlot() {
    const nodeBySlot = new Map(NODES.map((node) => [node.slot, node]));
    const sidesBySlot = new Map(NODES.map((node) => [node.slot, []]));
    for (const [fromSlot, toSlot] of EDGES) {
        const from = nodeBySlot.get(fromSlot);
        const to = nodeBySlot.get(toSlot);
        sidesBySlot.get(fromSlot).push(sideBetween(from, to));
        sidesBySlot.get(toSlot).push(sideBetween(to, from));
    }
    sidesBySlot.get(1).push('north');
    for (const sides of sidesBySlot.values()) {
        sides.sort((a, b) => SIDE_ORDER.indexOf(a) - SIDE_ORDER.indexOf(b));
    }
    return sidesBySlot;
}

function createGrottoStage(node, options = {}) {
    const worldSeed = options.worldSeed ?? THE_GROTTO_DEFAULT_WORLD_SEED;
    const sidesBySlot = buildNeighborSidesBySlot();
    const sides = sidesBySlot.get(node.slot);
    const rng = createRng(`${worldSeed}:${THE_GROTTO_ZONE_ID}:${padSlot(node.slot)}:${nodeKey(node)}`);
    const exitMarkers = Object.fromEntries(sides.map((side) => {
        const sideIndex = SIDE_ORDER.indexOf(side);
        const id = node.slot === 1 && side === 'north' ? 'meadow-light' : exitIdForSide(side);
        return [SIDE_MARKERS[side], Object.freeze({
            id,
            exitIndex: sideIndex,
            connectionRole: side,
            arrival: Object.freeze(arrivalForSide(side)),
        })];
    }));

    const stage = createAuthoredStageDefinition({
        id: stageIdForSlot(node.slot),
        stageSlug: stageIdForSlot(node.slot),
        displayName: displayNameForNode(node),
        zoneId: THE_GROTTO_ZONE_ID,
        tags: Object.freeze(['cave', 'grotto', 'generated']),
        floorTile: 'floor_dirt',
        map: buildGrottoAscii({ sides, rng }),
        exitMarkers: Object.freeze(exitMarkers),
        spawnPoint: Object.freeze({ ...CENTER }),
        generationConfig: Object.freeze({
            generator: 'grotto-winding-corridors',
            worldSeed,
            gridX: node.x,
            gridY: node.y,
        }),
    });

    return {
        stage,
        node,
        kind: 'generated',
        seed: `${worldSeed}:${THE_GROTTO_ZONE_ID}:${padSlot(node.slot)}:${nodeKey(node)}`,
        gridX: node.x,
        gridY: node.y,
    };
}

export function buildTheGrottoStageEntries(options = {}) {
    const entries = NODES.map((node) => createGrottoStage(node, options));
    const entryBySlot = new Map(entries.map((entry) => [entry.node.slot, entry]));

    return entries.map((entry) => {
        const connectionsByExitId = { ...(entry.stage.connectionsByExitId ?? {}) };
        if (entry.node.slot === 1) {
            connectionsByExitId['meadow-light'] = Object.freeze({
                levelId: A_CLEARING_STAGE_ID,
                exitId: 'grotto-mouth',
                exitIndex: 4,
                arrivalDirection: 'south',
            });
        }

        for (const [fromSlot, toSlot] of EDGES) {
            const isFrom = fromSlot === entry.node.slot;
            const isTo = toSlot === entry.node.slot;
            if (!isFrom && !isTo) continue;

            const sourceEntry = entry;
            const targetEntry = entryBySlot.get(isFrom ? toSlot : fromSlot);
            const sourceSide = sideBetween(sourceEntry.node, targetEntry.node);
            const targetSide = OPPOSITE_SIDE[sourceSide];
            const sourceExit = getExitForSide(sourceEntry.stage, sourceSide);
            const targetExit = getExitForSide(targetEntry.stage, targetSide);
            connectionsByExitId[sourceExit.id] = makeConnection(targetEntry.stage, targetExit, sourceSide);
        }

        return {
            ...entry,
            stage: withConnections(entry.stage, connectionsByExitId),
        };
    });
}

export function buildTheGrottoStages(options = {}) {
    return buildTheGrottoStageEntries(options).map((entry) => entry.stage);
}

export function getTheGrottoStageIds() {
    return NODES.map((node) => stageIdForSlot(node.slot));
}

export function getTheGrottoEntryStageId() {
    return THE_GROTTO_ENTRY_STAGE_ID;
}
