import { eventBus } from './EventBus.js';
import { uiStateStore } from './UiStateStore.js';

export class NetworkUiAdapter {
    constructor() {
        this._unsubscribeSnapshot = null;
        this._unsubscribeDisconnected = null;
        this._unsubscribeToast = null;
        this._started = false;
    }

    start() {
        if (this._started) return;
        this._started = true;

        this._unsubscribeSnapshot = eventBus.on('network:stateSnapshot', ({ self }) => {
            if (!self) return;
            uiStateStore.set('networkSelf', {
                sessionId: self.sessionId ?? null,
                controlledEntityKey: typeof self.controlledEntityKey === 'string' ? self.controlledEntityKey : null,
                resources: self.resources ?? null,
                buffs: Array.isArray(self.buffs) ? self.buffs : [],
                inventory: self.inventory ?? null,
                spellbook: self.spellbook ?? null,
                loadout: self.loadout ?? null,
            });
        });

        this._unsubscribeDisconnected = eventBus.on('network:disconnected', () => {
            uiStateStore.set('networkSelf', null);
        });
        this._unsubscribeToast = eventBus.on('network:toast', ({ message, durationMs }) => {
            eventBus.emit('toast:enqueue', { message, durationMs });
        });
    }

    stop() {
        if (!this._started) return;
        this._started = false;

        if (this._unsubscribeSnapshot) {
            this._unsubscribeSnapshot();
            this._unsubscribeSnapshot = null;
        }
        if (this._unsubscribeDisconnected) {
            this._unsubscribeDisconnected();
            this._unsubscribeDisconnected = null;
        }
        if (this._unsubscribeToast) {
            this._unsubscribeToast();
            this._unsubscribeToast = null;
        }
    }
}
