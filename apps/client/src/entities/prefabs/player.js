import { TransformComponent } from "../../components/TransformComponent.js";
import { CircleComponent } from '../../components/CircleComponent.js';
import { KeyboardInputComponent } from '../../components/KeyboardInputComponent.js';
import { PlayerStateMachine } from '../../components/PlayerStateMachine.js';
import { PlayerCombatComponent } from '../../components/PlayerCombatComponent.js';
import { VisibilityComponent } from '../../components/VisibilityComponent.js';
import { ControlComponent } from '../../components/ControlComponent.js';
import { AuthorityComponent } from '../../components/AuthorityComponent.js';
import { IntentComponent } from '../../components/IntentComponent.js';
import { StatsComponent } from '../../components/StatsComponent.js';
import { LoadoutComponent } from '../../components/LoadoutComponent.js';
import { ExitTraversalComponent } from '../../components/ExitTraversalComponent.js';
import { PLAYER_RADIUS, COLOR_PLAYER } from '../../config.js';
import { PLAYER_HEALTH_MAX } from '@clay-and-blood/shared';

/**
 * Creates a player entity with the updated component architecture
 * @param {Phaser.Scene} scene - The scene this entity belongs to
 * @param {object} config - Configuration options
 * @returns {Entity} The created player entity
 */
export function createPlayer(scene, config = {}) {
    const {
        x = 0,
        y = 0,
        radius = PLAYER_RADIUS,
        color = COLOR_PLAYER,
        controlMode = 'local',
        controllerId = null,
        authority = 'client',
        ownerId = null
    } = config;

    const player = scene.entityFactory.createEntity('player');
    player.type = 'player'; // Mark as player type for easier filtering

    // Add components in dependency order:

    // 1. First add the transform (foundation for other components)
    player.addComponent(new TransformComponent(x, y));

    // 2. Add the visual representation (creates the Phaser game object)
    // Warm torchlight fill with dark outline
    player.addComponent(new CircleComponent(radius, color, 1, 0x5c3a00, 3));

    // 3. Add control, authority, and resolved intent data
    player.addComponent(new ControlComponent({ controlMode, controllerId }));
    player.addComponent(new AuthorityComponent({ authority, ownerId }));
    player.addComponent(new IntentComponent());
    player.addComponent(new StatsComponent({ hp: PLAYER_HEALTH_MAX, hpMax: PLAYER_HEALTH_MAX }));
    player.addComponent(new ExitTraversalComponent({ canUseExits: true }));
    player.addComponent(new LoadoutComponent({
        weapons:     ['unarmed', 'bow', 'sword'],
        spells:      ['nothing', 'possess', 'imposing_flame', 'gelid_cradle', 'arc_flash'],
        armorSets:   [],
        accessories: ['cape'],
        equipped: { weaponId: 'bow', spellId: 'possess', armorSetId: null, accessoryId: 'cape' },
    }));

    // 4. Add input handling
    player.addComponent(new KeyboardInputComponent());

    // 5. Add the state machine to control movement and attacks
    player.addComponent(new PlayerStateMachine());
    player.addComponent(new PlayerCombatComponent());

    // 6. Field of view - drives lighting and future stealth/AI systems
    player.addComponent(new VisibilityComponent(320));

    // Set up camera following
    const objectComponent = player.getComponent('circle');
    if (objectComponent && objectComponent.gameObject) {
        scene.cameras.main.startFollow(objectComponent.gameObject);
    }

    return player;
}
