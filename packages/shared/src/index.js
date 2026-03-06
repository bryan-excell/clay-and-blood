// Tile / world constants (defaults for procedurally generated levels)
export const TILE_SIZE = 64;
export const STAGE_WIDTH = 20;
export const STAGE_HEIGHT = 20;

// Tile values
// 0 = floor (walkable)
// 1 = wall  (solid, rendered when adjacent to open space)
// 2 = exit  (walkable, triggers level transition)
// 3 = void  (outside the playable area; not rendered, treated as solid)
export const TILE_FLOOR = 0;
export const TILE_WALL  = 1;
export const TILE_EXIT  = 2;
export const TILE_VOID  = 3;

// Player constants
export const PLAYER_RADIUS = 16;
export const PLAYER_SPEED = 200;
export const PLAYER_SPRINT_MULTIPLIER = 1.75;
export const PLAYER_DASH_SPEED = 800;
export const PLAYER_DASH_DURATION = 250; // ms

// WebSocket message types for client <-> server communication
export const MSG = {
    PLAYER_JOIN:    'player_join',
    PLAYER_LEAVE:   'player_leave',
    PLAYER_INPUT:   'player_input',
    GAME_STATE:     'game_state',
    STATE_SNAPSHOT: 'state_snapshot',
    LEVEL_CHANGE:   'level_change',
    BULLET_FIRED:   'bullet_fired',
};

/**
 * Seeded PRNG (mulberry32). Accepts a string seed.
 * This is the canonical implementation – the server and every client must use
 * this exact function so that level generation is identical everywhere.
 */
export function seededRng(seedStr) {
    let h = 5381;
    for (let i = 0; i < seedStr.length; i++) {
        h = (Math.imul(33, h) ^ seedStr.charCodeAt(i)) >>> 0;
    }
    let s = h || 1;
    return function () {
        s += 0x6D2B79F5;
        s = s >>> 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = Math.imul(t ^ (t >>> 7), 61 | t) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * Fisher-Yates shuffle using a provided seeded RNG.
 * Canonical implementation – must match client helpers.js exactly.
 */
export function shuffleArrayWithRng(array, rng) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

/**
 * Deterministically resolve where a given exit leads.
 *
 * Every client and the server calling this with the same arguments will get
 * the same (toLevelId, toExitIndex) pair, ensuring consistent world topology.
 *
 * @param {string} fromLevelId
 * @param {number} fromExitIndex
 * @returns {{ toLevelId: string, toExitIndex: number }}
 */
export function getExitDestination(fromLevelId, fromExitIndex) {
    const rng = seededRng(`exit:${fromLevelId}:${fromExitIndex}`);
    // Derive a stable, human-readable level ID
    const levelHash = Math.floor(rng() * 0xFFFFFF).toString(16).padStart(6, '0');
    const toLevelId = `level-${levelHash}`;
    // Pick target exit deterministically using the destination's own exits
    const { exits } = generateLevelData(toLevelId);
    const toExitIndex = exits[Math.floor(rng() * exits.length)]?.exitIndex ?? 0;
    return { toLevelId, toExitIndex };
}

/**
 * Generate the authoritative level data for a given level ID.
 *
 * Produces an identical grid and exit list on the server and every client
 * because the algorithm is fully deterministic from the levelId seed.
 *
 * Grid values:  0 = floor,  1 = wall,  2 = exit
 *
 * @param {string} levelId
 * @param {{ width?: number, height?: number, generator?: string }} options
 *   generator – reserved for future biome types ('cave', 'field', 'ruins', …).
 *               Currently only 'cave' is implemented; all values produce the same output.
 * @returns {{ grid: number[][], exits: Array<{x:number, y:number, exitIndex:number, side:string}>, width: number, height: number }}
 */
export function generateLevelData(levelId, options = {}) {
    const w = options.width  ?? STAGE_WIDTH;
    const h = options.height ?? STAGE_HEIGHT;
    // options.generator is reserved – biome-specific generators go here in future

    const rng = seededRng(levelId);

    // Start with all walls
    const grid = Array.from({ length: h }, () => new Array(w).fill(1));

    const centerX = Math.floor(w / 2);
    const centerY = Math.floor(h / 2);

    // Carve centre room (3-tile half-width/height)
    _carveRoom(grid, centerX, centerY, 3, 3, w, h, rng);

    // Carve random rooms and connect each to the centre
    const numRooms = 5 + Math.floor(rng() * 5);
    for (let i = 0; i < numRooms; i++) {
        const roomX = 3 + Math.floor(rng() * (w - 6));
        const roomY = 3 + Math.floor(rng() * (h - 6));
        const roomW = 2 + Math.floor(rng() * 3);
        const roomH = 2 + Math.floor(rng() * 3);
        _carveRoom(grid, roomX, roomY, roomW, roomH, w, h, rng);
        _carveCorridor(grid, roomX, roomY, centerX, centerY, w, h);
    }

    // Enforce solid border ring — no matter what carving did
    for (let x = 0; x < w; x++) {
        grid[0][x] = 1;
        grid[h - 1][x] = 1;
    }
    for (let y = 0; y < h; y++) {
        grid[y][0] = 1;
        grid[y][w - 1] = 1;
    }

    // Find potential exit positions (floor tile adjacent to at least one wall)
    const potentialExits = [];
    for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
            if (grid[y][x] === 0 &&
                (grid[y - 1][x] === 1 || grid[y + 1][x] === 1 ||
                 grid[y][x - 1] === 1 || grid[y][x + 1] === 1)) {
                potentialExits.push({ x, y });
            }
        }
    }

    shuffleArrayWithRng(potentialExits, rng);
    const numExits = Math.max(1, Math.min(3, Math.floor(rng() * 3) + 1));

    const exits = [];
    for (let i = 0; i < numExits; i++) {
        if (potentialExits[i]) {
            const { x, y } = potentialExits[i];
            grid[y][x] = 2; // mark as exit
            exits.push({ x, y, exitIndex: i, side: _exitSide(x, y, w, h) });
        }
    }

    return { grid, exits, width: w, height: h };
}

// ─── Static stage layouts ─────────────────────────────────────────────────────
// Authoritative tile geometry used by both client and server.
// Each entry: { width, height, tiles, exits }.
// Client-only metadata (connections, floorTile, spawnPoint, display name)
// lives in StageDefinitions.js.

function _emptyRoom(w, h) {
    return Array.from({ length: h }, (_, y) =>
        Array.from({ length: w }, (_, x) =>
            x === 0 || x === w - 1 || y === 0 || y === h - 1 ? 1 : 0
        )
    );
}

export const STATIC_STAGE_LAYOUTS = (() => {
    const layouts = {};

    // Town Square: 40×40, open floor, one exit per cardinal side,
    // plus a small inn building in the northwest area.
    {
        const w = 40, h = 40;
        const tiles = _emptyRoom(w, h);
        const midX = Math.floor(w / 2);
        const midY = Math.floor(h / 2);

        // Cardinal exits
        tiles[0][midX]     = 2; // north, exitIndex 0
        tiles[h - 1][midX] = 2; // south, exitIndex 1
        tiles[midY][0]     = 2; // west,  exitIndex 2
        tiles[midY][w - 1] = 2; // east,  exitIndex 3

        // Small Inn building in the NW area (x=4–10, y=3–9).
        // The exterior walls outline a small structure; the interior
        // floor tiles are enclosed and not directly accessible from
        // the square — players enter by stepping on the door exit.
        for (let bx = 4; bx <= 10; bx++) {
            tiles[3][bx] = 1; // north wall of building
            tiles[9][bx] = 1; // south wall of building
        }
        for (let by = 4; by <= 8; by++) {
            tiles[by][4]  = 1; // west wall
            tiles[by][10] = 1; // east wall
        }
        // Door on south wall — stepping on this exits to the Inn.
        tiles[9][7] = 2; // exitIndex 4

        layouts['town-square'] = {
            width: w, height: h, tiles,
            exits: [
                { x: midX, y: 0,     exitIndex: 0, side: 'north' },
                { x: midX, y: h - 1, exitIndex: 1, side: 'south' },
                { x: 0,    y: midY,  exitIndex: 2, side: 'west'  },
                { x: w - 1,y: midY,  exitIndex: 3, side: 'east'  },
                { x: 7,    y: 9,     exitIndex: 4, side: 'interior' }, // Inn door
            ],
        };
    }

    // West Gate: 20×9 narrow horizontal hallway.
    {
        const w = 20, h = 9;
        const tiles = _emptyRoom(w, h);
        const midY = Math.floor(h / 2);
        tiles[midY][0]     = 2; // west → The Wilds
        tiles[midY][w - 1] = 2; // east → Town Square
        layouts['west-gate'] = {
            width: w, height: h, tiles,
            exits: [
                { x: 0,     y: midY, exitIndex: 0, side: 'west' },
                { x: w - 1, y: midY, exitIndex: 1, side: 'east' },
            ],
        };
    }

    // Inn: 16×12 L-shaped room.
    // The top-right corner (x=8–15, y=0–5) is void (TILE_VOID=3),
    // creating an L-shape with an impassable void border.
    // Layout:
    //   y 0–5 : left arm of the L  (x 0–7 wall/floor, x 8–15 void)
    //   y 6–11: full-width base of the L
    //   Exit at (5, 11) — south wall, leads back to Town Square.
    {
        const w = 16, h = 12;
        // Fill everything as void first, then carve out the L shape
        const tiles = Array.from({ length: h }, () => new Array(w).fill(3));

        // Left arm: x=0–7, y=0–5
        for (let y = 0; y <= 5; y++) {
            for (let x = 0; x <= 7; x++) {
                // border = wall, interior = floor
                tiles[y][x] = (x === 0 || x === 7 || y === 0) ? 1 : 0;
            }
        }

        // Base of L: x=0–15, y=6–11
        for (let y = 6; y <= 11; y++) {
            for (let x = 0; x <= 15; x++) {
                tiles[y][x] = (x === 0 || x === 15 || y === 11) ? 1 : 0;
            }
        }

        // Inner corner — row y=6 needs a wall along x=7–15 to close the left arm
        for (let x = 7; x <= 15; x++) {
            tiles[6][x] = 1;
        }
        // Left arm right-side wall also needs to connect down to y=6
        // (already handled: x=7, y=0–6 are all walls from the two loops above)

        // South exit: replaces the south-wall tile at (5, 11)
        tiles[11][5] = 2; // exitIndex 0, back to Town Square

        layouts['inn'] = {
            width: w, height: h, tiles,
            exits: [
                { x: 5, y: 11, exitIndex: 0, side: 'south' },
            ],
        };
    }

    return layouts;
})();

/**
 * Return the authoritative grid for any level ID.
 * Static stages use their hand-authored tile layout; all others are procedural.
 * @param {string} levelId
 * @param {object} [options]
 * @returns {{ grid: number[][], exits: object[], width: number, height: number }}
 */
export function getStageData(levelId, options = {}) {
    const layout = STATIC_STAGE_LAYOUTS[levelId];
    if (layout) {
        return {
            grid:   layout.tiles.map(row => [...row]),
            exits:  layout.exits.map(e => ({ ...e })),
            width:  layout.width,
            height: layout.height,
        };
    }
    return generateLevelData(levelId, options);
}

// ─── Private helpers ──────────────────────────────────────────────────────────

/**
 * Determine which side of the stage an exit tile is nearest to.
 * @returns {'north'|'south'|'east'|'west'|'interior'}
 */
function _exitSide(x, y, w, h) {
    const distNorth = y;
    const distSouth = h - 1 - y;
    const distWest  = x;
    const distEast  = w - 1 - x;
    const min = Math.min(distNorth, distSouth, distWest, distEast);
    if (min > Math.min(w, h) / 4) return 'interior';
    if (min === distNorth) return 'north';
    if (min === distSouth) return 'south';
    if (min === distWest)  return 'west';
    return 'east';
}

/**
 * Carve a rectangular room centred at (cx, cy) into the grid.
 * Calls rng() once per wall->floor transition to keep the RNG sequence
 * identical to the original EntityLevelGenerator (which consumed rng for
 * deciding floor_dirt vs floor_grass).
 */
function _carveRoom(grid, cx, cy, halfW, halfH, w, h, rng) {
    for (let y = cy - halfH; y <= cy + halfH; y++) {
        for (let x = cx - halfW; x <= cx + halfW; x++) {
            if (y >= 0 && y < h && x >= 0 && x < w) {
                if (grid[y][x] === 1) {
                    grid[y][x] = 0;
                    rng(); // consume to keep sequence in sync with client
                }
            }
        }
    }
}

/**
 * Carve an L-shaped corridor from (x1,y1) to (x2,y2).
 * No rng() calls (corridors always used floor_dirt on the client).
 */
function _carveCorridor(grid, x1, y1, x2, y2, w, h) {
    const minX = Math.min(x1, x2), maxX = Math.max(x1, x2);
    for (let x = minX; x <= maxX; x++) {
        if (y1 >= 0 && y1 < h && x >= 0 && x < w) {
            if (grid[y1][x] === 1) grid[y1][x] = 0;
        }
    }
    const minY = Math.min(y1, y2), maxY = Math.max(y1, y2);
    for (let y = minY; y <= maxY; y++) {
        if (y >= 0 && y < h && x2 >= 0 && x2 < w) {
            if (grid[y][x2] === 1) grid[y][x2] = 0;
        }
    }
}
