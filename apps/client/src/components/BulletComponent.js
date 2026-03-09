import { Component } from './Component.js';
import { RaycastSystem } from '../world/RaycastSystem.js';
import { gameState } from '../core/GameState.js';

/**
 * Kinematic projectile component.
 *
 * Projectiles have NO physics body. They move by directly writing to the
 * TransformComponent each frame. After each move, a DDA raycast checks
 * whether the projectile path crossed a solid tile.
 */
export class BulletComponent extends Component {
    /**
     * @param {number} velocityX - Horizontal speed in pixels/second
     * @param {number} velocityY - Vertical speed in pixels/second
     * @param {number} damage     - Damage dealt on hit (client visual only)
     * @param {number} maxRange   - Maximum travel distance in pixels before auto-destroy
     * @param {object} [options]
     * @param {number} [options.penetration=0] - Extra entities this projectile can pass through
     * @param {boolean} [options.collidesWithEntities=false]
     * @param {string[]} [options.targetTypes=['zombie']]
     */
    constructor(velocityX, velocityY, damage = 10, maxRange = 800, options = {}) {
        super('bullet');
        this.velocityX = velocityX;
        this.velocityY = velocityY;
        this.damage = damage;
        this.maxRange = maxRange;

        this.penetration = Math.max(0, Math.floor(options.penetration ?? 0));
        this.remainingPenetration = this.penetration;
        this.collidesWithEntities = !!options.collidesWithEntities;
        this.targetTypes = Array.isArray(options.targetTypes) && options.targetTypes.length > 0
            ? options.targetTypes
            : ['zombie'];
        this._hitEntityIds = new Set();

        this.distanceTravelled = 0;
        this.dead = false;

        this.requireComponent('transform');
    }

    update(deltaTime) {
        if (this.dead) return;

        const transform = this.entity.getComponent('transform');
        if (!transform) return;

        const speed = Math.sqrt(this.velocityX * this.velocityX + this.velocityY * this.velocityY);
        if (speed < 0.001) {
            this._destroySelf();
            return;
        }

        const dt = deltaTime / 1000;
        const dirX = this.velocityX / speed;
        const dirY = this.velocityY / speed;

        let segRemaining = speed * dt;
        let currX = transform.position.x;
        let currY = transform.position.y;
        const grid = this._getGrid();
        const epsilon = 0.01;

        while (!this.dead && segRemaining > epsilon) {
            const endX = currX + dirX * segRemaining;
            const endY = currY + dirY * segRemaining;

            let nearestT = segRemaining + epsilon;
            let wallHit = null;
            let entityHit = null;

            if (grid) {
                const hit = RaycastSystem.cast(grid, currX, currY, endX, endY);
                if (hit && hit.distance < nearestT) {
                    nearestT = hit.distance;
                    wallHit = hit;
                }
            }

            if (this.collidesWithEntities) {
                const hit = this._findEntityHit(currX, currY, this.velocityX, this.velocityY, segRemaining);
                if (hit && hit.distance < nearestT) {
                    nearestT = hit.distance;
                    wallHit = null;
                    entityHit = hit;
                }
            }

            if (!wallHit && !entityHit) {
                currX = endX;
                currY = endY;
                this.distanceTravelled += segRemaining;
                segRemaining = 0;
                break;
            }

            const travel = Math.max(0, nearestT);
            currX += dirX * travel;
            currY += dirY * travel;
            this.distanceTravelled += travel;
            segRemaining -= travel;

            if (wallHit) {
                this._onWallHit(wallHit, transform);
                return;
            }

            if (entityHit) {
                this._hitEntityIds.add(entityHit.entity.id);
                if (this.remainingPenetration > 0) {
                    this.remainingPenetration -= 1;
                    const nudge = Math.min(epsilon, segRemaining);
                    currX += dirX * nudge;
                    currY += dirY * nudge;
                    this.distanceTravelled += nudge;
                    segRemaining -= nudge;
                    continue;
                }
                transform.position.x = currX;
                transform.position.y = currY;
                this._destroySelf();
                return;
            }
        }

        transform.position.x = currX;
        transform.position.y = currY;

        if (this.distanceTravelled >= this.maxRange) {
            this._destroySelf();
        }
    }

    _findEntityHit(ox, oy, vx, vy, maxRange) {
        const manager = this.entity?.scene?.entityManager;
        if (!manager) return null;

        let nearest = null;
        for (const type of this.targetTypes) {
            const entities = manager.getEntitiesByType(type) ?? [];
            for (const entity of entities) {
                if (!entity || entity.id === this.entity.id) continue;
                if (this._hitEntityIds.has(entity.id)) continue;

                const circle = entity.getComponent('circle');
                const transform = entity.getComponent('transform');
                const cx = circle?.gameObject?.x ?? transform?.position?.x;
                const cy = circle?.gameObject?.y ?? transform?.position?.y;
                const radius = circle?.radius ?? 16;

                if (!Number.isFinite(cx) || !Number.isFinite(cy)) continue;
                const t = this._rayHitDistance(ox, oy, vx, vy, cx, cy, radius, maxRange);
                if (t === null) continue;

                if (!nearest || t < nearest.distance) {
                    nearest = { entity, distance: t };
                }
            }
        }

        return nearest;
    }

    _rayHitDistance(ox, oy, vx, vy, cx, cy, radius, maxRange) {
        const speed = Math.sqrt(vx * vx + vy * vy);
        if (speed < 0.001) return null;

        const dx = vx / speed;
        const dy = vy / speed;
        const fx = cx - ox;
        const fy = cy - oy;

        const t = fx * dx + fy * dy;
        if (t < 0 || t > maxRange) return null;

        const distSq = (fx - t * dx) ** 2 + (fy - t * dy) ** 2;
        if (distSq > radius * radius) return null;

        return t;
    }

    _getGrid() {
        const levelId = gameState.currentLevelId;
        if (!levelId || !gameState.levels || !gameState.levels[levelId]) return null;
        return gameState.levels[levelId].grid;
    }

    _onWallHit(hit, transform) {
        transform.position.x = hit.x;
        transform.position.y = hit.y;
        this._destroySelf();
    }

    _destroySelf() {
        this.dead = true;
        this.entity.destroy();
    }
}
