import { TILE_SIZE } from '../config.js';

/**
 * Grid-based raycasting utility using the DDA (Digital Differential Analysis) algorithm.
 *
 * All coordinates are in world space. The tile grid uses value 1 for walls.
 * This is the authoritative collision system for fast-moving objects like bullets —
 * it has zero tunneling regardless of velocity because it traces the full path of
 * travel rather than checking discrete positions.
 */
export class RaycastSystem {
    /**
     * Cast a ray segment from (x1, y1) to (x2, y2) through the tile grid.
     * Returns the first wall tile hit, or null if the path is clear.
     *
     * The starting tile is skipped so that objects originating on a floor tile
     * adjacent to a wall don't immediately collide with themselves.
     *
     * @param {number[][]} grid - 2D tile grid (0=floor, 1=wall, 2=exit)
     * @param {number} x1 - Ray start world X
     * @param {number} y1 - Ray start world Y
     * @param {number} x2 - Ray end world X
     * @param {number} y2 - Ray end world Y
     * @returns {{ x: number, y: number, tileX: number, tileY: number, normal: {x:number,y:number}, distance: number } | null}
     */
    static cast(grid, x1, y1, x2, y2) {
        const rows = grid.length;
        const cols = grid[0].length;

        const dx = x2 - x1;
        const dy = y2 - y1;
        const rayLen = Math.sqrt(dx * dx + dy * dy);
        if (rayLen < 0.0001) return null;

        // Unit direction vector
        const rdx = dx / rayLen;
        const rdy = dy / rayLen;

        // Starting tile
        let mapX = Math.floor(x1 / TILE_SIZE);
        let mapY = Math.floor(y1 / TILE_SIZE);

        // Step direction per axis
        const stepX = rdx >= 0 ? 1 : -1;
        const stepY = rdy >= 0 ? 1 : -1;

        // How far along the ray (in world units) to cross one full tile on each axis
        const deltaDX = rdx !== 0 ? Math.abs(TILE_SIZE / rdx) : Infinity;
        const deltaDY = rdy !== 0 ? Math.abs(TILE_SIZE / rdy) : Infinity;

        // Distance to the first tile boundary crossing on each axis
        let sideDistX, sideDistY;
        if (rdx > 0) {
            sideDistX = ((mapX + 1) * TILE_SIZE - x1) / rdx;
        } else if (rdx < 0) {
            sideDistX = (x1 - mapX * TILE_SIZE) / (-rdx);
        } else {
            sideDistX = Infinity;
        }
        if (rdy > 0) {
            sideDistY = ((mapY + 1) * TILE_SIZE - y1) / rdy;
        } else if (rdy < 0) {
            sideDistY = (y1 - mapY * TILE_SIZE) / (-rdy);
        } else {
            sideDistY = Infinity;
        }

        // 0 = last crossed an X boundary, 1 = last crossed a Y boundary
        let side = -1;
        let isFirstTile = true;

        while (true) {
            // Bounds check (also catches NaN, which passes all < / >= comparisons)
            if (!(mapX >= 0) || mapX >= cols || !(mapY >= 0) || mapY >= rows) return null;

            // Check current tile — skip the starting tile (bullet origin)
            if (!isFirstTile && grid[mapY][mapX] === 1) {
                // Entry distance: how far along the ray we were when we crossed into this tile
                const entryT = side === 0 ? sideDistX - deltaDX : sideDistY - deltaDY;

                // If the wall entry is beyond the ray endpoint, no hit in range
                if (entryT > rayLen) return null;

                const hitX = x1 + rdx * entryT;
                const hitY = y1 + rdy * entryT;
                const normal = side === 0 ? { x: -stepX, y: 0 } : { x: 0, y: -stepY };

                return { x: hitX, y: hitY, tileX: mapX, tileY: mapY, normal, distance: entryT };
            }

            isFirstTile = false;

            // Advance to the next tile boundary
            if (sideDistX < sideDistY) {
                if (sideDistX > rayLen) return null;
                side = 0;
                mapX += stepX;
                sideDistX += deltaDX;
            } else {
                if (sideDistY > rayLen) return null;
                side = 1;
                mapY += stepY;
                sideDistY += deltaDY;
            }
        }
    }
}
