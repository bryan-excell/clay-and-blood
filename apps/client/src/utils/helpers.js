import { STAGE_HEIGHT, STAGE_WIDTH, TILE_SIZE } from "../config.js";

/**
 * Create a seeded pseudo-random number generator (mulberry32).
 * Accepts a string seed (e.g. a levelId) so every client generates
 * identical layouts for the same level.
 */
export function seededRng(seedStr) {
    // Hash the string to a uint32
    let h = 5381;
    for (let i = 0; i < seedStr.length; i++) {
        h = (Math.imul(33, h) ^ seedStr.charCodeAt(i)) >>> 0;
    }
    let s = h || 1; // ensure non-zero
    return function () {
        s += 0x6D2B79F5;
        s = s >>> 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = Math.imul(t ^ (t >>> 7), 61 | t) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// Utility: Shuffle array
export function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

// Shuffle using a provided seeded rng function
export function shuffleArrayWithRng(array, rng) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

// Find a random empty tile in a stage
export function findEmptyTile(stage) {
    const emptyTiles = [];

    for (let y = 0; y < STAGE_HEIGHT; y++) {
        for (let x = 0; x < STAGE_WIDTH; x++) {
            if (stage.tiles[y][x] === 0) { // Empty
                emptyTiles.push({
                    x: x * TILE_SIZE + TILE_SIZE / 2,
                    y: y * TILE_SIZE + TILE_SIZE / 2
                });
            }
        }
    }

    if (emptyTiles.length === 0) {
        return {
            x: STAGE_WIDTH * TILE_SIZE / 2,
            y: STAGE_HEIGHT * TILE_SIZE / 2
        };
    }

    return emptyTiles[Math.floor(Math.random() * emptyTiles.length)];
}