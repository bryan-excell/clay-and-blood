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
        const isPrimaryLocalPlayer = controlled.id === this.scene.player?.id;
        const canApplyNetworkSelf  = !!networkSelf &&
            isPrimaryLocalPlayer &&
            networkSelf.sessionId === (networkManager.sessionId ?? null);

        const hp    = canApplyNetworkSelf ? networkSelf.hp    : (stats?.hp    ?? 0);
        const hpMax = canApplyNetworkSelf ? networkSelf.hpMax : (stats?.hpMax ?? 0);

        return {
            entityId:   controlled.id,
            entityType: controlled.type,
            sessionId:  networkManager.sessionId ?? null,
            hp,
            hpMax,
            mana:       stats?.mana       ?? 0,
            manaMax:    stats?.manaMax    ?? 0,
            stamina:    stats?.stamina    ?? 0,
            staminaMax: stats?.staminaMax ?? 0,
            buffs: EMPTY_BUFFS,
            // Full item defs are resolved here so the UI layer doesn't need
            // to import ItemRegistry directly.
            loadout: loadout ? {
                weapons:     resolveItems(loadout.weapons,     WEAPONS),
                spells:      resolveItems(loadout.spells,      SPELLS),
                armorSets:   resolveItems(loadout.armorSets,   ARMOR_SETS),
                accessories: resolveItems(loadout.accessories, ACCESSORIES),
                equipped:    loadout.equipped,
            } : null,
        };
    }
}
