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
import { InventoryComponent } from '../../components/InventoryComponent.js';
import { SpellbookComponent } from '../../components/SpellbookComponent.js';
import { ExitTraversalComponent } from '../../components/ExitTraversalComponent.js';
import { STAGE_RENDER_DEPTH } from '../../config.js';
import { ARCHETYPE_CONFIG } from '@clay-and-blood/shared';

/**
 * Practice possession target in town square.
 */
export function createGolem(scene, config = {}) {
    const {
        id = 'golem',
        x = 0,
        y = 0,
        radius = 20,
        color = 0x8a8f99,
        controlMode = 'remote',
        controllerId = null,
        authority = 'client',
        ownerId = null
    } = config;

    const golem = scene.entityFactory.createEntity(id);
    golem.type = 'golem';

    golem.addComponent(new TransformComponent(x, y));
    const circle = new CircleComponent(radius, color, 1, 0x2f3238, 4);
    golem.addComponent(circle);
    circle.gameObject?.setDepth(STAGE_RENDER_DEPTH.actors);
    golem.addComponent(new ControlComponent({ controlMode, controllerId }));
    golem.addComponent(new AuthorityComponent({ authority, ownerId }));
    golem.addComponent(new IntentComponent());
    golem.addComponent(new StatsComponent({
        hp: ARCHETYPE_CONFIG.golem.resources.hp.max,
        hpMax: ARCHETYPE_CONFIG.golem.resources.hp.max,
        mana: ARCHETYPE_CONFIG.golem.resources.mana.max,
        manaMax: ARCHETYPE_CONFIG.golem.resources.mana.max,
        stamina: ARCHETYPE_CONFIG.golem.resources.stamina.max,
        staminaMax: ARCHETYPE_CONFIG.golem.resources.stamina.max,
    }));
    golem.addComponent(new ExitTraversalComponent({ canUseExits: true }));
    golem.addComponent(new InventoryComponent({ gold: 0, entries: [] }));
    golem.addComponent(new SpellbookComponent({ knownSpells: [] }));
    golem.addComponent(new LoadoutComponent({
        weapons:     ['unarmed', 'bow', 'longsword'],
        spells:      [],
        consumables: ['nothing', 'gold_pouch', 'healing_gem', 'magic_dew'],
        armorSets:   [],
        accessories: [],
        equipped: { weaponId: 'unarmed', spellId: 'nothing', armorSetId: null, accessoryId: null },
    }));

    // Attached now so future control-switching can drive this entity immediately.
    golem.addComponent(new KeyboardInputComponent());
    golem.addComponent(new PlayerStateMachine());
    golem.addComponent(new PlayerCombatComponent());
    golem.addComponent(new VisibilityComponent(ARCHETYPE_CONFIG.golem.sightRadius));

    return golem;
}
