import { createAuthoredStageDefinition } from '../../../../packages/shared/src/index.js';
import { choice, createRng, intRange } from '../rng.mjs';
import { makeCharGrid, serializeCharGrid } from '../asciiMap.mjs';

const SIDE_CONFIG = Object.freeze({
    north: Object.freeze({ arrivalDy: 1, facing: 'south' }),
    south: Object.freeze({ arrivalDy: -1, facing: 'north' }),
    west: Object.freeze({ arrivalDx: 1, facing: 'east' }),
    east: Object.freeze({ arrivalDx: -1, facing: 'west' }),
});

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function inBounds(width, height, x, y) {
    return x >= 0 && x < width && y >= 0 && y < height;
}

function carveDisc(grid, cx, cy, radius, char = '.') {
    const height = grid.length;
    const width = grid[0].length;
    for (let y = cy - radius; y <= cy + radius; y++) {
        for (let x = cx - radius; x <= cx + radius; x++) {
            if (!inBounds(width, height, x, y)) continue;
            const dx = x - cx;
            const dy = y - cy;
            if (dx * dx + dy * dy <= radius * radius) grid[y][x] = char;
        }
    }
}

function chooseExitPoint(rng, width, height, side) {
    if (side === 'north') return { x: intRange(rng, 3, width - 4), y: 0 };
    if (side === 'south') return { x: intRange(rng, 3, width - 4), y: height - 1 };
    if (side === 'west') return { x: 0, y: intRange(rng, 3, height - 4) };
    if (side === 'east') return { x: width - 1, y: intRange(rng, 3, height - 4) };
    throw new Error(`Unknown exit side ${side}`);
}

function makePath(rng, width, height, start, end, options) {
    const points = [{ x: start.x, y: start.y }];
    let x = start.x;
    let y = start.y;
    const maxSteps = width * height * 4;
    const wander = options.wander ?? 0.35;

    for (let step = 0; step < maxSteps && (x !== end.x || y !== end.y); step++) {
        const dx = Math.sign(end.x - x);
        const dy = Math.sign(end.y - y);
        const toward = [];
        if (dx !== 0) toward.push({ dx, dy: 0 });
        if (dy !== 0) toward.push({ dx: 0, dy });
        const sideways = [
            { dx: dx === 0 ? 1 : 0, dy: dy === 0 ? 1 : 0 },
            { dx: dx === 0 ? -1 : 0, dy: dy === 0 ? -1 : 0 },
        ].filter((move) => move.dx !== 0 || move.dy !== 0);
        const move = rng() < wander ? choice(rng, sideways) : choice(rng, toward);
        x = clamp(x + (move?.dx ?? 0), 1, width - 2);
        y = clamp(y + (move?.dy ?? 0), 1, height - 2);
        if (Math.abs(end.x - x) + Math.abs(end.y - y) < 2) {
            x = end.x;
            y = end.y;
        }
        points.push({ x, y });
    }
    return points;
}

function addOrganicBoundary(rng, grid, pathPoints, options) {
    const height = grid.length;
    const width = grid[0].length;
    const floor = new Set();
    const baseRadius = options.pathRadius ?? 2;

    for (const point of pathPoints) {
        const radius = baseRadius + (rng() < 0.18 ? 1 : 0);
        for (let y = point.y - radius; y <= point.y + radius; y++) {
            for (let x = point.x - radius; x <= point.x + radius; x++) {
                if (!inBounds(width, height, x, y)) continue;
                const dx = x - point.x;
                const dy = y - point.y;
                if (dx * dx + dy * dy <= radius * radius + rng() * 1.5) floor.add(`${x},${y}`);
            }
        }
    }

    const clearingCount = intRange(rng, options.clearingsMin ?? 1, options.clearingsMax ?? 3);
    for (let i = 0; i < clearingCount; i++) {
        const point = choice(rng, pathPoints);
        const radius = intRange(rng, 3, 7);
        for (let y = point.y - radius; y <= point.y + radius; y++) {
            for (let x = point.x - radius; x <= point.x + radius; x++) {
                if (!inBounds(width, height, x, y)) continue;
                const dx = x - point.x;
                const dy = y - point.y;
                if (dx * dx + dy * dy <= radius * radius + rng() * 3) floor.add(`${x},${y}`);
            }
        }
    }

    for (const key of floor) {
        const [x, y] = key.split(',').map(Number);
        if (x > 0 && x < width - 1 && y > 0 && y < height - 1) grid[y][x] = '.';
    }

    for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
            if (grid[y][x] !== '.') continue;
            if (rng() < (options.tallGrassChance ?? 0.05)) grid[y][x] = ',';
            if (rng() < (options.waterChance ?? 0.015)) carveDisc(grid, x, y, intRange(rng, 1, 2), '~');
        }
    }
}

function placeExit(grid, marker, side, point) {
    const height = grid.length;
    const width = grid[0].length;
    const x = side === 'west' ? 0 : (side === 'east' ? width - 1 : point.x);
    const y = side === 'north' ? 0 : (side === 'south' ? height - 1 : point.y);
    grid[y][x] = marker;
    return { x, y };
}

function arrivalFor(side, exit) {
    const config = SIDE_CONFIG[side];
    return {
        x: exit.x + (config.arrivalDx ?? 0),
        y: exit.y + (config.arrivalDy ?? 0),
        facing: config.facing,
    };
}

function spawnFor(arrival) {
    return {
        x: arrival.x,
        y: arrival.y,
    };
}

export function generatePathFirstRoadStage(options = {}) {
    const rng = createRng(options.seed ?? options.id ?? 'road-stage');
    const width = options.width ?? intRange(rng, 24, 56);
    const height = options.height ?? intRange(rng, 14, 36);
    const backSide = options.backSide ?? 'south';
    const forwardSide = options.forwardSide ?? 'north';
    const backExit = chooseExitPoint(rng, width, height, backSide);
    const forwardExit = chooseExitPoint(rng, width, height, forwardSide);
    const backInterior = {
        x: clamp(backExit.x + (SIDE_CONFIG[backSide].arrivalDx ?? 0), 1, width - 2),
        y: clamp(backExit.y + (SIDE_CONFIG[backSide].arrivalDy ?? 0), 1, height - 2),
    };
    const forwardInterior = {
        x: clamp(forwardExit.x + (SIDE_CONFIG[forwardSide].arrivalDx ?? 0), 1, width - 2),
        y: clamp(forwardExit.y + (SIDE_CONFIG[forwardSide].arrivalDy ?? 0), 1, height - 2),
    };

    const grid = makeCharGrid(width, height, '^');
    const path = makePath(rng, width, height, backInterior, forwardInterior, options);
    addOrganicBoundary(rng, grid, path, options);
    const placedBack = placeExit(grid, 'A', backSide, backExit);
    const placedForward = placeExit(grid, 'B', forwardSide, forwardExit);

    const backArrival = arrivalFor(backSide, placedBack);
    const forwardArrival = arrivalFor(forwardSide, placedForward);
    const stage = createAuthoredStageDefinition({
        id: options.id ?? 'generated-road-stage',
        stageSlug: options.id ?? 'generated-road-stage',
        displayName: options.displayName ?? 'Generated Road Stage',
        zoneId: options.zoneId ?? 'great-northern-road',
        tags: Object.freeze(['outdoor', 'road', 'generated']),
        floorTile: 'floor_dirt',
        map: `\n${serializeCharGrid(grid)}\n`,
        exitMarkers: Object.freeze({
            A: Object.freeze({
                id: options.backExitId ?? `${backSide}-road`,
                exitIndex: 0,
                connectionRole: 'back',
                arrival: Object.freeze(backArrival),
            }),
            B: Object.freeze({
                id: options.forwardExitId ?? `${forwardSide}-road`,
                exitIndex: 1,
                connectionRole: 'forward',
                arrival: Object.freeze(forwardArrival),
            }),
        }),
        spawnPoint: Object.freeze(spawnFor(backArrival)),
    });

    return {
        stage,
        ascii: serializeCharGrid(grid),
    };
}
