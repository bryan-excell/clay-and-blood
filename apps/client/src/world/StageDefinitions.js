/**
 * StageDefinitions  (client-only)
 *
 * Tile geometry comes from STATIC_STAGE_LAYOUTS in @clay-and-blood/shared
 * (the single source of truth used by both client and server).
 * This file adds client-only metadata on top:
 *
 *   type        – 'static' | 'random'
 *   floorTile   – prefab name for floor rendering (default: 'floor_dirt')
 *   spawnPoint  – { x, y } tile coords for first-entry spawn (default: grid centre)
 *   connections – { [exitIndex]: { levelId, exitIndex } } pre-wired named exits
 *   width/height – for random stages, controls generator dimensions
 *   generator   – for random stages, controls biome type (default: 'cave')
 */
import { STATIC_STAGE_LAYOUTS, STATIC_EXIT_CONNECTIONS } from '@clay-and-blood/shared';

// ─── Static stage helpers ──────────────────────────────────────────────────

/**
 * Inline tile helper for static stages NOT in the shared layouts
 * (e.g. small interiors whose server-side collision doesn't matter yet).
 */
function _emptyRoom(w, h) {
    return Array.from({ length: h }, (_, y) =>
        Array.from({ length: w }, (_, x) =>
            x === 0 || x === w - 1 || y === 0 || y === h - 1 ? 1 : 0
        )
    );
}

// ─── Stage registry ────────────────────────────────────────────────────────

const _staticStages = {
    /**
     * Shop interior: layout defined inline (not yet in shared layouts).
     * One exit on the south wall.
     */
    'shop-1': (() => {
        const w = 12, h = 10;
        const tiles = _emptyRoom(w, h);
        for (let x = 2; x <= 9; x++) tiles[2][x] = 1; // counter
        tiles[2][5] = 0;                                // gap in counter
        tiles[h - 1][Math.floor(w / 2)] = 2;           // south exit
        return {
            type: 'static',
            floorTile: 'floor_dirt',
            width: w, height: h, tiles,
            exits: [{ x: Math.floor(w / 2), y: h - 1, exitIndex: 0, side: 'south' }],
        };
    })(),

    /** Starting town – 40×40, layout from shared. */
    'town-square': {
        type: 'static',
        floorTile: 'floor_grass',
        spawnPoint: { x: 20, y: 20 },
        ...STATIC_STAGE_LAYOUTS['town-square'],
        connections: STATIC_EXIT_CONNECTIONS['town-square'],
    },

    /** West Gate – layout from shared. */
    'west-gate': {
        type: 'static',
        floorTile: 'floor_dirt',
        spawnPoint: { x: 10, y: 4 },
        ...STATIC_STAGE_LAYOUTS['west-gate'],
        connections: STATIC_EXIT_CONNECTIONS['west-gate'],
    },

    /** Inn – L-shaped interior, layout from shared. */
    'inn': {
        type: 'static',
        floorTile: 'floor_dirt',
        spawnPoint: { x: 3, y: 9 },
        ...STATIC_STAGE_LAYOUTS['inn'],
        connections: STATIC_EXIT_CONNECTIONS['inn'],
    },
};

/** @type {Map<string, object>} */
const _registry = new Map(Object.entries(_staticStages));

// ─── Display names ─────────────────────────────────────────────────────────

const _displayNames = {
    'town-square': 'Town Square',
    'west-gate':   'West Gate',
    'shop-1':      'The Shop',
    'inn':         'The Inn',
};

/**
 * Return a human-readable name for any level ID.
 * Named levels use their registered display name; all others are "The Wilds".
 * @param {string} levelId
 * @returns {string}
 */
export function getLevelDisplayName(levelId) {
    return _displayNames[levelId] ?? 'The Wilds';
}

// ─── Public API ────────────────────────────────────────────────────────────

/**
 * Default definition for any level not in the registry.
 * Procedurally generated at default dimensions.
 */
const DEFAULT_DEFINITION = { type: 'random', width: 20, height: 20, generator: 'cave' };

/**
 * Look up the definition for a level ID.
 * Returns a default random definition for unknown IDs.
 * @param {string} levelId
 * @returns {{ type: 'random'|'static', width: number, height: number, tiles?: number[][], exits?: object[] }}
 */
export function getStageDefinition(levelId) {
    return _registry.get(levelId) ?? DEFAULT_DEFINITION;
}

/**
 * Register or override a stage definition at runtime.
 * Useful for server-driven stage data.
 * @param {string} levelId
 * @param {object} definition
 */
export function registerStageDefinition(levelId, definition) {
    _registry.set(levelId, definition);
}
