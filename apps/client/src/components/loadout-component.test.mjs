import assert from 'node:assert/strict';
import { LoadoutComponent } from './LoadoutComponent.js';

function makeLoadout() {
    return new LoadoutComponent({
        weapons: ['bow', 'longsword'],
        spells: ['possess', 'imposing_flame'],
        actionSlots: ['bow', 'possess', 'unarmed', 'unarmed'],
        consumables: ['gold_pouch', 'healing_gem'],
        accessories: ['cape'],
        armorSets: ['leather_armor'],
        equipped: {
            weaponId: 'bow',
            spellId: 'nothing',
            armorSetId: 'leather_armor',
            accessoryId: 'cape',
        },
    });
}

export function runLoadoutKitAssignmentTest() {
    const loadout = makeLoadout();

    assert.deepEqual(loadout.actionSlots, ['bow', 'possess', 'unarmed', 'unarmed']);
    assert.deepEqual(loadout.weaponSlots, ['bow', 'possess', 'unarmed', 'unarmed']);

    loadout.assignActionSlot(2, 'longsword');
    loadout.assignActionSlot(3, 'imposing_flame');

    assert.deepEqual(loadout.actionSlots, ['bow', 'possess', 'longsword', 'imposing_flame']);
    assert.equal(loadout.equipped.weaponId, 'bow');
    assert.equal(loadout.equipped.spellId, 'nothing');
}

export function runLoadoutKitActivationAndCyclingTest() {
    const loadout = makeLoadout();

    loadout.assignActionSlot(2, 'longsword');
    loadout.activateActionSlot(1);

    assert.equal(loadout.activeActionSlotIndex, 1);
    assert.equal(loadout.equipped.weaponId, 'unarmed');
    assert.equal(loadout.equipped.spellId, 'possess');

    loadout.cycleActionSlot();

    assert.equal(loadout.activeActionSlotIndex, 2);
    assert.equal(loadout.equipped.weaponId, 'longsword');
    assert.equal(loadout.equipped.spellId, 'nothing');
}

export function runLoadoutActiveSlotReassignTest() {
    const loadout = makeLoadout();

    loadout.assignActionSlot(0, 'imposing_flame');

    assert.equal(loadout.equipped.weaponId, 'unarmed');
    assert.equal(loadout.equipped.spellId, 'imposing_flame');
    assert.deepEqual(loadout.actionSlots, ['imposing_flame', 'possess', 'unarmed', 'unarmed']);

    loadout.assignActionSlot(0, 'unarmed');
    assert.equal(loadout.equipped.weaponId, 'unarmed');
    assert.equal(loadout.equipped.spellId, 'nothing');

    loadout.assignConsumableSlot(0, 'healing_gem');
    assert.deepEqual(loadout.consumableSlots, ['healing_gem']);
    loadout.assignConsumableSlot(0, 'nothing');
    assert.deepEqual(loadout.consumableSlots, ['nothing']);

    loadout.equipArmor(null);
    loadout.equipAccessory(null);
    assert.equal(loadout.equipped.armorSetId, null);
    assert.equal(loadout.equipped.accessoryId, null);
}
