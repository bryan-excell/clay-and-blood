import { Component } from './Component.js';
import { eventBus } from '../core/EventBus.js';
import { WEAPONS, SPELLS, ACCESSORIES, ARMOR_SETS } from '../data/ItemRegistry.js';

/**
 * Declares what items an entity has available and which are currently equipped.
 *
 * All dual-bind conflict resolution lives here (last UI click wins):
 *   - Equipping a 'both'-bind weapon  → clears spell slot to 'nothing'
 *   - Equipping a 'both'-bind spell   → resets weapon slot to 'unarmed'
 *   - Equipping a single-bind spell while a 'both' weapon is active → resets weapon to 'unarmed'
 *   - Equipping a single-bind weapon while a 'both' spell is active → clears spell to 'nothing'
 *
 * Emits 'loadout:changed' on every equip change.
 */
export class LoadoutComponent extends Component {
    /**
     * @param {object}   config
     * @param {string[]} config.weapons     - Weapon ids available. 'unarmed' is always prepended if absent.
     * @param {string[]} config.spells      - Spell ids available. 'nothing' is always prepended if absent.
     * @param {string[]} config.armorSets   - Armor set ids available.
     * @param {string[]} config.accessories - Accessory ids available.
     * @param {object}   config.equipped    - Initial equipped id map.
     */
    constructor({
        weapons     = [],
        spells      = [],
        armorSets   = [],
        accessories = [],
        equipped    = {},
    } = {}) {
        super('loadout');

        // Implicit fallbacks are always at the front.
        this._weapons     = weapons.includes('unarmed') ? [...weapons] : ['unarmed', ...weapons];
        this._spells      = spells.includes('nothing')  ? [...spells]  : ['nothing', ...spells];
        this._armorSets   = [...armorSets];
        this._accessories = [...accessories];

        this._equipped = {
            weaponId:    equipped.weaponId    ?? this._weapons[0]     ?? 'unarmed',
            spellId:     equipped.spellId     ?? this._spells[0]      ?? 'nothing',
            armorSetId:  equipped.armorSetId  ?? this._armorSets[0]   ?? null,
            accessoryId: equipped.accessoryId ?? this._accessories[0] ?? null,
        };
    }

    // ------------------------------------------------------------------
    // Read accessors
    // ------------------------------------------------------------------

    get weapons()     { return this._weapons; }
    get spells()      { return this._spells; }
    get armorSets()   { return this._armorSets; }
    get accessories() { return this._accessories; }

    /** Returns a shallow copy so callers cannot mutate internal state. */
    get equipped() { return { ...this._equipped }; }

    getEquippedWeapon()    { return WEAPONS[this._equipped.weaponId]        ?? WEAPONS.unarmed; }
    getEquippedSpell()     { return SPELLS[this._equipped.spellId]          ?? SPELLS.nothing;  }
    getEquippedArmor()     { return ARMOR_SETS[this._equipped.armorSetId]   ?? null; }
    getEquippedAccessory() { return ACCESSORIES[this._equipped.accessoryId] ?? null; }

    /**
     * True if any equipped accessory defines the given spacebar action.
     * @param {'dash'} action
     */
    hasSpacebarAction(action) {
        return this.getEquippedAccessory()?.spacebarAction === action;
    }

    // ------------------------------------------------------------------
    // Equip methods
    // ------------------------------------------------------------------

    /**
     * Equip a weapon by id.
     * Resolves dual-bind conflicts before applying the change.
     * @param {string} id
     */
    equipWeapon(id) {
        if (!this._weapons.includes(id)) return;
        const prevWeaponId = this._equipped.weaponId;
        const prevSpellId = this._equipped.spellId;
        const def = WEAPONS[id] ?? WEAPONS.unarmed;

        if (def.mouseUsage === 'both') {
            // Dual-bind weapon owns both buttons — displace the spell slot.
            this._equipped.weaponId = id;
            this._equipped.spellId  = 'nothing';
        } else {
            // Single-bind weapon: if a dual-bind spell is currently equipped, clear it first.
            if ((SPELLS[this._equipped.spellId]?.mouseUsage ?? 'right') === 'both') {
                this._equipped.spellId = 'nothing';
            }
            this._equipped.weaponId = id;
        }

        if (this._equipped.weaponId === prevWeaponId && this._equipped.spellId === prevSpellId) return;
        this._emitChanged();
    }

    /**
     * Equip a spell by id.
     * Resolves dual-bind conflicts before applying the change.
     * @param {string} id
     */
    equipSpell(id) {
        if (!this._spells.includes(id)) return;
        const prevWeaponId = this._equipped.weaponId;
        const prevSpellId = this._equipped.spellId;
        const def = SPELLS[id] ?? SPELLS.nothing;

        if (def.mouseUsage === 'both') {
            // Dual-bind spell owns both buttons — reset the weapon slot.
            this._equipped.spellId  = id;
            this._equipped.weaponId = 'unarmed';
        } else {
            // Single-bind spell: if a dual-bind weapon is currently equipped, reset it first.
            if ((WEAPONS[this._equipped.weaponId]?.mouseUsage ?? 'left') === 'both') {
                this._equipped.weaponId = 'unarmed';
            }
            this._equipped.spellId = id;
        }

        if (this._equipped.weaponId === prevWeaponId && this._equipped.spellId === prevSpellId) return;
        this._emitChanged();
    }

    /**
     * Equip an armor set by id.
     * @param {string} id
     */
    equipArmor(id) {
        if (!this._armorSets.includes(id)) return;
        if (this._equipped.armorSetId === id) return;
        this._equipped.armorSetId = id;
        this._emitChanged();
    }

    /**
     * Equip an accessory by id.
     * @param {string} id
     */
    equipAccessory(id) {
        if (!this._accessories.includes(id)) return;
        if (this._equipped.accessoryId === id) return;
        this._equipped.accessoryId = id;
        this._emitChanged();
    }

    addTemporarySpell(id) {
        if (!id || this._spells.includes(id)) return;
        this._spells.push(id);
        this._emitChanged();
    }

    removeTemporarySpell(id) {
        if (!id) return;
        const idx = this._spells.indexOf(id);
        if (idx === -1) return;
        this._spells.splice(idx, 1);
        if (this._equipped.spellId === id) {
            this._equipped.spellId = 'nothing';
        }
        this._emitChanged();
    }

    /**
     * Apply equipped ids received from the network for this entity.
     * This updates local state without re-emitting loadout:changed.
     * @param {{ weaponId?:string, spellId?:string, armorSetId?:string|null, accessoryId?:string|null }} equipped
     */
    applyNetworkEquipped(equipped) {
        if (!equipped || typeof equipped !== 'object') return;

        const nextWeaponId = this._weapons.includes(equipped.weaponId) ? equipped.weaponId : 'unarmed';
        const nextSpellId = this._spells.includes(equipped.spellId) ? equipped.spellId : 'nothing';
        const nextArmorSetId = this._armorSets.includes(equipped.armorSetId) ? equipped.armorSetId : null;
        const nextAccessoryId = this._accessories.includes(equipped.accessoryId) ? equipped.accessoryId : null;

        this._equipped.weaponId = nextWeaponId;
        this._equipped.spellId = nextSpellId;
        this._equipped.armorSetId = nextArmorSetId;
        this._equipped.accessoryId = nextAccessoryId;
    }

    // ------------------------------------------------------------------
    // Internal
    // ------------------------------------------------------------------

    _emitChanged() {
        eventBus.emit('loadout:changed', {
            entityId: this.entity?.id,
            equipped: this.equipped,
        });
    }
}
