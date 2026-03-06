import { TransformComponent } from '../../components/TransformComponent.js';
import { CircleComponent } from '../../components/CircleComponent.js';
import { BulletComponent } from '../../components/BulletComponent.js';
import { BULLET_RADIUS, BULLET_DAMAGE, BULLET_MAX_RANGE } from '../../config.js';

/**
 * Creates a bullet entity.
 * Bullets are kinematic — they have no physics body.
 * Collision with walls is handled by BulletComponent via DDA raycasting.
 *
 * @param {Phaser.Scene} scene
 * @param {object} config
 * @param {number} config.x         - Spawn world X
 * @param {number} config.y         - Spawn world Y
 * @param {number} config.velocityX - Horizontal speed (px/s)
 * @param {number} config.velocityY - Vertical speed (px/s)
 * @param {number} [config.damage]
 * @param {number} [config.maxRange]
 * @param {number} [config.color]
 * @param {number} [config.radius]
 */
export function createBullet(scene, config = {}) {
    const {
        x = 0,
        y = 0,
        velocityX = 0,
        velocityY = 0,
        damage = BULLET_DAMAGE,
        maxRange = BULLET_MAX_RANGE,
        color = 0xff8822, // Ember/fire orange
        radius = BULLET_RADIUS,
    } = config;

    const bullet = scene.entityFactory.createEntity();
    bullet.type = 'bullet';

    bullet.addComponent(new TransformComponent(x, y));
    bullet.addComponent(new CircleComponent(radius, color));
    bullet.addComponent(new BulletComponent(velocityX, velocityY, damage, maxRange));

    return bullet;
}
