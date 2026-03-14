import { Component } from './Component.js';
import { eventBus } from '../core/EventBus.js';

export class SpellbookComponent extends Component {
    constructor({ knownSpells = [] } = {}) {
        super('spellbook');
        this._knownSpells = [];

        for (const entry of knownSpells) {
            this.addKnownSpell(entry.spellId, entry.upgradeLevel);
        }
    }

    get knownSpells() {
        return this._knownSpells.map((entry) => ({ ...entry }));
    }

    knows(spellId) {
        return this._knownSpells.some((entry) => entry.spellId === spellId);
    }

    getKnownSpells() {
        return this.knownSpells;
    }

    getSpellUpgradeLevel(spellId) {
        return this._knownSpells.find((entry) => entry.spellId === spellId)?.upgradeLevel ?? 0;
    }

    addKnownSpell(spellId, upgradeLevel = 0) {
        if (typeof spellId !== 'string' || !spellId) return;
        if (this.knows(spellId)) return;
        this._knownSpells.push({
            spellId,
            upgradeLevel: Number.isFinite(upgradeLevel) ? Math.max(0, Math.floor(upgradeLevel)) : 0,
        });
        this._knownSpells.sort((a, b) => a.spellId.localeCompare(b.spellId));
        this._emitChanged();
    }

    applySnapshot(snapshot = null) {
        const entries = Array.isArray(snapshot?.knownSpells) ? snapshot.knownSpells : [];
        this._knownSpells = entries
            .map((entry) => ({
                spellId: typeof entry.spellId === 'string' ? entry.spellId : '',
                upgradeLevel: Number.isFinite(entry.upgradeLevel) ? Math.max(0, Math.floor(entry.upgradeLevel)) : 0,
            }))
            .filter((entry) => entry.spellId);
        this._emitChanged();
    }

    _emitChanged() {
        eventBus.emit('spellbook:changed', {
            entityId: this.entity?.id ?? null,
            knownSpells: this.knownSpells,
        });
    }
}
