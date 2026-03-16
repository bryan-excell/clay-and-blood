import { RaycastSystem } from './RaycastSystem.js';
import { tileHasTag } from '@clay-and-blood/shared';
import { TILE_SIZE } from '../config.js';

/**
 * Stateless utility for visibility / field-of-view computation.
 *
 * Two distinct concerns are intentionally kept separate here:
 *
 *   compute()      – builds a world-space visibility polygon by casting rays
 *                    in all directions.  Consumed by LightingRenderer for the
 *                    fog-of-war effect, but the data is generic enough to drive
 *                    any system that needs a "what can I see" shape.
 *
 *   lineOfSight()  – fast boolean check between two world points.  Designed
 *                    for game-logic queries such as stealth detection, AI
 *                    awareness, and ranged-attack validation.
 *
 * All coordinates are world-space pixels.  The grid uses the same conventions
 * as RaycastSystem: 1 = solid wall, anything else is passable.
 */
export class VisibilitySystem {
    /**
     * Compute a visibility polygon from an origin point.
     *
     * Rays are cast evenly across the full 360 degrees.  Each ray either
     * terminates at the first wall it hits or at the maximum radius.  The
     * resulting array of endpoint positions, taken in angular order, forms a
     * star-shaped polygon that exactly describes the visible area.
     *
     * @param {number[][]} grid       - Tile grid (0=floor, 1=wall, 2=exit …)
     * @param {number}     originX    - Observer world X
     * @param {number}     originY    - Observer world Y
     * @param {number}     radius     - Maximum sight distance in world units
     * @param {number}    [rayCount=360] - Number of rays; higher = smoother edges
     * @returns {{ polygon: {x:number,y:number}[] }}
     */
    static compute(grid, originX, originY, radius, rayCount = 360) {
        const polygon = [];
        const step = (Math.PI * 2) / rayCount;
        const originInConcealment = this._isConcealmentAtWorldPosition(grid, originX, originY);

        for (let i = 0; i < rayCount; i++) {
            const angle = i * step;
            const endX  = originX + Math.cos(angle) * radius;
            const endY  = originY + Math.sin(angle) * radius;

            const hit = this._castVisibilityRay(grid, originX, originY, endX, endY, {
                originInConcealment,
            });
            polygon.push(hit ? { x: hit.x, y: hit.y } : { x: endX, y: endY });
        }

        return { polygon };
    }

    /**
     * Test whether two world-space points share an unobstructed line of sight
     * through the tile grid.
     *
     * Optionally gated by a maximum range so callers don't need to pre-filter
     * by distance themselves.
     *
     * @param {number[][]} grid
     * @param {number}     x1
     * @param {number}     y1
     * @param {number}     x2
     * @param {number}     y2
     * @param {number}    [maxRange=Infinity]
     * @returns {boolean}  true if the path is clear and within range
     */
    static lineOfSight(grid, x1, y1, x2, y2, maxRange = Infinity) {
        if (maxRange !== Infinity) {
            const dx = x2 - x1;
            const dy = y2 - y1;
            if (dx * dx + dy * dy > maxRange * maxRange) return false;
        }
        const originInConcealment = this._isConcealmentAtWorldPosition(grid, x1, y1);
        return this._castVisibilityRay(grid, x1, y1, x2, y2, { originInConcealment }) === null;
    }

    static _isConcealmentTile(tile) {
        return tileHasTag(tile, 'concealment');
    }

    static _isConcealmentAtWorldPosition(grid, x, y) {
        const tile = this._tileAtWorldPosition(grid, x, y);
        return tile != null && this._isConcealmentTile(tile);
    }

    static _tileAtWorldPosition(grid, x, y) {
        if (!Array.isArray(grid) || grid.length === 0 || !Array.isArray(grid[0])) return null;
        if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
        const tileX = Math.floor(x / TILE_SIZE);
        const tileY = Math.floor(y / TILE_SIZE);
        if (tileY < 0 || tileY >= grid.length || tileX < 0 || tileX >= grid[0].length) return null;
        return grid[tileY][tileX];
    }

    static _castVisibilityRay(grid, x1, y1, x2, y2, { originInConcealment = false } = {}) {
        if (!Array.isArray(grid) || grid.length === 0 || !Array.isArray(grid[0])) return null;

        const wallHit = RaycastSystem.cast(grid, x1, y1, x2, y2);
        if (originInConcealment) return wallHit;

        const rows = grid.length;
        const cols = grid[0].length;
        const dx = x2 - x1;
        const dy = y2 - y1;
        const rayLen = Math.sqrt(dx * dx + dy * dy);
        if (rayLen < 0.0001) return null;

        const rdx = dx / rayLen;
        const rdy = dy / rayLen;
        let mapX = Math.floor(x1 / TILE_SIZE);
        let mapY = Math.floor(y1 / TILE_SIZE);
        const stepX = rdx >= 0 ? 1 : -1;
        const stepY = rdy >= 0 ? 1 : -1;
        const deltaDX = rdx !== 0 ? Math.abs(TILE_SIZE / rdx) : Infinity;
        const deltaDY = rdy !== 0 ? Math.abs(TILE_SIZE / rdy) : Infinity;

        let sideDistX;
        if (rdx > 0) sideDistX = ((mapX + 1) * TILE_SIZE - x1) / rdx;
        else if (rdx < 0) sideDistX = (x1 - mapX * TILE_SIZE) / (-rdx);
        else sideDistX = Infinity;

        let sideDistY;
        if (rdy > 0) sideDistY = ((mapY + 1) * TILE_SIZE - y1) / rdy;
        else if (rdy < 0) sideDistY = (y1 - mapY * TILE_SIZE) / (-rdy);
        else sideDistY = Infinity;

        let side = -1;
        let isFirstTile = true;

        while (true) {
            if (!(mapX >= 0) || mapX >= cols || !(mapY >= 0) || mapY >= rows) return wallHit;

            if (!isFirstTile && this._isConcealmentTile(grid[mapY][mapX])) {
                const entryT = side === 0 ? sideDistX - deltaDX : sideDistY - deltaDY;
                if (entryT > rayLen) return wallHit;

                const concealmentHit = {
                    x: x1 + rdx * entryT,
                    y: y1 + rdy * entryT,
                    tileX: mapX,
                    tileY: mapY,
                    normal: side === 0 ? { x: -stepX, y: 0 } : { x: 0, y: -stepY },
                    distance: entryT,
                };

                if (!wallHit || concealmentHit.distance < wallHit.distance) return concealmentHit;
                return wallHit;
            }

            isFirstTile = false;

            if (sideDistX < sideDistY) {
                if (sideDistX > rayLen) return wallHit;
                side = 0;
                mapX += stepX;
                sideDistX += deltaDX;
            } else {
                if (sideDistY > rayLen) return wallHit;
                side = 1;
                mapY += stepY;
                sideDistY += deltaDY;
            }
        }
    }
}
