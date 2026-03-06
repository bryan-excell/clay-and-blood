import { TransformComponent } from "../../components/TransformComponent.js";
import { CircleComponent } from '../../components/CircleComponent.js';
import { KeyboardInputComponent } from '../../components/KeyboardInputComponent.js';
import { PlayerStateMachine } from '../../components/PlayerStateMachine.js';
import { PlayerCombatComponent } from '../../components/PlayerCombatComponent.js';
import { VisibilityComponent } from '../../components/VisibilityComponent.js';
import { ControlComponent } from '../../components/ControlComponent.js';
import { AuthorityComponent } from '../../components/AuthorityComponent.js';
import { IntentComponent } from '../../components/IntentComponent.js';

/**
 * Practice possession target in town square.
 */
export function createGolem(scene, config = {}) {
    const {
        x = 0,
        y = 0,
        radius = 20,
        color = 0x8a8f99,
        controlMode = 'remote',
        controllerId = null,
        authority = 'client',
        ownerId = null
    } = config;

    const golem = scene.entityFactory.createEntity('golem');
    golem.type = 'golem';

    golem.addComponent(new TransformComponent(x, y));
    golem.addComponent(new CircleComponent(radius, color, 1, 0x2f3238, 4));
    golem.addComponent(new ControlComponent({ controlMode, controllerId }));
    golem.addComponent(new AuthorityComponent({ authority, ownerId }));
    golem.addComponent(new IntentComponent());

    // Attached now so future control-switching can drive this entity immediately.
    golem.addComponent(new KeyboardInputComponent());
    golem.addComponent(new PlayerStateMachine());
    golem.addComponent(new PlayerCombatComponent());
    golem.addComponent(new VisibilityComponent(260));

    return golem;
}
