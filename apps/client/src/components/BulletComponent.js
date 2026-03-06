import { Component } from './Component.js';
import { RaycastSystem } from '../world/RaycastSystem.js';
import { gameState } from '../core/GameState.js';

/**
 * Kinematic bullet component.
 *
 * Bullets have NO physics body. They move by directly writing to the
 * TransformComponent each frame. After each move, a DDA raycast checks
 * whether the bullet's path crossed a wall tile. This gives zero tunneling
 * at any velocity.
 *
 * Collision with entities (enemies) is handled via simple circle overlap
 * checks that can be added later.
 */
export class BulletComponent extends Component {
    /**
     * @param {number} velocityX - Horizontal speed in pixels/second
     * @param {number} velocityY - Vertical speed in pixels/second
     * @param {number} damage     - Damage dealt on hit
     * @param {number} maxRange   - Maximum travel distance in pixels before auto-destroy
     */
    constructor(velocityX, velocityY, damage = 10, maxRange = 800) {
        super('bullet');
        this.velocityX = velocityX;
        this.velocityY = velocityY;
        this.damage = damage;
        this.maxRange = maxRange;
        this.distanceTravelled = 0;
        this.dead = false;

        this.requireComponent('transform');
    }

    update(deltaTime) {
        if (this.dead) return;

        const transform = this.entity.getComponent('transform');
        if (!transform) return;

        const dt = deltaTime / 1000; // ms → seconds
        const moveX = this.velocityX * dt;
        const moveY = this.velocityY * dt;

        const prevX = transform.position.x;
        const prevY = transform.position.y;
        const newX = prevX + moveX;
        const newY = prevY + moveY;

        // Raycast the full movement path against the tile grid
        const grid = this._getGrid();
        if (grid) {
            const hit = RaycastSystem.cast(grid, prevX, prevY, newX, newY);
            if (hit) {
                this._onWallHit(hit, transform);
                return;
            }
        }

        // No wall hit — commit the move
        transform.position.x = newX;
        transform.position.y = newY;

        this.distanceTravelled += Math.sqrt(moveX * moveX + moveY * moveY);
        if (this.distanceTravelled >= this.maxRange) {
            this._destroySelf();
        }
    }

    _getGrid() {
        const levelId = gameState.currentLevelId;
        if (!levelId || !gameState.levels || !gameState.levels[levelId]) return null;
        return gameState.levels[levelId].grid;
    }

    _onWallHit(hit, transform) {
        // Snap bullet to the wall surface before destroying
        transform.position.x = hit.x;
        transform.position.y = hit.y;
        this._destroySelf();
    }

    _destroySelf() {
        this.dead = true;
        this.entity.destroy();
    }
}
