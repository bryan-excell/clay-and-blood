import { TransformComponent } from '../../components/TransformComponent.js';
import { RectangleComponent } from '../../components/RectangleComponent.js';
import { BulletComponent } from '../../components/BulletComponent.js';
import { BULLET_DAMAGE, ARROW_MAX_RANGE, ARROW_PENETRATION } from '../../config.js';

/**
 * Creates an arrow entity (bow weapon projectile).
 * Arrows are kinematic — same wall-raycasting movement as bullets.
 *
 * @param {Phaser.Scene} scene
 * @param {object} config
 * @param {number} config.x         - Spawn world X
 * @param {number} config.y         - Spawn world Y
 * @param {number} config.velocityX - Horizontal speed (px/s)
 * @param {number} config.velocityY - Vertical speed (px/s)
 * @param {number} config.angle     - Rotation in radians (direction of travel)
 * @param {number} [config.damage]
 * @param {number} [config.maxRange]
 * @param {number} [config.penetration]
 */
export function createArrow(scene, config = {}) {
    const {
        x = 0,
        y = 0,
        velocityX = 0,
        velocityY = 0,
        angle = 0,
        damage = BULLET_DAMAGE,
        maxRange = ARROW_MAX_RANGE,
        penetration = ARROW_PENETRATION,
    } = config;

    const arrow = scene.entityFactory.createEntity();
    arrow.type = 'arrow';

    const transform = new TransformComponent(x, y);
    // Prefer explicit angle from caller; otherwise derive from velocity so
    // replicated spawns stay visually aligned without extra network fields.
    const hasExplicitAngle = Number.isFinite(config.angle);
    const resolvedAngle = hasExplicitAngle ? angle : Math.atan2(velocityY, velocityX);
    transform.setRotation(Number.isFinite(resolvedAngle) ? resolvedAngle : 0);
    arrow.addComponent(transform);

    // Thin rectangle oriented along travel direction
    arrow.addComponent(new RectangleComponent(18, 3, 0xFFDD55));
    arrow.addComponent(new BulletComponent(velocityX, velocityY, damage, maxRange, {
        penetration,
        collidesWithEntities: true,
        targetTypes: ['zombie'],
    }));

    return arrow;
}
