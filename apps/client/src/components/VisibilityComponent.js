import { Component } from './Component.js';
import { VisibilitySystem } from '../world/VisibilitySystem.js';
import { eventBus } from '../core/EventBus.js';

/**
 * Gives an entity a field-of-view / visibility polygon.
 *
 * Each update cycle this component:
 *   1. Reads the entity's transform position.
 *   2. Calls VisibilitySystem.compute() against the current level grid.
 *   3. Stores the resulting polygon on itself.
 *   4. Emits 'visibility:updated' so downstream systems (LightingRenderer,
 *      future AI awareness systems, etc.) can react without coupling here.
 *
 * The component is deliberately unaware of rendering.  Any number of listeners
 * can subscribe to 'visibility:updated' independently.
 *
 * Stealth / AI API
 * ----------------
 *   component.canSee(otherEntity)
 *     – precise line-of-sight + range check via the tile grid.
 *       Does NOT depend on the pre-computed polygon; it performs a fresh
 *       raycast so it is always accurate even between polygon updates.
 *
 * Configuration
 * -------------
 *   radius          – sight distance in world units
 *   rayCount        – rays per update; 360 gives degree-level precision
 *   updateInterval  – ms between recomputes; 0 means every fixedUpdate tick.
 *                     Raise this for non-player entities to reduce CPU cost.
 *   enabled         – toggle the whole system on/off at runtime
 */
export class VisibilityComponent extends Component {
    /**
     * @param {number} radius          - Sight radius in world units (default 300)
     * @param {object} [options]
     * @param {number} [options.rayCount=360]       - Rays cast per update
     * @param {number} [options.updateInterval=0]   - ms between updates; 0 = every frame
     */
    constructor(radius = 300, { rayCount = 360, updateInterval = 0 } = {}) {
        super('visibility');

        this.radius         = radius;
        this.rayCount       = rayCount;
        this.updateInterval = updateInterval;
        this.enabled        = true;

        /** @type {{x:number,y:number}[]} Current visibility polygon in world space */
        this.polygon = [];

        this._elapsed = 0;

        this.requireComponent('transform');
    }

    // -------------------------------------------------------------------------
    // Component lifecycle
    // -------------------------------------------------------------------------

    update(deltaTime) {
        if (!this.enabled) return;

        this._elapsed += deltaTime;
        if (this._elapsed < this.updateInterval) return;
        this._elapsed = 0;

        const grid = this.entity.scene.levelManager?.currentLevel?.grid;
        if (!grid) {
            console.warn('[Visibility] grid is null/undefined — skipping update');
            return;
        }

        const transform = this.entity.getComponent('transform');
        const { x, y } = transform.position;

        // Log if player position lands inside a wall tile (root cause suspect)
        const tileX = Math.floor(x / 64); // TILE_SIZE
        const tileY = Math.floor(y / 64);
        const inBounds = tileY >= 0 && tileY < grid.length && tileX >= 0 && tileX < grid[0].length;
        const tileVal = inBounds ? grid[tileY][tileX] : -1;
        if (tileVal === 1) {
            console.warn(`[Visibility] PLAYER IS INSIDE A WALL TILE at world (${x.toFixed(1)}, ${y.toFixed(1)}) → tile (${tileX}, ${tileY})`);
        }

        const { polygon } = VisibilitySystem.compute(grid, x, y, this.radius, this.rayCount);
        this.polygon = polygon;

        // Detect degenerate polygon (all points at same location or NaN)
        const hasNaN = polygon.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y));
        if (hasNaN) {
            console.error(`[Visibility] Polygon contains NaN/Infinite points! pos=(${x.toFixed(1)}, ${y.toFixed(1)})`);
        }

        eventBus.emit('visibility:updated', {
            entityId: this.entity.id,
            polygon,
            x,
            y,
            radius: this.radius,
        });
    }

    // -------------------------------------------------------------------------
    // Public API
    // -------------------------------------------------------------------------

    /**
     * Test whether this entity has an unobstructed line of sight to another.
     * Performs a fresh tile-grid raycast — not a polygon lookup — so the result
     * is always precise regardless of the polygon update interval.
     *
     * Intended for stealth detection, AI awareness, and attack validation.
     *
     * @param {import('../entities/Entity.js').Entity} otherEntity
     * @returns {boolean}
     */
    canSee(otherEntity) {
        const grid = this.entity.scene.levelManager?.currentLevel?.grid;
        if (!grid) return false;

        const myTransform    = this.entity.getComponent('transform');
        const theirTransform = otherEntity.getComponent('transform');
        if (!myTransform || !theirTransform) return false;

        return VisibilitySystem.lineOfSight(
            grid,
            myTransform.position.x,
            myTransform.position.y,
            theirTransform.position.x,
            theirTransform.position.y,
            this.radius,
        );
    }
}
