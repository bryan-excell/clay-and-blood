import { Component } from './Component.js';
import { eventBus } from '../core/EventBus.js';
import { getItemDef } from '../data/ItemRegistry.js';

function toEntryKey(entry) {
    return `${entry.definitionId}|${entry.category}|${entry.upgradeLevel}`;
}

export class InventoryComponent extends Component {
    constructor({ gold = 0, entries = [] } = {}) {
        super('inventory');
        this._gold = Number.isFinite(gold) ? Math.max(0, Math.floor(gold)) : 0;
        this._entries = [];
        this._nextEntryId = 1;

        for (const entry of entries) {
            this.addEntry(entry.definitionId, entry.category, entry.quantity, entry.upgradeLevel);
        }
    }

    get gold() {
        return this._gold;
    }

    get entries() {
        return this._entries.map((entry) => ({ ...entry }));
    }

    getEntriesByCategory(category) {
        return this._entries
            .filter((entry) => entry.category === category)
            .map((entry) => ({ ...entry }));
    }

    getTotalQuantityByDefinitionId(definitionId) {
        return this._entries.reduce((sum, entry) => (
            entry.definitionId === definitionId ? sum + entry.quantity : sum
        ), 0);
    }

    addGold(amount) {
        if (!Number.isFinite(amount) || amount <= 0) return;
        this._gold += Math.floor(amount);
        this._emitChanged();
    }

    addEntry(definitionId, category, quantity = 1, upgradeLevel = 0) {
        if (typeof definitionId !== 'string' || !definitionId) return null;
        if (typeof category !== 'string' || !category) return null;
        if (!Number.isFinite(quantity) || quantity <= 0) return null;

        const normalized = {
            definitionId,
            category,
            quantity: Math.max(1, Math.floor(quantity)),
            upgradeLevel: Number.isFinite(upgradeLevel) ? Math.max(0, Math.floor(upgradeLevel)) : 0,
        };
        const existing = this._entries.find((entry) => toEntryKey(entry) === toEntryKey(normalized));
        if (existing) {
            existing.quantity += normalized.quantity;
            this._emitChanged();
            return { ...existing };
        }

        const entry = {
            entryId: `inv_${String(this._nextEntryId).padStart(6, '0')}`,
            ...normalized,
        };
        this._nextEntryId += 1;
        this._entries.push(entry);
        this._entries.sort((a, b) => a.entryId.localeCompare(b.entryId));
        this._emitChanged();
        return { ...entry };
    }

    removeQuantity(entryId, amount = 1) {
        if (typeof entryId !== 'string' || !entryId) return false;
        if (!Number.isFinite(amount) || amount <= 0) return false;
        const index = this._entries.findIndex((entry) => entry.entryId === entryId);
        if (index === -1) return false;
        const entry = this._entries[index];
        entry.quantity -= Math.max(1, Math.floor(amount));
        if (entry.quantity <= 0) {
            this._entries.splice(index, 1);
        }
        this._emitChanged();
        return true;
    }

    findConsumableEntryByDefinitionId(definitionId) {
        return this._entries
            .filter((entry) => entry.category === 'consumable' && entry.definitionId === definitionId && entry.quantity > 0)
            .sort((a, b) => a.entryId.localeCompare(b.entryId))[0] ?? null;
    }

    applySnapshot(snapshot = null) {
        if (!snapshot || typeof snapshot !== 'object') return;
        this._gold = Number.isFinite(snapshot.gold) ? Math.max(0, Math.floor(snapshot.gold)) : 0;
        const entries = Array.isArray(snapshot.entries) ? snapshot.entries : [];
        this._entries = entries
            .map((entry) => ({
                entryId: typeof entry.entryId === 'string' ? entry.entryId : `inv_${String(this._nextEntryId++).padStart(6, '0')}`,
                definitionId: typeof entry.definitionId === 'string' ? entry.definitionId : '',
                category: typeof entry.category === 'string' ? entry.category : (getItemDef(entry.definitionId)?.category ?? ''),
                quantity: Number.isFinite(entry.quantity) ? Math.max(0, Math.floor(entry.quantity)) : 0,
                upgradeLevel: Number.isFinite(entry.upgradeLevel) ? Math.max(0, Math.floor(entry.upgradeLevel)) : 0,
            }))
            .filter((entry) => entry.definitionId && entry.category && entry.quantity > 0)
            .sort((a, b) => a.entryId.localeCompare(b.entryId));
        for (const entry of this._entries) {
            const match = /^inv_(\d+)$/.exec(entry.entryId);
            if (!match) continue;
            const value = Number.parseInt(match[1], 10);
            if (Number.isFinite(value)) {
                this._nextEntryId = Math.max(this._nextEntryId, value + 1);
            }
        }
        this._emitChanged();
    }

    _emitChanged() {
        eventBus.emit('inventory:changed', {
            entityId: this.entity?.id ?? null,
            gold: this._gold,
            entries: this.entries,
        });
    }
}
