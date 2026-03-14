import assert from 'node:assert/strict';
import { LoadoutComponent } from './LoadoutComponent.js';

function makeLoadout() {
    return new LoadoutComponent({
        weapons: ['bow', 'longsword'],
        spells: ['possess', 'imposing_flame'],
        consumables: ['gold_pouch', 'healing_gem'],
        accessories: [],
        armorSets: [],
        equipped: {
            weaponId: 'bow',
            spellId: 'possess',
            armorSetId: null,
            accessoryId: null,
        },
    });
}

export function runLoadoutKitAssignmentTest() {
    const loadout = makeLoadout();

    assert.deepEqual(loadout.weaponSlots, ['bow', 'unarmed', 'unarmed']);
    assert.deepEqual(loadout.spellSlots, ['possess', 'nothing', 'nothing']);

    loadout.assignWeaponSlot(1, 'longsword');
    loadout.assignSpellSlot(2, 'imposing_flame');

    assert.deepEqual(loadout.weaponSlots, ['bow', 'longsword', 'unarmed']);
    assert.deepEqual(loadout.spellSlots, ['possess', 'nothing', 'imposing_flame']);
    assert.equal(loadout.equipped.weaponId, 'bow');
    assert.equal(loadout.equipped.spellId, 'possess');
}

export function runLoadoutKitActivationAndCyclingTest() {
    const loadout = makeLoadout();

    loadout.assignWeaponSlot(1, 'longsword');
    loadout.assignSpellSlot(1, 'imposing_flame');
    loadout.activateWeaponSlot(1);
    loadout.activateSpellSlot(1);

    assert.equal(loadout.activeWeaponSlotIndex, 1);
    assert.equal(loadout.activeSpellSlotIndex, 1);
    assert.equal(loadout.equipped.weaponId, 'longsword');
    assert.equal(loadout.equipped.spellId, 'imposing_flame');

    loadout.cycleWeaponSlot();
    loadout.cycleSpellSlot();

    assert.equal(loadout.activeWeaponSlotIndex, 2);
    assert.equal(loadout.activeSpellSlotIndex, 2);
    assert.equal(loadout.equipped.weaponId, 'unarmed');
    assert.equal(loadout.equipped.spellId, 'nothing');
}

export function runLoadoutActiveSlotReassignTest() {
    const loadout = makeLoadout();

    loadout.assignWeaponSlot(0, 'unarmed');
    loadout.assignSpellSlot(0, 'nothing');

    assert.equal(loadout.equipped.weaponId, 'unarmed');
    assert.equal(loadout.equipped.spellId, 'nothing');
    assert.deepEqual(loadout.weaponSlots, ['unarmed', 'unarmed', 'unarmed']);
    assert.deepEqual(loadout.spellSlots, ['nothing', 'nothing', 'nothing']);
}
