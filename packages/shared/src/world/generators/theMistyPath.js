import { createAuthoredStageDefinition } from '../authoredStage.js';
import { createRng, intRange } from './rng.js';

export const THE_MISTY_PATH_ZONE_ID = 'the-misty-path';
export const THE_MISTY_PATH_DEFAULT_WORLD_SEED = 'misty-path-map-01';
export const THE_MISTY_PATH_ENTRY_STAGE_ID = `${THE_MISTY_PATH_ZONE_ID}::path-01`;

const SIDE_ORDER = Object.freeze(['north', 'east', 'south', 'west']);
const SIDE_MARKERS = Object.freeze({
    north: 'A',
    east: 'B',
    south: 'C',
    west: 'D',
});
const OPPOSITE_SIDE = Object.freeze({
    north: 'south',
    east: 'west',
    south: 'north',
    west: 'east',
});

const NODES = Object.freeze([
    Object.freeze({ slot: 1, x: 1, y: 0, title: 'North Fork' }),
    Object.freeze({ slot: 2, x: 0, y: 1, title: 'Left-Hand Drift' }),
    Object.freeze({ slot: 3, x: 1, y: 1, title: 'Middle Haze' }),
    Object.freeze({ slot: 4, x: 2, y: 1, title: 'Right-Hand Drift' }),
    Object.freeze({ slot: 5, x: 0, y: 2, title: 'Briar Turn' }),
    Object.freeze({ slot: 6, x: 1, y: 2, title: 'Wet Crossing' }),
    Object.freeze({ slot: 7, x: 2, y: 2, title: 'Willow Bend' }),
    Object.freeze({ slot: 8, x: 0, y: 3, title: 'Low Hollow' }),
    Object.freeze({ slot: 9, x: 1, y: 3, title: 'Pale Switchback' }),
    Object.freeze({ slot: 10, x: 2, y: 3, title: 'Broken Verge' }),
    Object.freeze({ slot: 11, x: 0, y: 4, title: 'Southwest Thread' }),
    Object.freeze({ slot: 12, x: 1, y: 4, title: 'Damp Rise' }),
    Object.freeze({ slot: 13, x: 2, y: 4, title: 'Southeast Thread' }),
    Object.freeze({ slot: 14, x: 1, y: 5, title: 'South Convergence' }),
]);

const EDGES = Object.freeze([
    Object.freeze({ from: 1, fromSide: 'west', to: 2, toSide: 'north' }),
    Object.freeze({ from: 1, fromSide: 'south', to: 3, toSide: 'north' }),
    Object.freeze({ from: 1, fromSide: 'east', to: 4, toSide: 'north' }),
    Object.freeze({ from: 2, fromSide: 'south', to: 5, toSide: 'north' }),
    Object.freeze({ from: 3, fromSide: 'south', to: 6, toSide: 'north' }),
    Object.freeze({ from: 4, fromSide: 'south', to: 7, toSide: 'north' }),
    Object.freeze({ from: 5, fromSide: 'south', to: 8, toSide: 'north' }),
    Object.freeze({ from: 6, fromSide: 'south', to: 9, toSide: 'north' }),
    Object.freeze({ from: 7, fromSide: 'south', to: 10, toSide: 'north' }),
    Object.freeze({ from: 8, fromSide: 'south', to: 11, toSide: 'north' }),
    Object.freeze({ from: 9, fromSide: 'south', to: 12, toSide: 'north' }),
    Object.freeze({ from: 10, fromSide: 'south', to: 13, toSide: 'north' }),
    Object.freeze({ from: 11, fromSide: 'south', to: 14, toSide: 'west' }),
    Object.freeze({ from: 12, fromSide: 'south', to: 14, toSide: 'north' }),
    Object.freeze({ from: 13, fromSide: 'south', to: 14, toSide: 'east' }),
    Object.freeze({ from: 5, fromSide: 'east', to: 6, toSide: 'west' }),
    Object.freeze({ from: 6, fromSide: 'east', to: 7, toSide: 'west' }),
    Object.freeze({ from: 8, fromSide: 'east', to: 9, toSide: 'west' }),
    Object.freeze({ from: 9, fromSide: 'east', to: 10, toSide: 'west' }),
]);

function padSlot(slot) {
    return String(slot).padStart(2, '0');
}

function stageIdForSlot(slot) {
    return `${THE_MISTY_PATH_ZONE_ID}::path-${padSlot(slot)}`;
}

function displayNameForNode(node) {
    return `The Misty Path ${padSlot(node.slot)}: ${node.title}`;
}

function nodeKey(node) {
    return `${node.x},${node.y}`;
}

function exitIdForSide(side) {
    return side === 'north' ? 'north-trail'
        : side === 'east' ? 'east-trail'
            : side === 'south' ? 'south-trail'
                : 'west-trail';
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

function carveDisk(grid, cx, cy, rx, ry, char = '.') {
    const height = grid.length;
    const width = grid[0].length;
    for (let y = Math.max(1, cy - ry); y <= Math.min(height - 2, cy + ry); y++) {
        for (let x = Math.max(1, cx - rx); x <= Math.min(width - 2, cx + rx); x++) {
            const nx = (x - cx) / Math.max(1, rx);
            const ny = (y - cy) / Math.max(1, ry);
            if ((nx * nx) + (ny * ny) <= 1.08) grid[y][x] = char;
        }
    }
}

function carveStep(grid, x, y, radius) {
    const height = grid.length;
    const width = grid[0].length;
    for (let yy = y - radius; yy <= y + radius; yy++) {
        for (let xx = x - radius; xx <= x + radius; xx++) {
            if (xx <= 0 || xx >= width - 1 || yy <= 0 || yy >= height - 1) continue;
            grid[yy][xx] = '.';
        }
    }
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function carveWindingTrail(grid, rng, from, to) {
    let x = from.x;
    let y = from.y;
    const height = grid.length;
    const width = grid[0].length;
    const radius = rng() < 0.36 ? 2 : 1;
    const waypointCount = intRange(rng, 2, 4);
    const waypoints = [];
    for (let i = 1; i <= waypointCount; i++) {
        const t = i / (waypointCount + 1);
        const baseX = Math.round(from.x + (to.x - from.x) * t);
        const baseY = Math.round(from.y + (to.y - from.y) * t);
        waypoints.push({
            x: clamp(baseX + intRange(rng, -5, 5), 2, width - 3),
            y: clamp(baseY + intRange(rng, -4, 4), 2, height - 3),
        });
    }
    waypoints.push(to);

    for (const point of waypoints) {
        while (x !== point.x || y !== point.y) {
            carveStep(grid, x, y, radius);
            const moveHorizontal = x !== point.x && (y === point.y || rng() < 0.55);
            if (moveHorizontal) {
                x += x < point.x ? 1 : -1;
                if (rng() < 0.22 && y > 2 && y < height - 3) y += rng() < 0.5 ? -1 : 1;
            } else if (y !== point.y) {
                y += y < point.y ? 1 : -1;
                if (rng() < 0.22 && x > 2 && x < width - 3) x += rng() < 0.5 ? -1 : 1;
            }
        }
    }
    carveStep(grid, to.x, to.y, radius);
}

function addMistPathFeatures(grid, rng) {
    const height = grid.length;
    const width = grid[0].length;
    for (let i = 0; i < intRange(rng, 4, 9); i++) {
        const cx = intRange(rng, 3, width - 4);
        const cy = intRange(rng, 3, height - 4);
        if (grid[cy][cx] !== '.') continue;
        carveDisk(grid, cx, cy, intRange(rng, 2, 5), intRange(rng, 1, 3), rng() < 0.72 ? ',' : '.');
    }
    for (let i = 0; i < intRange(rng, 1, 3); i++) {
        const cx = intRange(rng, 4, width - 5);
        const cy = intRange(rng, 4, height - 5);
        if (grid[cy][cx] !== '.') continue;
        carveDisk(grid, cx, cy, intRange(rng, 1, 3), intRange(rng, 1, 2), '~');
    }
}

function buildMistyPathAscii({ width, height, sides, rng }) {
    const grid = Array.from({ length: height }, () => Array.from({ length: width }, () => '^'));
    const center = { x: Math.floor(width / 2), y: Math.floor(height / 2) };
    carveDisk(grid, center.x, center.y, intRange(rng, 2, 5), intRange(rng, 2, 4), '.');

    for (const side of sides) {
        const arrival = arrivalForSide(side, width, height);
        carveWindingTrail(grid, rng, center, arrival);
        const exit = exitPositionForSide(side, width, height);
        grid[exit.y][exit.x] = SIDE_MARKERS[side];
        grid[arrival.y][arrival.x] = '.';
    }

    addMistPathFeatures(grid, rng);
    grid[center.y][center.x] = '.';
    return grid.map((row) => row.join('')).join('\n');
}

function buildSidesBySlot() {
    const sidesBySlot = new Map(NODES.map((node) => [node.slot, []]));
    sidesBySlot.get(1).push('north');
    for (const edge of EDGES) {
        sidesBySlot.get(edge.from).push(edge.fromSide);
        sidesBySlot.get(edge.to).push(edge.toSide);
    }
    for (const sides of sidesBySlot.values()) {
        sides.sort((a, b) => SIDE_ORDER.indexOf(a) - SIDE_ORDER.indexOf(b));
    }
    return sidesBySlot;
}

function createMistyPathStage(node, options = {}) {
    const worldSeed = options.worldSeed ?? THE_MISTY_PATH_DEFAULT_WORLD_SEED;
    const rng = createRng(`${worldSeed}:${THE_MISTY_PATH_ZONE_ID}:${padSlot(node.slot)}:${nodeKey(node)}`);
    const width = intRange(rng, 25, 49);
    const height = intRange(rng, 17, 33);
    const sides = buildSidesBySlot().get(node.slot);
    const exitMarkers = Object.fromEntries(sides.map((side) => {
        const sideIndex = SIDE_ORDER.indexOf(side);
        const id = node.slot === 1 && side === 'north' ? 'lunavik-road' : exitIdForSide(side);
        return [SIDE_MARKERS[side], Object.freeze({
            id,
            exitIndex: sideIndex,
            connectionRole: side,
            arrival: Object.freeze(arrivalForSide(side, width, height)),
        })];
    }));

    const stage = createAuthoredStageDefinition({
        id: stageIdForSlot(node.slot),
        stageSlug: stageIdForSlot(node.slot),
        displayName: displayNameForNode(node),
        zoneId: THE_MISTY_PATH_ZONE_ID,
        tags: Object.freeze(['outdoor', 'trail', 'misty-path', 'generated']),
        floorTile: 'floor_dirt',
        map: buildMistyPathAscii({ width, height, sides, rng }),
        exitMarkers: Object.freeze(exitMarkers),
        spawnPoint: Object.freeze({ x: Math.floor(width / 2), y: Math.floor(height / 2) }),
        generationConfig: Object.freeze({
            generator: 'misty-path-branching-corridors',
            worldSeed,
            gridX: node.x,
            gridY: node.y,
        }),
    });

    return {
        stage,
        node,
        kind: 'generated',
        seed: `${worldSeed}:${THE_MISTY_PATH_ZONE_ID}:${padSlot(node.slot)}:${nodeKey(node)}`,
        gridX: node.x,
        gridY: node.y,
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

function getExitForSide(stage, side) {
    return stage.exits.find((exit) => exit.id === exitIdForSide(side)) ?? null;
}

function withConnections(stage, connectionsByExitId) {
    return Object.freeze({
        ...stage,
        connectionsByExitId: Object.freeze(connectionsByExitId),
    });
}

export function buildTheMistyPathStageEntries(options = {}) {
    const entries = NODES.map((node) => createMistyPathStage(node, options));
    const entryBySlot = new Map(entries.map((entry) => [entry.node.slot, entry]));

    return entries.map((entry) => {
        const connectionsByExitId = { ...(entry.stage.connectionsByExitId ?? {}) };
        if (entry.node.slot === 1) {
            connectionsByExitId['lunavik-road'] = Object.freeze({
                levelId: 'lunavik-south',
                exitId: 'south-road',
                exitIndex: 1,
                arrivalDirection: 'south',
            });
        }

        for (const edge of EDGES) {
            if (edge.from !== entry.node.slot && edge.to !== entry.node.slot) continue;
            const isFrom = edge.from === entry.node.slot;
            const sourceSide = isFrom ? edge.fromSide : edge.toSide;
            const targetSide = isFrom ? edge.toSide : edge.fromSide;
            const targetEntry = entryBySlot.get(isFrom ? edge.to : edge.from);
            const sourceExit = getExitForSide(entry.stage, sourceSide);
            const targetExit = getExitForSide(targetEntry.stage, targetSide);
            connectionsByExitId[sourceExit.id] = makeConnection(targetEntry.stage, targetExit, OPPOSITE_SIDE[targetSide]);
        }

        return {
            ...entry,
            stage: withConnections(entry.stage, connectionsByExitId),
        };
    });
}

export function buildTheMistyPathStages(options = {}) {
    return buildTheMistyPathStageEntries(options).map((entry) => entry.stage);
}

export function getTheMistyPathStageIds() {
    return NODES.map((node) => stageIdForSlot(node.slot));
}

export function getTheMistyPathEntryStageId() {
    return THE_MISTY_PATH_ENTRY_STAGE_ID;
}
