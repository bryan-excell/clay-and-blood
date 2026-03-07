import { TransformComponent } from "../../components/TransformComponent.js";
import { CircleComponent } from '../../components/CircleComponent.js';
import { VisibilityComponent } from '../../components/VisibilityComponent.js';
import { StatsComponent } from '../../components/StatsComponent.js';

/**
 * Basic hostile humanoid shell, driven by authoritative server world state.
 */
export function createBandit(scene, config = {}) {
    const {
        id = 'bandit',
        x = 0,
        y = 0,
        radius = 18,
        color = 0xb14d2f,
    } = config;

    const bandit = scene.entityFactory.createEntity(id);
    bandit.type = 'bandit';

    bandit.addComponent(new TransformComponent(x, y));
    bandit.addComponent(new CircleComponent(radius, color, 1, 0x4f1f14, 4));
    bandit.addComponent(new VisibilityComponent(260));
    bandit.addComponent(new StatsComponent({ hp: 75, hpMax: 75, stamina: 0, staminaMax: 0 }));

    return bandit;
}
