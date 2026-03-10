import { eventBus } from './EventBus.js';
import { uiStateStore } from './UiStateStore.js';

export class NetworkUiAdapter {
    constructor() {
        this._unsubscribeSnapshot = null;
        this._unsubscribeDisconnected = null;
        this._started = false;
    }

    start() {
        if (this._started) return;
        this._started = true;

        this._unsubscribeSnapshot = eventBus.on('network:stateSnapshot', ({ self }) => {
            if (!self) return;
            uiStateStore.set('networkSelf', {
                sessionId: self.sessionId ?? null,
                hp: Number.isFinite(self.hp) ? self.hp : 0,
                hpMax: Number.isFinite(self.hpMax) ? self.hpMax : 1,
                buffs: Array.isArray(self.buffs) ? self.buffs : [],
            });
        });

        this._unsubscribeDisconnected = eventBus.on('network:disconnected', () => {
            uiStateStore.set('networkSelf', null);
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
    }
}
