import { eventBus } from '../core/EventBus.js';
import { networkManager } from '../core/NetworkManager.js';
import { uiStateStore } from '../core/UiStateStore.js';
import { createDefaultControlledEntityState } from '../core/uiStateSchema.js';
import { WEAPONS, SPELLS, ACCESSORIES, ARMOR_SETS } from '../data/ItemRegistry.js';

const EMPTY_BUFFS = Object.freeze([]);

// Resolve an array of item ids to full item definition objects.
// Falls back to a minimal stub for any id not found in the registry.
function resolveItems(ids, registry) {
    return ids.map(id => registry[id] ?? { id, name: id.charAt(0).toUpperCase() + id.slice(1) });
}

export class UiProjectionSystem {
    constructor(scene) {
        this.scene = scene;
        this._unsubscribeControlChanged = null;
        this._unsubscribeLoadoutChanged = null;
        this._unsubscribeLoadoutKitChanged = null;
        this._started = false;
    }

    start() {
        if (this._started) return;
        this._started = true;

        this._unsubscribeControlChanged = eventBus.on('control:changed', () => {
            this.publishImmediate();
        });

        // Republish whenever the controlled entity's loadout changes (equip selection,
        // or possession swap which triggers control:changed → loadout:changed).
        this._unsubscribeLoadoutChanged = eventBus.on('loadout:changed', ({ entityId }) => {
            const controlled = this.scene.getLocallyControlledEntity?.();
            if (controlled?.id !== entityId) return;
            this.publishImmediate();
        });

        this._unsubscribeLoadoutKitChanged = eventBus.on('loadout:kitChanged', ({ entityId }) => {
            const controlled = this.scene.getLocallyControlledEntity?.();
            if (controlled?.id !== entityId) return;
            this.publishImmediate();
        });
    }

    stop() {
        if (!this._started) return;
        this._started = false;

        if (this._unsubscribeControlChanged) {
            this._unsubscribeControlChanged();
            this._unsubscribeControlChanged = null;
        }
        if (this._unsubscribeLoadoutChanged) {
            this._unsubscribeLoadoutChanged();
            this._unsubscribeLoadoutChanged = null;
        }
        if (this._unsubscribeLoadoutKitChanged) {
            this._unsubscribeLoadoutKitChanged();
            this._unsubscribeLoadoutKitChanged = null;
        }
    }

    update() {
        this._publish();
    }

    publishImmediate() {
        this._publish();
    }

    _publish() {
        const next = this._buildControlledEntityState();
        uiStateStore.set('controlledEntity', next);
    }

    _buildControlledEntityState() {
        const controlled = this.scene.getLocallyControlledEntity?.();
        if (!controlled) return createDefaultControlledEntityState();

        const stats   = controlled.getComponent('stats');
        const loadout = controlled.getComponent('loadout');

        const networkSelf = uiStateStore.get('networkSelf');
        const controlledEntityKey = typeof this.scene._getNetworkEntityKey === 'function'
            ? this.scene._getNetworkEntityKey(controlled)
            : null;
        const canApplyNetworkSelf  = !!networkSelf &&
            networkSelf.sessionId === (networkManager.sessionId ?? null) &&
            controlledEntityKey &&
            controlledEntityKey === networkSelf.controlledEntityKey;
        const networkResources = canApplyNetworkSelf ? networkSelf.resources : null;
        const hp = Number.isFinite(networkResources?.hp?.current) ? networkResources.hp.current : (stats?.hp ?? 0);
        const hpMax = Number.isFinite(networkResources?.hp?.max) ? networkResources.hp.max : (stats?.hpMax ?? 0);
        const mana = Number.isFinite(networkResources?.mana?.current) ? networkResources.mana.current : (stats?.mana ?? 0);
        const manaMax = Number.isFinite(networkResources?.mana?.max) ? networkResources.mana.max : (stats?.manaMax ?? 0);
        const stamina = Number.isFinite(networkResources?.stamina?.current) ? networkResources.stamina.current : (stats?.stamina ?? 0);
        const staminaMax = Number.isFinite(networkResources?.stamina?.max) ? networkResources.stamina.max : (stats?.staminaMax ?? 0);
        const buffs = canApplyNetworkSelf && Array.isArray(networkSelf?.buffs)
            ? networkSelf.buffs
            : EMPTY_BUFFS;

        return {
            entityId:   controlled.id,
            entityType: controlled.type,
            sessionId:  networkManager.sessionId ?? null,
            hp,
            hpMax,
            mana,
            manaMax,
            stamina,
            staminaMax,
            buffs,
            // Full item defs are resolved here so the UI layer doesn't need
            // to import ItemRegistry directly.
            loadout: loadout ? {
                weapons:     resolveItems(loadout.weapons,     WEAPONS),
                spells:      resolveItems(loadout.spells,      SPELLS),
                armorSets:   resolveItems(loadout.armorSets,   ARMOR_SETS),
                accessories: resolveItems(loadout.accessories, ACCESSORIES),
                weaponSlots: resolveItems(loadout.weaponSlots, WEAPONS),
                spellSlots: resolveItems(loadout.spellSlots, SPELLS),
                activeWeaponSlotIndex: loadout.activeWeaponSlotIndex,
                activeSpellSlotIndex: loadout.activeSpellSlotIndex,
                equipped:    loadout.equipped,
            } : null,
        };
    }
}
