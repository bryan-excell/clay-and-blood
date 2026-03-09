import { TransformComponent } from '../../components/TransformComponent.js';
import { CircleComponent } from '../../components/CircleComponent.js';
import { StatsComponent } from '../../components/StatsComponent.js';
import { VisibilityComponent } from '../../components/VisibilityComponent.js';
import { ARCHETYPE_CONFIG } from '@clay-and-blood/shared';

/**
 * Zombie enemy shell driven by authoritative server world state.
 */
export function createZombie(scene, config = {}) {
    const {
        id,
        x = 0,
        y = 0,
        radius = 18,
        color = 0x5a8c55,     // sickly green
        strokeColor = 0x1a2a1a,
    } = config;

    const zombie = scene.entityFactory.createEntity(id);
    zombie.type = 'zombie';

    zombie.addComponent(new TransformComponent(x, y));
    zombie.addComponent(new CircleComponent(radius, color, 1, strokeColor, 4));
    zombie.addComponent(new StatsComponent({ hp: 50, hpMax: 50, stamina: 0, staminaMax: 0 }));
    zombie.addComponent(new VisibilityComponent(ARCHETYPE_CONFIG.zombie.sightRadius, { updateInterval: 200, rayCount: 120 }));

    return zombie;
}
