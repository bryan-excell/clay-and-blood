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

export function runUiProjectionBasicProjectionTest() {
    uiStateStore.reset();
    networkManager.sessionId = 's-1';

    const player = makeEntity('player-1', 'player', {
        stats: { hp: 75, hpMax: 100, mana: 10, manaMax: 30, stamina: 20, staminaMax: 40 },
        playerCombat: { currentWeapon: 3 },
    });
    const scene = {
        player,
        getLocallyControlledEntity: () => player,
    };

    const system = new UiProjectionSystem(scene);
    system.update();

    const state = uiStateStore.get('controlledEntity');
    assert.equal(state.entityId, 'player-1');
    assert.equal(state.hp, 75);
    assert.equal(state.hpMax, 100);
    assert.equal(state.currentWeapon, 3);
    assert.equal(state.weapons[2].active, true);
    assert.equal(state.weapons[0].active, false);
}

export function runUiProjectionNetworkOverrideTest() {
    uiStateStore.reset();
    networkManager.sessionId = 's-2';

    const player = makeEntity('player-2', 'player', {
        stats: { hp: 12, hpMax: 50, mana: 0, manaMax: 0, stamina: 0, staminaMax: 0 },
        playerCombat: { currentWeapon: 1 },
    });
    uiStateStore.set('networkSelf', { sessionId: 's-2', hp: 88, hpMax: 120 });

    const scene = {
        player,
        getLocallyControlledEntity: () => player,
    };

    const system = new UiProjectionSystem(scene);
    system.update();

    const state = uiStateStore.get('controlledEntity');
    assert.equal(state.hp, 88);
    assert.equal(state.hpMax, 120);
}

export function runUiProjectionPossessionGuardTest() {
    uiStateStore.reset();
    networkManager.sessionId = 's-3';

    const player = makeEntity('player-3', 'player', {
        stats: { hp: 65, hpMax: 100, mana: 0, manaMax: 0, stamina: 0, staminaMax: 0 },
        playerCombat: { currentWeapon: 1 },
    });
    const golem = makeEntity('golem-1', 'golem', {
        stats: { hp: 160, hpMax: 160, mana: 0, manaMax: 0, stamina: 80, staminaMax: 80 },
        playerCombat: { currentWeapon: 4 },
    });
    uiStateStore.set('networkSelf', { sessionId: 's-3', hp: 20, hpMax: 100 });

    const scene = {
        player,
        getLocallyControlledEntity: () => golem,
    };

    const system = new UiProjectionSystem(scene);
    system.update();

    const state = uiStateStore.get('controlledEntity');
    assert.equal(state.entityId, 'golem-1');
    assert.equal(state.hp, 160);
    assert.equal(state.hpMax, 160);
}

export function runUiProjectionImmediateControlChangedTest() {
    uiStateStore.reset();
    networkManager.sessionId = 's-4';

    const player = makeEntity('player-4', 'player', {
        stats: { hp: 90, hpMax: 100, mana: 0, manaMax: 0, stamina: 0, staminaMax: 0 },
        playerCombat: { currentWeapon: 1 },
    });
    const golem = makeEntity('golem-4', 'golem', {
        stats: { hp: 150, hpMax: 160, mana: 0, manaMax: 0, stamina: 50, staminaMax: 80 },
        playerCombat: { currentWeapon: 4 },
    });
    let controlled = player;
    const scene = {
        player,
        getLocallyControlledEntity: () => controlled,
    };

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
