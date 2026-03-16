import {
    computeVisibilityPolygon,
    createVisionContext,
    hasLineOfSight,
} from '@clay-and-blood/shared';

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
        return computeVisibilityPolygon(grid, originX, originY, createVisionContext({
            sightRadius: radius,
            rayCount,
        }));
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
        return hasLineOfSight(grid, x1, y1, x2, y2, createVisionContext({
            sightRadius: maxRange === Infinity ? Number.POSITIVE_INFINITY : maxRange,
        }));
    }
}
