import { TransformComponent } from '../../components/TransformComponent.js';
import { CircleComponent } from '../../components/CircleComponent.js';
import { ParticleComponent } from '../../components/ParticleComponent.js';
import { STAGE_RENDER_DEPTH, DEBUG_VISUAL_ANCHORS_DEFAULT } from '../../config.js';

export function createLoot(scene, config = {}) {
    const {
        id = 'loot',
        x = 0,
        y = 0,
        radius = 10,
        color = 0xf4d789,
    } = config;

    const loot = scene.entityFactory.createEntity(id);
    loot.type = 'loot';
    loot.addComponent(new TransformComponent(x, y));
    const circleComponent = new CircleComponent(radius, color, DEBUG_VISUAL_ANCHORS_DEFAULT ? 0.95 : 0, 0xfff0bc, 2);
    loot.addComponent(circleComponent);
    loot.addComponent(new ParticleComponent('loot'));

    const circle = loot.getComponent('circle');
    if (circle?.gameObject) {
        circle.gameObject.setDepth(STAGE_RENDER_DEPTH.interactables);
        if (DEBUG_VISUAL_ANCHORS_DEFAULT) {
            circle.gameObject.setAlpha(0.85);
            scene.tweens.add({
                targets: circle.gameObject,
                alpha: { from: 0.45, to: 0.95 },
                duration: 700,
                yoyo: true,
                repeat: -1,
                ease: 'Sine.easeInOut',
            });
        }
    }

    return loot;
}
