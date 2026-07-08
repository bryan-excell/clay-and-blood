import { Component } from './Component.js';
import { eventBus } from '../core/EventBus.js';
import {
    ACTION_WEAPONS,
    WEAPONS,
    SPELLS,
    ACCESSORIES,
    ARMOR_SETS,
    CONSUMABLES,
} from '../data/ItemRegistry.js';

const ACTION_SLOT_COUNT = 4;
const CONSUMABLE_SLOT_COUNT = 1;

function uniqueValid(ids, registry) {
    const result = [];
    for (const id of Array.isArray(ids) ? ids : []) {
        if (typeof id !== 'string' || !registry[id] || result.includes(id)) continue;
        result.push(id);
    }
    return result;
}

function clampSlotIndex(value, maxExclusive) {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(maxExclusive - 1, Math.floor(value)));
}

function isSpellAction(id) {
    return typeof id === 'string' && id !== 'nothing' && !!SPELLS[id];
}

/**
 * Declares what action items and equipment an entity can use.
 *
 * The player-facing model is now four unified action weapon slots. Legacy
 * weaponId/spellId equipped fields are still emitted for server and combat
 * compatibility during the migration.
 */
export class LoadoutComponent extends Component {
    constructor({
        weapons = [],
        spells = [],
        actionWeapons = [],
        actionSlots = [],
        activeActionSlotIndex = 0,
        consumables = [],
        armorSets = [],
        accessories = [],
        equipped = {},
    } = {}) {
        super('loadout');

        this._weapons = uniqueValid(
            weapons.includes('unarmed') ? weapons : ['unarmed', ...weapons],
            WEAPONS
        );
        this._spells = uniqueValid(
            spells.includes('nothing') ? spells : ['nothing', ...spells],
            SPELLS
        );
        this._consumables = ['nothing', ...uniqueValid(consumables.filter((id) => id !== 'nothing'), CONSUMABLES)];
        this._armorSets = uniqueValid(armorSets, ARMOR_SETS);
        this._accessories = uniqueValid(accessories, ACCESSORIES);

        const combinedActionWeapons = [
            ...this._weapons,
            ...this._spells.filter((id) => id !== 'nothing'),
            ...actionWeapons,
        ];
        this._actionWeapons = uniqueValid(
            combinedActionWeapons.includes('unarmed') ? combinedActionWeapons : ['unarmed', ...combinedActionWeapons],
            ACTION_WEAPONS
        );

        const initialActionId = this._resolveInitialActionId(equipped);
        this._actionSlots = Array.from({ length: ACTION_SLOT_COUNT }, (_, index) => (
            this._normalizeActionSlotId(actionSlots[index] ?? (index === 0 ? initialActionId : 'unarmed'))
        ));
        this._activeActionSlotIndex = clampSlotIndex(activeActionSlotIndex, ACTION_SLOT_COUNT);

        this._consumableSlots = Array.from({ length: CONSUMABLE_SLOT_COUNT }, (_, index) => (
            this._normalizeConsumableId(equipped.consumableId ?? (index === 0 ? 'nothing' : 'nothing'))
        ));
        this._activeConsumableSlotIndex = 0;

        this._equipped = {
            weaponId: 'unarmed',
            spellId: 'nothing',
            armorSetId: this._armorSets.includes(equipped.armorSetId) ? equipped.armorSetId : null,
            accessoryId: this._accessories.includes(equipped.accessoryId) ? equipped.accessoryId : null,
        };
        this._applyActionWeaponToEquipped(this._actionSlots[this._activeActionSlotIndex]);
    }

    get weapons() { return this._weapons; }
    get spells() { return this._spells; }
    get actionWeapons() { return [...this._actionWeapons]; }
    get armorSets() { return this._armorSets; }
    get accessories() { return this._accessories; }
    get consumables() { return this._consumables; }
    get actionSlots() { return [...this._actionSlots]; }
    get activeActionSlotIndex() { return this._activeActionSlotIndex; }
    get consumableSlots() { return [...this._consumableSlots]; }
    get activeConsumableSlotIndex() { return this._activeConsumableSlotIndex; }

    // Compatibility accessors for older network/UI paths.
    get weaponSlots() { return this.actionSlots; }
    get spellSlots() { return this.actionSlots.filter((id) => isSpellAction(id)); }
    get activeWeaponSlotIndex() { return this._activeActionSlotIndex; }
    get activeSpellSlotIndex() { return this._activeActionSlotIndex; }

    get equipped() { return { ...this._equipped }; }

    getActiveActionWeaponId() {
        return this._actionSlots[this._activeActionSlotIndex] ?? 'unarmed';
    }

    getActiveActionWeapon() {
        return ACTION_WEAPONS[this.getActiveActionWeaponId()] ?? ACTION_WEAPONS.unarmed;
    }

    getEquippedWeapon() { return WEAPONS[this._equipped.weaponId] ?? WEAPONS.unarmed; }
    getEquippedSpell() { return SPELLS[this._equipped.spellId] ?? SPELLS.nothing; }
    getEquippedArmor() { return ARMOR_SETS[this._equipped.armorSetId] ?? null; }
    getEquippedAccessory() { return ACCESSORIES[this._equipped.accessoryId] ?? null; }
    getSelectedConsumable() {
        return CONSUMABLES[this._consumableSlots[this._activeConsumableSlotIndex]] ?? CONSUMABLES.nothing ?? null;
    }

    hasSpacebarAction(action) {
        return this.getEquippedAccessory()?.spacebarAction === action;
    }

    equipWeapon(id) {
        if (!this._weapons.includes(id)) return;
        const changed = this._applyActionWeaponToEquipped(id);
        if (changed) this._emitChanged();
    }

    equipSpell(id) {
        if (!this._spells.includes(id)) return;
        const changed = this._applyActionWeaponToEquipped(id);
        if (changed) this._emitChanged();
    }

    equipArmor(id) {
        if (id == null) {
            if (this._equipped.armorSetId == null) return;
            this._equipped.armorSetId = null;
            this._emitChanged();
            return;
        }
        if (!this._armorSets.includes(id)) return;
        if (this._equipped.armorSetId === id) return;
        this._equipped.armorSetId = id;
        this._emitChanged();
    }

    equipAccessory(id) {
        if (id == null) {
            if (this._equipped.accessoryId == null) return;
            this._equipped.accessoryId = null;
            this._emitChanged();
            return;
        }
        if (!this._accessories.includes(id)) return;
        if (this._equipped.accessoryId === id) return;
        this._equipped.accessoryId = id;
        this._emitChanged();
    }

    assignActionSlot(slotIndex, id) {
        if (!this._isValidActionSlotIndex(slotIndex)) return;
        const actionId = this._normalizeActionSlotId(id);
        if (!this._actionWeapons.includes(actionId)) return;
        if (this._actionSlots[slotIndex] === actionId) return;

        this._actionSlots[slotIndex] = actionId;
        let equippedChanged = false;
        if (slotIndex === this._activeActionSlotIndex) {
            equippedChanged = this._applyActionWeaponToEquipped(actionId);
            if (equippedChanged) this._emitChanged();
        }
        this._emitKitChanged();
    }

    activateActionSlot(slotIndex) {
        if (!this._isValidActionSlotIndex(slotIndex)) return;
        const previousIndex = this._activeActionSlotIndex;
        const actionId = this._actionSlots[slotIndex] ?? 'unarmed';
        this._activeActionSlotIndex = slotIndex;
        const equippedChanged = this._applyActionWeaponToEquipped(actionId);

        if (equippedChanged) this._emitChanged();
        if (previousIndex !== slotIndex || equippedChanged) this._emitKitChanged();
    }

    cycleActionSlot() {
        this.activateActionSlot((this._activeActionSlotIndex + 1) % this._actionSlots.length);
    }

    assignWeaponSlot(slotIndex, weaponId) {
        this.assignActionSlot(slotIndex, weaponId);
    }

    assignSpellSlot(slotIndex, spellId) {
        this.assignActionSlot(slotIndex, spellId);
    }

    activateWeaponSlot(slotIndex) {
        this.activateActionSlot(slotIndex);
    }

    activateSpellSlot(slotIndex) {
        this.activateActionSlot(slotIndex);
    }

    cycleWeaponSlot() {
        this.cycleActionSlot();
    }

    cycleSpellSlot() {
        this.cycleActionSlot();
    }

    assignConsumableSlot(slotIndex, definitionId) {
        if (!this._isValidConsumableSlotIndex(slotIndex)) return;
        const id = this._normalizeConsumableId(definitionId);
        if (!this._consumables.includes(id)) return;
        if (this._consumableSlots[slotIndex] === id) return;
        this._consumableSlots[slotIndex] = id;
        this._emitKitChanged();
    }

    activateConsumableSlot(slotIndex) {
        if (!this._isValidConsumableSlotIndex(slotIndex)) return;
        if (this._activeConsumableSlotIndex === slotIndex) return;
        this._activeConsumableSlotIndex = slotIndex;
        this._emitKitChanged();
    }

    cycleConsumableSlot() {
        this.activateConsumableSlot(0);
    }

    addTemporarySpell(id) {
        if (!id || this._spells.includes(id)) return;
        if (!SPELLS[id] || !ACTION_WEAPONS[id]) return;
        this._spells.push(id);
        if (!this._actionWeapons.includes(id)) this._actionWeapons.push(id);
        this._emitKitChanged();
    }

    removeTemporarySpell(id) {
        if (!id) return;
        const spellIndex = this._spells.indexOf(id);
        if (spellIndex !== -1) this._spells.splice(spellIndex, 1);

        const actionIndex = this._actionWeapons.indexOf(id);
        if (actionIndex !== -1) this._actionWeapons.splice(actionIndex, 1);

        let replacedSlot = false;
        this._actionSlots = this._actionSlots.map((slotId) => {
            if (slotId !== id) return slotId;
            replacedSlot = true;
            return 'unarmed';
        });

        const equippedChanged = this._equipped.spellId === id
            ? this._applyActionWeaponToEquipped(this._actionSlots[this._activeActionSlotIndex])
            : false;
        if (equippedChanged) this._emitChanged();
        if (spellIndex !== -1 || actionIndex !== -1 || replacedSlot) this._emitKitChanged();
    }

    applyNetworkEquipped(equipped) {
        if (!equipped || typeof equipped !== 'object') return;

        const nextWeaponId = this._weapons.includes(equipped.weaponId) ? equipped.weaponId : 'unarmed';
        const nextSpellId = this._spells.includes(equipped.spellId) ? equipped.spellId : 'nothing';
        const nextArmorSetId = this._armorSets.includes(equipped.armorSetId) ? equipped.armorSetId : null;
        const nextAccessoryId = this._accessories.includes(equipped.accessoryId) ? equipped.accessoryId : null;

        this._equipped.weaponId = nextSpellId !== 'nothing' ? 'unarmed' : nextWeaponId;
        this._equipped.spellId = nextSpellId;
        this._equipped.armorSetId = nextArmorSetId;
        this._equipped.accessoryId = nextAccessoryId;

        const actionId = nextSpellId !== 'nothing' ? nextSpellId : nextWeaponId;
        const matchingSlotIndex = this._actionSlots.indexOf(actionId);
        if (matchingSlotIndex !== -1) this._activeActionSlotIndex = matchingSlotIndex;
    }

    _resolveInitialActionId(equipped) {
        if (this._actionWeapons.includes(equipped.actionWeaponId)) return equipped.actionWeaponId;
        if (this._actionWeapons.includes(equipped.spellId) && equipped.spellId !== 'nothing') return equipped.spellId;
        if (this._actionWeapons.includes(equipped.weaponId)) return equipped.weaponId;
        return this._actionWeapons[0] ?? 'unarmed';
    }

    _normalizeActionSlotId(id) {
        return this._actionWeapons.includes(id) ? id : 'unarmed';
    }

    _normalizeConsumableId(id) {
        return this._consumables.includes(id) ? id : 'nothing';
    }

    _applyActionWeaponToEquipped(actionId) {
        const previousWeaponId = this._equipped.weaponId;
        const previousSpellId = this._equipped.spellId;
        const id = this._normalizeActionSlotId(actionId);

        if (isSpellAction(id)) {
            this._equipped.weaponId = 'unarmed';
            this._equipped.spellId = id;
        } else {
            this._equipped.weaponId = WEAPONS[id] ? id : 'unarmed';
            this._equipped.spellId = 'nothing';
        }

        return previousWeaponId !== this._equipped.weaponId || previousSpellId !== this._equipped.spellId;
    }

    _emitChanged() {
        eventBus.emit('loadout:changed', {
            entityId: this.entity?.id,
            equipped: this.equipped,
        });
    }

    _emitKitChanged() {
        eventBus.emit('loadout:kitChanged', {
            entityId: this.entity?.id,
            actionSlots: this.actionSlots,
            weaponSlots: this.weaponSlots,
            spellSlots: this.spellSlots,
            consumableSlots: this.consumableSlots,
            activeActionSlotIndex: this._activeActionSlotIndex,
            activeWeaponSlotIndex: this._activeActionSlotIndex,
            activeSpellSlotIndex: this._activeActionSlotIndex,
            activeConsumableSlotIndex: this._activeConsumableSlotIndex,
            equipped: this.equipped,
        });
    }

    _isValidActionSlotIndex(slotIndex) {
        return Number.isInteger(slotIndex) && slotIndex >= 0 && slotIndex < ACTION_SLOT_COUNT;
    }

    _isValidConsumableSlotIndex(slotIndex) {
        return Number.isInteger(slotIndex) && slotIndex >= 0 && slotIndex < CONSUMABLE_SLOT_COUNT;
    }
}
