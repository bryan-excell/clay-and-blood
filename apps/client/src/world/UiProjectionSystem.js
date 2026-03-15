import { eventBus } from '../core/EventBus.js';
import { networkManager } from '../core/NetworkManager.js';
import { uiStateStore } from '../core/UiStateStore.js';
import { createDefaultControlledEntityState } from '../core/uiStateSchema.js';
import { gameState } from '../core/GameState.js';
import { WEAPONS, SPELLS, ACCESSORIES, ARMOR_SETS, CONSUMABLES, RESOURCES, getItemDef } from '../data/ItemRegistry.js';
import { TILE_SIZE, getRegionDefinition, getStageDefinition } from '@clay-and-blood/shared';

const EMPTY_BUFFS = Object.freeze([]);

// Resolve an array of item ids to full item definition objects.
// Falls back to a minimal stub for any id not found in the registry.
function resolveItems(ids, registry) {
    const list = Array.isArray(ids) ? ids : [];
    return list.map(id => registry[id] ?? { id, name: id.charAt(0).toUpperCase() + id.slice(1) });
}

function resolveInventoryRows(entries = [], loadout = null) {
    const rows = entries.map((entry) => {
        const definition = getItemDef(entry.definitionId) ?? { id: entry.definitionId, name: entry.definitionId };
        const isAssigned = loadout
            ? (loadout.weaponSlots?.includes(entry.definitionId) ||
                loadout.consumableSlots?.includes(entry.definitionId) ||
                loadout.equipped?.armorSetId === entry.definitionId ||
                loadout.equipped?.accessoryId === entry.definitionId)
            : false;
        return {
            entryId: entry.entryId,
            definitionId: entry.definitionId,
            category: entry.category,
            displayName: definition.name ?? entry.definitionId,
            quantity: entry.quantity,
            upgradeLevel: entry.upgradeLevel ?? 0,
            canSell: !!definition.baseSellable && !isAssigned,
            canDrop: !!definition.baseDroppable && !isAssigned,
        };
    });

    return {
        weapons: rows.filter((entry) => entry.category === 'weapon'),
        armor: rows.filter((entry) => entry.category === 'armor'),
        accessories: rows.filter((entry) => entry.category === 'accessory'),
        consumables: rows.filter((entry) => entry.category === 'consumable'),
        resources: rows.filter((entry) => entry.category === 'resource'),
    };
}

export class UiProjectionSystem {
    constructor(scene) {
        this.scene = scene;
        this._unsubscribeControlChanged = null;
        this._unsubscribeLoadoutChanged = null;
        this._unsubscribeLoadoutKitChanged = null;
        this._unsubscribeInventoryChanged = null;
        this._unsubscribeSpellbookChanged = null;
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
        this._unsubscribeInventoryChanged = eventBus.on('inventory:changed', ({ entityId }) => {
            const controlled = this.scene.getLocallyControlledEntity?.();
            if (controlled?.id !== entityId) return;
            this.publishImmediate();
        });
        this._unsubscribeSpellbookChanged = eventBus.on('spellbook:changed', ({ entityId }) => {
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
        if (this._unsubscribeInventoryChanged) {
            this._unsubscribeInventoryChanged();
            this._unsubscribeInventoryChanged = null;
        }
        if (this._unsubscribeSpellbookChanged) {
            this._unsubscribeSpellbookChanged();
            this._unsubscribeSpellbookChanged = null;
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
        const worldDebug = this._buildWorldDebugState();
        uiStateStore.patch({
            controlledEntity: next,
            worldDebug,
        });
    }

    _buildControlledEntityState() {
        const controlled = this.scene.getLocallyControlledEntity?.();
        if (!controlled) return createDefaultControlledEntityState();

        const stats   = controlled.getComponent('stats');
        const loadout = controlled.getComponent('loadout');
        const inventory = controlled.getComponent('inventory');
        const spellbook = controlled.getComponent('spellbook');

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
        const projectedLoadout = loadout ? {
            weapons: resolveItems(loadout.weapons, WEAPONS),
            spells: resolveItems(loadout.spells, SPELLS),
            armorSets: resolveItems(loadout.armorSets, ARMOR_SETS),
            accessories: resolveItems(loadout.accessories, ACCESSORIES),
            consumables: resolveItems(loadout.consumables, CONSUMABLES),
            weaponSlots: resolveItems(loadout.weaponSlots, WEAPONS),
            spellSlots: resolveItems(loadout.spellSlots, SPELLS),
            consumableSlots: (loadout.consumableSlots ?? []).map((id) => {
                const definition = CONSUMABLES[id] ?? null;
                const quantity = canApplyNetworkSelf
                    ? (networkSelf?.inventory?.entries ?? []).reduce((sum, entry) => (
                        entry.category === 'consumable' && entry.definitionId === id ? sum + (entry.quantity ?? 0) : sum
                    ), 0)
                    : (inventory?.getTotalQuantityByDefinitionId(id) ?? 0);
                return {
                    id,
                    name: definition?.name ?? (id === 'nothing' ? 'Nothing' : id),
                    quantity,
                    isDepleted: quantity <= 0 && id !== 'nothing',
                };
            }),
            activeWeaponSlotIndex: loadout.activeWeaponSlotIndex,
            activeSpellSlotIndex: loadout.activeSpellSlotIndex,
            activeConsumableSlotIndex: loadout.activeConsumableSlotIndex,
            equipped: loadout.equipped,
            selectedConsumableDefinitionId: loadout.consumableSlots?.[loadout.activeConsumableSlotIndex] ?? 'nothing',
        } : null;
        const projectedInventorySource = canApplyNetworkSelf
            ? (networkSelf?.inventory ?? null)
            : (inventory ? { gold: inventory.gold, entries: inventory.entries } : null);
        const projectedSpellbookSource = canApplyNetworkSelf
            ? (networkSelf?.spellbook ?? null)
            : (spellbook ? { knownSpells: spellbook.knownSpells } : null);
        const inventoryRows = projectedInventorySource
            ? resolveInventoryRows(projectedInventorySource.entries ?? [], projectedLoadout)
            : { weapons: [], armor: [], accessories: [], consumables: [], resources: [] };

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
            loadout: projectedLoadout,
            inventory: projectedInventorySource ? {
                gold: projectedInventorySource.gold ?? 0,
                ...inventoryRows,
            } : null,
            spellbook: projectedSpellbookSource ? {
                knownSpells: (projectedSpellbookSource.knownSpells ?? []).map((entry) => ({
                    spellId: entry.spellId,
                    displayName: SPELLS[entry.spellId]?.name ?? entry.spellId,
                    upgradeLevel: entry.upgradeLevel ?? 0,
                })),
            } : null,
        };
    }

    _buildWorldDebugState() {
        const controlled = this.scene.getLocallyControlledEntity?.();
        const transform = controlled?.getComponent('transform');
        const stageSlug = transform?.levelId ?? gameState.currentLevelId ?? null;
        const stage = stageSlug ? getStageDefinition(stageSlug) : null;
        const region = stage?.regionId ? getRegionDefinition(stage.regionId) : null;

        return {
            stageSlug,
            stageUuid: stage?.stageUuid ?? null,
            displayName: stage?.displayName ?? null,
            stageKind: stage?.kind ?? null,
            regionId: stage?.regionId ?? null,
            regionName: region?.displayName ?? null,
            tileX: Number.isFinite(transform?.position?.x) ? Math.floor(transform.position.x / TILE_SIZE) : null,
            tileY: Number.isFinite(transform?.position?.y) ? Math.floor(transform.position.y / TILE_SIZE) : null,
        };
    }
}
