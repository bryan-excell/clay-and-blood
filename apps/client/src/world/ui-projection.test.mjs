import assert from 'node:assert/strict';
import { uiStateStore } from '../core/UiStateStore.js';
import { eventBus } from '../core/EventBus.js';
import { networkManager } from '../core/NetworkManager.js';
import { UiProjectionSystem } from './UiProjectionSystem.js';

function makeEntity(id, type, components = {}) {
    return {
        id,
        type,
        getComponent(name) {
            return components[name];
        },
    };
}

// Minimal mock that matches the shape LoadoutComponent exposes.
function makeLoadout(weapons, spells, accessories, equipped) {
    return {
        weapons,
        spells,
        armorSets: [],
        accessories,
        equipped,
    };
}

function attachNetworkKeyResolver(scene) {
    scene._getNetworkEntityKey = (entity) => {
        if (!entity) return null;
        if (entity.id === scene.player?.id) {
            return `player:${networkManager.sessionId ?? ''}`;
        }
        return `world:${entity.id}`;
    };
    return scene;
}

export function runUiProjectionBasicProjectionTest() {
    uiStateStore.reset();
    networkManager.sessionId = 's-1';

    const player = makeEntity('player-1', 'player', {
        stats: { hp: 75, hpMax: 100, mana: 10, manaMax: 30, stamina: 20, staminaMax: 40 },
        loadout: makeLoadout(
            ['unarmed', 'bow'],
            ['nothing', 'possess'],
            ['cape'],
            { weaponId: 'bow', spellId: 'possess', armorSetId: null, accessoryId: 'cape' }
        ),
    });
    const scene = attachNetworkKeyResolver({
        player,
        getLocallyControlledEntity: () => player,
    });

    const system = new UiProjectionSystem(scene);
    system.update();

    const state = uiStateStore.get('controlledEntity');
    assert.equal(state.entityId, 'player-1');
    assert.equal(state.hp, 75);
    assert.equal(state.hpMax, 100);
    // Loadout is resolved to full item defs
    assert.ok(state.loadout, 'loadout should be present');
    assert.equal(state.loadout.equipped.weaponId, 'bow');
    assert.equal(state.loadout.equipped.spellId, 'possess');
    assert.equal(state.loadout.weapons.length, 2);
    assert.equal(state.loadout.weapons[1].id, 'bow');
    assert.equal(state.loadout.spells[1].id, 'possess');
}

export function runUiProjectionNetworkOverrideTest() {
    uiStateStore.reset();
    networkManager.sessionId = 's-2';

    const player = makeEntity('player-2', 'player', {
        stats: { hp: 12, hpMax: 50, mana: 0, manaMax: 0, stamina: 0, staminaMax: 0 },
    });
    uiStateStore.set('networkSelf', {
        sessionId: 's-2',
        controlledEntityKey: 'player:s-2',
        resources: {
            hp: { current: 88, max: 120 },
            mana: { current: 9, max: 20 },
            stamina: { current: 14, max: 60 },
        },
    });

    const scene = attachNetworkKeyResolver({
        player,
        getLocallyControlledEntity: () => player,
    });

    const system = new UiProjectionSystem(scene);
    system.update();

    const state = uiStateStore.get('controlledEntity');
    assert.equal(state.hp, 88);
    assert.equal(state.hpMax, 120);
    assert.equal(state.mana, 9);
    assert.equal(state.stamina, 14);
    assert.equal(state.loadout, null, 'no LoadoutComponent → loadout should be null');
}

export function runUiProjectionPossessionGuardTest() {
    uiStateStore.reset();
    networkManager.sessionId = 's-3';

    const player = makeEntity('player-3', 'player', {
        stats: { hp: 65, hpMax: 100, mana: 0, manaMax: 0, stamina: 0, staminaMax: 0 },
    });
    const golem = makeEntity('golem-1', 'golem', {
        stats: { hp: 160, hpMax: 160, mana: 0, manaMax: 0, stamina: 80, staminaMax: 80 },
        loadout: makeLoadout(
            ['unarmed'],
            ['nothing'],
            [],
            { weaponId: 'unarmed', spellId: 'nothing', armorSetId: null, accessoryId: null }
        ),
    });
    uiStateStore.set('networkSelf', {
        sessionId: 's-3',
        controlledEntityKey: 'player:s-3',
        resources: {
            hp: { current: 20, max: 100 },
            mana: { current: 5, max: 10 },
            stamina: { current: 10, max: 50 },
        },
    });

    const scene = attachNetworkKeyResolver({
        player,
        getLocallyControlledEntity: () => golem,
    });

    const system = new UiProjectionSystem(scene);
    system.update();

    const state = uiStateStore.get('controlledEntity');
    assert.equal(state.entityId, 'golem-1');
    // Golem stats, not networkSelf (networkSelf only applies to the primary player)
    assert.equal(state.hp, 160);
    assert.equal(state.hpMax, 160);
    // Golem's loadout is projected
    assert.ok(state.loadout, 'golem should have a loadout');
    assert.equal(state.loadout.equipped.weaponId, 'unarmed');
    assert.equal(state.loadout.weapons.length, 1);
}

export function runUiProjectionImmediateControlChangedTest() {
    uiStateStore.reset();
    networkManager.sessionId = 's-4';

    const player = makeEntity('player-4', 'player', {
        stats: { hp: 90, hpMax: 100, mana: 0, manaMax: 0, stamina: 0, staminaMax: 0 },
    });
    const golem = makeEntity('golem-4', 'golem', {
        stats: { hp: 150, hpMax: 160, mana: 0, manaMax: 0, stamina: 50, staminaMax: 80 },
    });
    let controlled = player;
    const scene = attachNetworkKeyResolver({
        player,
        getLocallyControlledEntity: () => controlled,
    });

    const system = new UiProjectionSystem(scene);
    system.start();
    system.update();
    assert.equal(uiStateStore.get('controlledEntity').entityId, 'player-4');

    controlled = golem;
    eventBus.emit('control:changed', {
        entityId: 'golem-4',
        controlMode: 'local',
        controllerId: 's-4',
        previousControlMode: 'remote',
        previousControllerId: null,
        reason: 'test',
    });

    assert.equal(uiStateStore.get('controlledEntity').entityId, 'golem-4');
    system.stop();
}
