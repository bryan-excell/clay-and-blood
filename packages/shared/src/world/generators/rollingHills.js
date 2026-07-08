import { createAuthoredStageDefinition } from '../authoredStage.js';
import { createRng, intRange } from './rng.js';

export const ROLLING_HILLS_ZONE_ID = 'rolling-hills';
export const ROLLING_HILLS_DEFAULT_WORLD_SEED = 'rolling-hills-map-01';
export const ROLLING_HILLS_ENTRY_STAGE_ID = `${ROLLING_HILLS_ZONE_ID}::hill-01`;

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
    Object.freeze({ slot: 1, x: 0, y: 1, title: 'East Fold' }),
    Object.freeze({ slot: 2, x: 1, y: 1, title: 'First Rise' }),
    Object.freeze({ slot: 3, x: 2, y: 0, title: 'North Shoulder' }),
    Object.freeze({ slot: 4, x: 2, y: 2, title: 'South Shoulder' }),
    Object.freeze({ slot: 5, x: 3, y: 0, title: 'High Grass' }),
    Object.freeze({ slot: 6, x: 3, y: 2, title: 'Low Pasture' }),
    Object.freeze({ slot: 7, x: 4, y: 1, title: 'Twin Slopes' }),
    Object.freeze({ slot: 8, x: 5, y: 1, title: 'Long Brow' }),
    Object.freeze({ slot: 9, x: 6, y: 0, title: 'Upper Crest' }),
    Object.freeze({ slot: 10, x: 6, y: 1, title: 'Middle Swale' }),
    Object.freeze({ slot: 11, x: 6, y: 2, title: 'Lower Drift' }),
    Object.freeze({ slot: 12, x: 7, y: 0, title: 'Wind Line' }),
    Object.freeze({ slot: 13, x: 7, y: 1, title: 'Soft Ground' }),
    Object.freeze({ slot: 14, x: 7, y: 2, title: 'Heather Dip' }),
    Object.freeze({ slot: 15, x: 8, y: 1, title: 'Gathering Green' }),
    Object.freeze({ slot: 16, x: 9, y: 1, title: 'Westward Run' }),
    Object.freeze({ slot: 17, x: 10, y: 0, title: 'Last High Road' }),
    Object.freeze({ slot: 18, x: 10, y: 2, title: 'Last Low Road' }),
    Object.freeze({ slot: 19, x: 11, y: 1, title: 'Final Fold' }),
    Object.freeze({ slot: 20, x: 12, y: 1, title: 'West End' }),
]);
const PREVIEW_MAX_GRID_X = Math.max(...NODES.map((node) => node.x));

const EDGES = Object.freeze([
    Object.freeze({ from: 1, fromSide: 'west', to: 2, toSide: 'east' }),
    Object.freeze({ from: 2, fromSide: 'north', to: 3, toSide: 'east' }),
    Object.freeze({ from: 2, fromSide: 'south', to: 4, toSide: 'east' }),
    Object.freeze({ from: 3, fromSide: 'west', to: 5, toSide: 'east' }),
    Object.freeze({ from: 4, fromSide: 'west', to: 6, toSide: 'east' }),
    Object.freeze({ from: 5, fromSide: 'west', to: 7, toSide: 'north' }),
    Object.freeze({ from: 6, fromSide: 'west', to: 7, toSide: 'south' }),
    Object.freeze({ from: 7, fromSide: 'west', to: 8, toSide: 'east' }),
    Object.freeze({ from: 8, fromSide: 'north', to: 9, toSide: 'east' }),
    Object.freeze({ from: 8, fromSide: 'west', to: 10, toSide: 'east' }),
    Object.freeze({ from: 8, fromSide: 'south', to: 11, toSide: 'east' }),
    Object.freeze({ from: 9, fromSide: 'west', to: 12, toSide: 'east' }),
    Object.freeze({ from: 10, fromSide: 'west', to: 13, toSide: 'east' }),
    Object.freeze({ from: 11, fromSide: 'west', to: 14, toSide: 'east' }),
    Object.freeze({ from: 12, fromSide: 'west', to: 15, toSide: 'north' }),
    Object.freeze({ from: 13, fromSide: 'west', to: 15, toSide: 'east' }),
    Object.freeze({ from: 14, fromSide: 'west', to: 15, toSide: 'south' }),
    Object.freeze({ from: 15, fromSide: 'west', to: 16, toSide: 'east' }),
    Object.freeze({ from: 16, fromSide: 'north', to: 17, toSide: 'east' }),
    Object.freeze({ from: 16, fromSide: 'south', to: 18, toSide: 'east' }),
    Object.freeze({ from: 17, fromSide: 'west', to: 19, toSide: 'north' }),
    Object.freeze({ from: 18, fromSide: 'west', to: 19, toSide: 'south' }),
    Object.freeze({ from: 19, fromSide: 'west', to: 20, toSide: 'east' }),
]);

function padSlot(slot) {
    return String(slot).padStart(2, '0');
}

function stageIdForSlot(slot) {
    return `${ROLLING_HILLS_ZONE_ID}::hill-${padSlot(slot)}`;
}

function displayNameForNode(node) {
    return `Rolling Hills ${padSlot(node.slot)}: ${node.title}`;
}

function nodeKey(node) {
    return `${node.x},${node.y}`;
}

function previewGridXForNode(node) {
    return PREVIEW_MAX_GRID_X - node.x;
}

function exitIdForSide(side, node) {
    if (node.slot === 1 && side === 'east') return 'lunavik-road';
    return `${side}-track`;
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

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function carveDisk(grid, cx, cy, rx, ry, char) {
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

function carveLine(grid, from, to, radius, char = '.') {
    let x = from.x;
    let y = from.y;
    while (x !== to.x || y !== to.y) {
        carveDisk(grid, x, y, radius, radius, char);
        const dx = to.x - x;
        const dy = to.y - y;
        if (Math.abs(dx) >= Math.abs(dy) && dx !== 0) x += Math.sign(dx);
        else if (dy !== 0) y += Math.sign(dy);
    }
    carveDisk(grid, to.x, to.y, radius, radius, char);
}

function smoothProfile(samples, passes = 2) {
    let profile = samples;
    for (let pass = 0; pass < passes; pass++) {
        profile = profile.map((value, index) => {
            const previous = profile[Math.max(0, index - 1)];
            const next = profile[Math.min(profile.length - 1, index + 1)];
            return (previous + value * 2 + next) / 4;
        });
    }
    return profile;
}

function buildHillProfile(width, height, rng) {
    const anchorCount = Math.max(5, Math.floor(width / 10));
    const anchors = [];
    const midpoint = Math.floor(height / 2);
    const amplitude = Math.max(3, Math.floor(height * (0.18 + rng() * 0.18)));
    for (let i = 0; i < anchorCount; i++) {
        const t = i / Math.max(1, anchorCount - 1);
        const wave = Math.sin((t * Math.PI * 2) + rng() * 0.7) * amplitude;
        anchors.push(midpoint + wave + intRange(rng, -2, 2));
    }

    const profile = [];
    for (let x = 0; x < width; x++) {
        const position = (x / Math.max(1, width - 1)) * (anchorCount - 1);
        const leftIndex = Math.floor(position);
        const rightIndex = Math.min(anchorCount - 1, leftIndex + 1);
        const t = position - leftIndex;
        const eased = t * t * (3 - 2 * t);
        profile.push(anchors[leftIndex] * (1 - eased) + anchors[rightIndex] * eased);
    }
    return smoothProfile(profile, 3).map((y) => clamp(Math.round(y), 3, height - 4));
}

function nearestProfilePoint(profile, from) {
    let best = { x: from.x, y: profile[clamp(from.x, 0, profile.length - 1)] };
    let bestDistance = Infinity;
    for (let x = 1; x < profile.length - 1; x++) {
        const dy = profile[x] - from.y;
        const dx = x - from.x;
        const distance = dx * dx + dy * dy;
        if (distance < bestDistance) {
            bestDistance = distance;
            best = { x, y: profile[x] };
        }
    }
    return best;
}

function buildRollingHillsAscii({ width, height, sides, rng }) {
    const grid = Array.from({ length: height }, () => Array.from({ length: width }, () => '^'));
    const profile = buildHillProfile(width, height, rng);
    const bandRadius = intRange(rng, 4, Math.max(5, Math.floor(height / 3)));

    for (let x = 1; x < width - 1; x++) {
        const centerY = profile[x];
        for (let y = Math.max(1, centerY - bandRadius); y <= Math.min(height - 2, centerY + bandRadius); y++) {
            const distance = Math.abs(y - centerY);
            grid[y][x] = distance <= 1 ? '.' : ',';
        }
    }

    for (let i = 0; i < intRange(rng, 2, 5); i++) {
        const cx = intRange(rng, 5, width - 6);
        const cy = clamp(profile[cx] + intRange(rng, -bandRadius + 1, bandRadius - 1), 3, height - 4);
        carveDisk(grid, cx, cy, intRange(rng, 4, 9), intRange(rng, 2, 4), rng() < 0.7 ? ',' : '.');
    }

    if (rng() < 0.42) {
        const cx = intRange(rng, Math.floor(width * 0.25), Math.floor(width * 0.75));
        const cy = clamp(profile[cx] + bandRadius - 1, 3, height - 4);
        carveDisk(grid, cx, cy, intRange(rng, 2, 5), 1, '~');
    }

    for (const side of sides) {
        const arrival = arrivalForSide(side, width, height);
        const target = nearestProfilePoint(profile, arrival);
        carveLine(grid, arrival, target, side === 'east' || side === 'west' ? 2 : 1, '.');
        const exit = exitPositionForSide(side, width, height);
        grid[exit.y][exit.x] = SIDE_MARKERS[side];
        grid[arrival.y][arrival.x] = '.';
    }

    return grid.map((row) => row.join('')).join('\n');
}

function buildSidesBySlot() {
    const sidesBySlot = new Map(NODES.map((node) => [node.slot, []]));
    sidesBySlot.get(1).push('east');
    for (const edge of EDGES) {
        sidesBySlot.get(edge.from).push(edge.fromSide);
        sidesBySlot.get(edge.to).push(edge.toSide);
    }
    for (const sides of sidesBySlot.values()) {
        sides.sort((a, b) => SIDE_ORDER.indexOf(a) - SIDE_ORDER.indexOf(b));
    }
    return sidesBySlot;
}

function createRollingHillsStage(node, options = {}) {
    const worldSeed = options.worldSeed ?? ROLLING_HILLS_DEFAULT_WORLD_SEED;
    const seed = `${worldSeed}:${ROLLING_HILLS_ZONE_ID}:${padSlot(node.slot)}:${nodeKey(node)}`;
    const rng = createRng(seed);
    const width = intRange(rng, 36, 84);
    const height = intRange(rng, 13, 29);
    const sides = buildSidesBySlot().get(node.slot);
    const exitMarkers = Object.fromEntries(sides.map((side) => {
        const sideIndex = SIDE_ORDER.indexOf(side);
        return [SIDE_MARKERS[side], Object.freeze({
            id: exitIdForSide(side, node),
            exitIndex: sideIndex,
            connectionRole: side,
            arrival: Object.freeze(arrivalForSide(side, width, height)),
        })];
    }));

    const stage = createAuthoredStageDefinition({
        id: stageIdForSlot(node.slot),
        stageSlug: stageIdForSlot(node.slot),
        displayName: displayNameForNode(node),
        zoneId: ROLLING_HILLS_ZONE_ID,
        tags: Object.freeze(['outdoor', 'hills', 'road', 'generated']),
        floorTile: 'floor_dirt',
        map: buildRollingHillsAscii({ width, height, sides, rng }),
        exitMarkers: Object.freeze(exitMarkers),
        spawnPoint: Object.freeze({ x: Math.floor(width / 2), y: Math.floor(height / 2) }),
        generationConfig: Object.freeze({
            generator: 'rolling-hills-heightfield-braid',
            worldSeed,
            gridX: previewGridXForNode(node),
            gridY: node.y,
        }),
    });

    return {
        stage,
        node,
        kind: 'generated',
        seed,
        gridX: previewGridXForNode(node),
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

function getExitForSide(stage, side, node) {
    return stage.exits.find((exit) => exit.id === exitIdForSide(side, node)) ?? null;
}

function withConnections(stage, connectionsByExitId) {
    return Object.freeze({
        ...stage,
        connectionsByExitId: Object.freeze(connectionsByExitId),
    });
}

export function buildRollingHillsStageEntries(options = {}) {
    const entries = NODES.map((node) => createRollingHillsStage(node, options));
    const entryBySlot = new Map(entries.map((entry) => [entry.node.slot, entry]));

    return entries.map((entry) => {
        const connectionsByExitId = { ...(entry.stage.connectionsByExitId ?? {}) };
        if (entry.node.slot === 1) {
            connectionsByExitId['lunavik-road'] = Object.freeze({
                levelId: 'lunavik-west',
                exitId: 'west-road',
                exitIndex: 0,
                arrivalDirection: 'east',
            });
        }

        for (const edge of EDGES) {
            if (edge.from !== entry.node.slot && edge.to !== entry.node.slot) continue;
            const isFrom = edge.from === entry.node.slot;
            const sourceSide = isFrom ? edge.fromSide : edge.toSide;
            const targetSide = isFrom ? edge.toSide : edge.fromSide;
            const targetEntry = entryBySlot.get(isFrom ? edge.to : edge.from);
            const sourceExit = getExitForSide(entry.stage, sourceSide, entry.node);
            const targetExit = getExitForSide(targetEntry.stage, targetSide, targetEntry.node);
            connectionsByExitId[sourceExit.id] = makeConnection(targetEntry.stage, targetExit, OPPOSITE_SIDE[targetSide]);
        }

        return {
            ...entry,
            stage: withConnections(entry.stage, connectionsByExitId),
        };
    });
}

export function buildRollingHillsStages(options = {}) {
    return buildRollingHillsStageEntries(options).map((entry) => entry.stage);
}

export function getRollingHillsStageIds() {
    return NODES.map((node) => stageIdForSlot(node.slot));
}

export function getRollingHillsEntryStageId() {
    return ROLLING_HILLS_ENTRY_STAGE_ID;
}
