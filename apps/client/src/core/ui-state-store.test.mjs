import assert from 'node:assert/strict';
import { uiStateStore } from './UiStateStore.js';
import { createDefaultControlledEntityState } from './uiStateSchema.js';

export function runUiStateStoreTests() {
    uiStateStore.reset();

    let notifications = 0;
    let keyNotifications = 0;
    const unsubAll = uiStateStore.subscribe(() => { notifications += 1; });
    const unsubKey = uiStateStore.subscribeKey('controlledEntity', () => { keyNotifications += 1; });

    const next = {
        ...createDefaultControlledEntityState(),
        entityId: 'entity-1',
        hp: 42,
        hpMax: 100,
    };
    const changed = uiStateStore.set('controlledEntity', next);

    assert.equal(changed, true);
    assert.equal(uiStateStore.get('controlledEntity').entityId, 'entity-1');
    assert.equal(uiStateStore.get('controlledEntity').hp, 42);
    assert.equal(notifications, 1);
    assert.equal(keyNotifications, 1);

    unsubAll();
    unsubKey();
}

export function runUiStateStoreShallowEqualTests() {
    uiStateStore.reset();

    let notifications = 0;
    const unsub = uiStateStore.subscribeKey('controlledEntity', () => { notifications += 1; });

    const value = {
        ...createDefaultControlledEntityState(),
        entityId: 'entity-2',
        hp: 55,
        hpMax: 100,
    };
    uiStateStore.set('controlledEntity', value);
    const changed = uiStateStore.set('controlledEntity', { ...value });

    assert.equal(changed, false);
    assert.equal(notifications, 1);

    unsub();
}
