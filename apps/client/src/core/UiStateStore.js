import { createDefaultUiState } from './uiStateSchema.js';

function shallowEqualObjects(a, b) {
    if (a === b) return true;
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;

    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length) return false;

    for (const key of aKeys) {
        if (a[key] !== b[key]) return false;
    }
    return true;
}

class UiStateStore {
    constructor() {
        this._state = createDefaultUiState();
        this._listeners = new Set();
        this._keyListeners = new Map();
    }

    getState() {
        return this._state;
    }

    get(key) {
        return this._state[key];
    }

    set(key, value) {
        const prev = this._state[key];
        const unchanged = typeof value === 'object' && value !== null
            ? shallowEqualObjects(prev, value)
            : prev === value;
        if (unchanged) return false;

        this._state = { ...this._state, [key]: value };
        this._notify(key, value, prev);
        return true;
    }

    patch(nextState) {
        let changed = false;
        let next = this._state;
        const changedKeys = [];

        for (const [key, value] of Object.entries(nextState)) {
            const prevValue = next[key];
            const unchanged = typeof value === 'object' && value !== null
                ? shallowEqualObjects(prevValue, value)
                : prevValue === value;
            if (unchanged) continue;

            next = { ...next, [key]: value };
            changed = true;
            changedKeys.push([key, value, prevValue]);
        }

        if (!changed) return false;

        this._state = next;
        for (const [key, value, prevValue] of changedKeys) {
            this._notifyKey(key, value, prevValue);
        }
        this._notifyAll();
        return true;
    }

    reset() {
        this._state = createDefaultUiState();
        this._notifyAll();
    }

    subscribe(listener) {
        this._listeners.add(listener);
        return () => this._listeners.delete(listener);
    }

    subscribeKey(key, listener) {
        if (!this._keyListeners.has(key)) {
            this._keyListeners.set(key, new Set());
        }
        const listeners = this._keyListeners.get(key);
        listeners.add(listener);
        return () => {
            listeners.delete(listener);
            if (listeners.size === 0) this._keyListeners.delete(key);
        };
    }

    _notify(key, value, prev) {
        this._notifyKey(key, value, prev);
        this._notifyAll();
    }

    _notifyKey(key, value, prev) {
        const listeners = this._keyListeners.get(key);
        if (!listeners || listeners.size === 0) return;
        listeners.forEach(listener => listener(value, prev));
    }

    _notifyAll() {
        this._listeners.forEach(listener => listener(this._state));
    }
}

export const uiStateStore = new UiStateStore();
