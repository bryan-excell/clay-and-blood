import { TransformComponent } from '../../components/TransformComponent.js';
import { CircleComponent } from '../../components/CircleComponent.js';
import { ParticleComponent } from '../../components/ParticleComponent.js';
import { STAGE_RENDER_DEPTH, DEBUG_VISUAL_ANCHORS_DEFAULT } from '../../config.js';

export function createWarmFire(scene, config = {}) {
    const {
        id,
        x = 0,
        y = 0,
        radius = 18,
    } = config;

    const fire = scene.entityFactory.createEntity(id);
    fire.type = 'warm_fire';

    fire.addComponent(new TransformComponent(x, y));
    const circle = new CircleComponent(radius, 0xffa046, DEBUG_VISUAL_ANCHORS_DEFAULT ? 0.85 : 0, 0x5a1e00, 5);
    fire.addComponent(circle);
    circle.gameObject?.setDepth(STAGE_RENDER_DEPTH.interactables);
    fire.addComponent(new ParticleComponent('warm_fire'));

    return fire;
}
