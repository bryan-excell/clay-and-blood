import {
    TILE_EXIT,
    TILE_FLOOR,
    TILE_SHALLOW_WATER,
    TILE_TALL_GRASS,
    TILE_VOID,
    TILE_WALL,
} from './tileRegistry.js';

const DEFAULT_TILE_CHAR_MAP = Object.freeze({
    '.': TILE_FLOOR,
    '#': TILE_WALL,
    W: TILE_WALL,
    '^': TILE_VOID,
    ',': TILE_TALL_GRASS,
    '~': TILE_SHALLOW_WATER,
});

function normalizeAsciiMap(asciiMap) {
    if (typeof asciiMap !== 'string') {
        throw new TypeError('ASCII tile map must be a string');
    }
    const lines = asciiMap.replace(/\r/g, '').split('\n');
    while (lines.length > 0 && lines[0] === '') lines.shift();
    while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
    if (lines.length === 0) {
        throw new Error('ASCII tile map must contain at least one row');
    }
    return lines;
}

function inferExitSide(x, y, width, height) {
    if (y === 0) return 'north';
    if (y === height - 1) return 'south';
    if (x === 0) return 'west';
    if (x === width - 1) return 'east';
    return 'interior';
}

function normalizeExitMarkers(exitMarkers) {
    if (!exitMarkers || typeof exitMarkers !== 'object') return {};
    return Object.fromEntries(
        Object.entries(exitMarkers)
            .filter(([marker, exit]) => marker.length === 1 && exit && typeof exit === 'object')
            .map(([marker, exit]) => [marker, { ...exit }])
    );
}

function cloneArrival(arrival) {
    if (!arrival || typeof arrival !== 'object') return undefined;
    return {
        ...arrival,
    };
}

export function parseTileMap(asciiMap, options = {}) {
    const lines = normalizeAsciiMap(asciiMap);
    const width = lines[0].length;
    if (width === 0) {
        throw new Error('ASCII tile map rows cannot be empty');
    }
    for (let y = 0; y < lines.length; y++) {
        if (lines[y].length !== width) {
            throw new Error(`ASCII tile map row ${y} has width ${lines[y].length}; expected ${width}`);
        }
    }

    const tileCharMap = { ...DEFAULT_TILE_CHAR_MAP, ...(options.tileCharMap ?? {}) };
    const exitMarkers = normalizeExitMarkers(options.exitMarkers);
    const seenExitMarkers = new Set();
    const exits = [];
    const tiles = lines.map((line, y) => Array.from(line, (char, x) => {
        const exit = exitMarkers[char];
        if (exit) {
            if (seenExitMarkers.has(char)) {
                throw new Error(`Exit marker "${char}" appears more than once`);
            }
            seenExitMarkers.add(char);
            const parsedExit = {
                ...exit,
                x,
                y,
                exitIndex: Number.isInteger(exit.exitIndex) ? exit.exitIndex : exits.length,
                side: exit.side ?? inferExitSide(x, y, width, lines.length),
            };
            const arrival = cloneArrival(exit.arrival);
            if (arrival) parsedExit.arrival = arrival;
            exits.push(parsedExit);
            return TILE_EXIT;
        }

        if (!Object.prototype.hasOwnProperty.call(tileCharMap, char)) {
            throw new Error(`Unknown tile map character "${char}" at ${x},${y}`);
        }
        return tileCharMap[char];
    }));

    for (const marker of Object.keys(exitMarkers)) {
        if (!seenExitMarkers.has(marker)) {
            throw new Error(`Exit marker "${marker}" was declared but not found in the tile map`);
        }
    }

    exits.sort((a, b) => a.exitIndex - b.exitIndex);
    return {
        width,
        height: lines.length,
        tiles,
        exits,
    };
}

function freezeGrid(grid) {
    return Object.freeze(grid.map((row) => Object.freeze([...row])));
}

export function createAuthoredStageDefinition(definition) {
    if (!definition || typeof definition !== 'object') {
        throw new TypeError('Authored stage definition must be an object');
    }
    const {
        map,
        exitMarkers,
        tileCharMap,
        terrainFeatures = [],
        ...rest
    } = definition;
    const parsed = parseTileMap(map, {
        exitMarkers,
        tileCharMap,
    });
    return Object.freeze({
        ...rest,
        kind: 'static',
        width: parsed.width,
        height: parsed.height,
        tiles: freezeGrid(parsed.tiles),
        exits: Object.freeze(parsed.exits.map((exit) => Object.freeze(exit))),
        terrainFeatures: Object.freeze(terrainFeatures),
    });
}
