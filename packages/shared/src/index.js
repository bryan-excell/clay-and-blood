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
const SOLID_TILE_TYPES = new Set([TILE_WALL, TILE_VOID]);
const SWEEP_EPSILON = 1e-6;

/**
 * Compute movement velocity from held directional input.
 * @param {{up?:boolean,down?:boolean,left?:boolean,right?:boolean,sprint?:boolean}} input
 * @returns {{ vx:number, vy:number }}
 */
export function movementVelocityFromInput(input = {}) {
    let vx = 0;
    let vy = 0;
    if (input.left)  vx -= 1;
    if (input.right) vx += 1;
    if (input.up)    vy -= 1;
    if (input.down)  vy += 1;

    if (vx !== 0 && vy !== 0) {
        const len = Math.sqrt(vx * vx + vy * vy);
        vx /= len;
        vy /= len;
    }

    const speed = input.sprint
        ? PLAYER_SPEED * PLAYER_SPRINT_MULTIPLIER
        : PLAYER_SPEED;
    return { vx: vx * speed, vy: vy * speed };
}

/**
 * Derive dash velocity from current directional input.
 * Returns null when no directional input is held.
 * @param {{up?:boolean,down?:boolean,left?:boolean,right?:boolean}} input
 * @returns {{ dashVx:number, dashVy:number, dashTimeLeftMs:number } | null}
 */
export function dashStateFromInput(input = {}) {
    let dvx = 0;
    let dvy = 0;
    if (input.left)  dvx -= 1;
    if (input.right) dvx += 1;
    if (input.up)    dvy -= 1;
    if (input.down)  dvy += 1;

    if (dvx === 0 && dvy === 0) return null;
    if (dvx !== 0 && dvy !== 0) {
        const len = Math.sqrt(dvx * dvx + dvy * dvy);
        dvx /= len;
        dvy /= len;
    }
    return {
        dashVx: dvx * PLAYER_DASH_SPEED,
        dashVy: dvy * PLAYER_DASH_SPEED,
        dashTimeLeftMs: PLAYER_DASH_DURATION,
    };
}

/**
 * Resolve a player circle against a tile grid.
 * @param {number} x
 * @param {number} y
 * @param {number[][] | null | undefined} grid
 * @param {number} [vxHint]
 * @param {number} [vyHint]
 * @returns {{ x:number, y:number }}
 */
export function resolvePlayerCollisions(x, y, grid, vxHint = 0, vyHint = 0) {
    if (!grid) return { x, y };

    const r = PLAYER_RADIUS;
    const gridH = grid.length;
    const gridW = gridH > 0 ? grid[0].length : 0;
    const isSolid = (tile) => SOLID_TILE_TYPES.has(tile);
    const radiusCells = 2;

    // Iterative depenetration to robustly resolve corner and deep-overlap cases.
    for (let iter = 0; iter < 5; iter++) {
        let collided = false;
        const cellX = Math.floor(x / TILE_SIZE);
        const cellY = Math.floor(y / TILE_SIZE);

        for (let dy = -radiusCells; dy <= radiusCells; dy++) {
            for (let dx = -radiusCells; dx <= radiusCells; dx++) {
                const nx = cellX + dx;
                const ny = cellY + dy;
                if (nx < 0 || nx >= gridW || ny < 0 || ny >= gridH) continue;
                if (!isSolid(grid[ny][nx])) continue;

                const rLeft = nx * TILE_SIZE;
                const rTop = ny * TILE_SIZE;
                const rRight = rLeft + TILE_SIZE;
                const rBot = rTop + TILE_SIZE;

                const nearX = Math.max(rLeft, Math.min(x, rRight));
                const nearY = Math.max(rTop, Math.min(y, rBot));
                const distX = x - nearX;
                const distY = y - nearY;
                const distSq = distX * distX + distY * distY;
                if (distSq >= r * r) continue;

                collided = true;
                if (distSq > 1e-12) {
                    const dist = Math.sqrt(distSq);
                    const overlap = r - dist;
                    x += (distX / dist) * overlap;
                    y += (distY / dist) * overlap;
                    continue;
                }

                // Center is inside tile (dist==0): choose axis by nearest escape,
                // then bias direction to oppose incoming velocity when available.
                const toLeft = x - rLeft;
                const toRight = rRight - x;
                const toTop = y - rTop;
                const toBottom = rBot - y;
                const minEdge = Math.min(toLeft, toRight, toTop, toBottom);

                if (minEdge === toLeft || minEdge === toRight) {
                    const pushLeft = (toLeft <= toRight);
                    const dir = Math.abs(vxHint) > 0.001 ? (vxHint > 0 ? -1 : 1) : (pushLeft ? -1 : 1);
                    x = dir < 0 ? (rLeft - r) : (rRight + r);
                } else {
                    const pushUp = (toTop <= toBottom);
                    const dir = Math.abs(vyHint) > 0.001 ? (vyHint > 0 ? -1 : 1) : (pushUp ? -1 : 1);
                    y = dir < 0 ? (rTop - r) : (rBot + r);
                }
            }
        }

        if (!collided) break;
    }

    x = Math.max(r, Math.min(gridW * TILE_SIZE - r, x));
    y = Math.max(r, Math.min(gridH * TILE_SIZE - r, y));
    return { x, y };
}

/**
 * Sweep a moving point against an AABB.
 * (Used with walls expanded by PLAYER_RADIUS for swept-circle CCD.)
 * @param {number} px
 * @param {number} py
 * @param {number} dx
 * @param {number} dy
 * @param {number} left
 * @param {number} top
 * @param {number} right
 * @param {number} bottom
 * @returns {{ t:number, nx:number, ny:number } | null}
 */
function sweepPointVsAabb(px, py, dx, dy, left, top, right, bottom) {
    let tNearX, tFarX, tNearY, tFarY;

    if (Math.abs(dx) < SWEEP_EPSILON) {
        if (px < left || px > right) return null;
        tNearX = -Infinity;
        tFarX = Infinity;
    } else {
        tNearX = (left - px) / dx;
        tFarX = (right - px) / dx;
        if (tNearX > tFarX) [tNearX, tFarX] = [tFarX, tNearX];
    }

    if (Math.abs(dy) < SWEEP_EPSILON) {
        if (py < top || py > bottom) return null;
        tNearY = -Infinity;
        tFarY = Infinity;
    } else {
        tNearY = (top - py) / dy;
        tFarY = (bottom - py) / dy;
        if (tNearY > tFarY) [tNearY, tFarY] = [tFarY, tNearY];
    }

    const tEntry = Math.max(tNearX, tNearY);
    const tExit = Math.min(tFarX, tFarY);
    if (tEntry > tExit) return null;
    if (tExit < 0 || tEntry > 1) return null;

    let nx = 0;
    let ny = 0;
    if (tNearX > tNearY) nx = dx > 0 ? -1 : 1;
    else ny = dy > 0 ? -1 : 1;
    return { t: Math.max(0, tEntry), nx, ny };
}

/**
 * Continuous swept-circle movement against solid tiles (wall/void) with slide.
 * @param {number} x
 * @param {number} y
 * @param {number} dx
 * @param {number} dy
 * @param {number[][] | null | undefined} grid
 * @returns {{ x:number, y:number }}
 */
function sweepPlayerMove(x, y, dx, dy, grid) {
    if (!grid) return { x: x + dx, y: y + dy };
    if (Math.abs(dx) < SWEEP_EPSILON && Math.abs(dy) < SWEEP_EPSILON) return { x, y };

    const r = PLAYER_RADIUS;
    const rows = grid.length;
    const cols = rows > 0 ? grid[0].length : 0;
    const isSolid = (tile) => SOLID_TILE_TYPES.has(tile);

    let remDx = dx;
    let remDy = dy;

    for (let iter = 0; iter < 4; iter++) {
        if (Math.abs(remDx) < SWEEP_EPSILON && Math.abs(remDy) < SWEEP_EPSILON) break;

        const endX = x + remDx;
        const endY = y + remDy;
        const minX = Math.min(x, endX) - r;
        const maxX = Math.max(x, endX) + r;
        const minY = Math.min(y, endY) - r;
        const maxY = Math.max(y, endY) + r;
        const minCellX = Math.max(0, Math.floor(minX / TILE_SIZE));
        const maxCellX = Math.min(cols - 1, Math.floor(maxX / TILE_SIZE));
        const minCellY = Math.max(0, Math.floor(minY / TILE_SIZE));
        const maxCellY = Math.min(rows - 1, Math.floor(maxY / TILE_SIZE));

        let best = null;

        for (let ty = minCellY; ty <= maxCellY; ty++) {
            for (let tx = minCellX; tx <= maxCellX; tx++) {
                if (!isSolid(grid[ty][tx])) continue;

                const left = tx * TILE_SIZE - r;
                const top = ty * TILE_SIZE - r;
                const right = (tx + 1) * TILE_SIZE + r;
                const bottom = (ty + 1) * TILE_SIZE + r;
                const hit = sweepPointVsAabb(x, y, remDx, remDy, left, top, right, bottom);
                if (!hit) continue;
                if (!best || hit.t < best.t) best = hit;
            }
        }

        if (!best) {
            x += remDx;
            y += remDy;
            break;
        }

        const advanceT = Math.max(0, best.t - SWEEP_EPSILON);
        x += remDx * advanceT;
        y += remDy * advanceT;

        const remainT = Math.max(0, 1 - advanceT);
        let slideDx = remDx * remainT;
        let slideDy = remDy * remainT;

        // Remove velocity component into the wall normal (slide response).
        const into = slideDx * best.nx + slideDy * best.ny;
        if (into < 0) {
            slideDx -= best.nx * into;
            slideDy -= best.ny * into;
        }

        remDx = slideDx;
        remDy = slideDy;

        // Resolve any tiny residual overlap from numeric precision before next sweep.
        ({ x, y } = resolvePlayerCollisions(x, y, grid, remDx, remDy));
    }

    return { x, y };
}

/**
 * Shared movement integration for both client prediction and server authority.
 * Dash start is handled externally by updating dash state before calling this.
 * @param {{x:number,y:number,dashVx?:number,dashVy?:number,dashTimeLeftMs?:number}} state
 * @param {{up?:boolean,down?:boolean,left?:boolean,right?:boolean,sprint?:boolean}} input
 * @param {number} dtMs
 * @param {number[][] | null | undefined} grid
 * @returns {{x:number,y:number,vx:number,vy:number,dashVx:number,dashVy:number,dashTimeLeftMs:number}}
 */
export function stepPlayerKinematics(state, input, dtMs, grid) {
    let dashVx = state.dashVx ?? 0;
    let dashVy = state.dashVy ?? 0;
    let dashTimeLeftMs = Math.max(0, state.dashTimeLeftMs ?? 0);

    let vx = 0;
    let vy = 0;
    if (dashTimeLeftMs > 0) {
        vx = dashVx;
        vy = dashVy;
        dashTimeLeftMs = Math.max(0, dashTimeLeftMs - dtMs);
    } else {
        ({ vx, vy } = movementVelocityFromInput(input));
        dashVx = 0;
        dashVy = 0;
    }

    let x = state.x;
    let y = state.y;
    const totalMoveDist = Math.sqrt((vx * dtMs / 1000) ** 2 + (vy * dtMs / 1000) ** 2);
    const maxSubstepDist = Math.max(1, PLAYER_RADIUS * 0.5);
    const substeps = Math.max(1, Math.ceil(totalMoveDist / maxSubstepDist));
    const substepMs = dtMs / substeps;

    for (let i = 0; i < substeps; i++) {
        const stepDx = vx * (substepMs / 1000);
        const stepDy = vy * (substepMs / 1000);
        ({ x, y } = sweepPlayerMove(x, y, stepDx, stepDy, grid));
        ({ x, y } = resolvePlayerCollisions(x, y, grid, vx, vy));
    }

    return { x, y, vx, vy, dashVx, dashVy, dashTimeLeftMs };
}
export const PLAYER_HEALTH_MAX = 100;

// Projectile constants
export const BULLET_DAMAGE = 10;
export const BULLET_MAX_RANGE = 800;
export const ARROW_MIN_DAMAGE = 5;
export const ARROW_MAX_DAMAGE = 20;
export const ARROW_MAX_RANGE = 1000;

// WebSocket message types for client <-> server communication
export const MSG = {
    PLAYER_JOIN:    'player_join',
    PLAYER_LEAVE:   'player_leave',
    PLAYER_INPUT:   'player_input',
    PLAYER_EQUIP:   'player_equip',
    POSSESS_REQUEST:'possess_request',
    POSSESS_RELEASE:'possess_release',
    FORCE_CONTROL:  'force_control',
    ENTITY_CONTROL: 'entity_control',
    ENTITY_STATE:   'entity_state',
    WORLD_STATE:    'world_state',
    GAME_STATE:     'game_state',
    STATE_SNAPSHOT: 'state_snapshot',
    LEVEL_CHANGE:   'level_change',
    BULLET_FIRED:    'bullet_fired',
    PLAYER_DAMAGED:  'player_damaged',
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
