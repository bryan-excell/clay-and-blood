import { TransformComponent } from '../../components/TransformComponent.js';
import { CircleComponent } from '../../components/CircleComponent.js';

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
    fire.addComponent(new CircleComponent(radius, 0xffa046, 0.85, 0x5a1e00, 5));

    return fire;
}
