import { eventBus } from '../core/EventBus.js';
import { networkManager } from '../core/NetworkManager.js';
import { uiStateStore } from '../core/UiStateStore.js';
import { createDefaultControlledEntityState } from '../core/uiStateSchema.js';

const EMPTY_BUFFS = Object.freeze([]);
const WEAPON_LABELS = Object.freeze(['1 Bow', '2 Melee', '3 Spear', '4 Possess']);
const WEAPON_STATES_BY_ACTIVE_SLOT = Object.freeze({
    1: Object.freeze([
        Object.freeze({ slot: 1, name: '1 Bow', active: true }),
        Object.freeze({ slot: 2, name: '2 Melee', active: false }),
        Object.freeze({ slot: 3, name: '3 Spear', active: false }),
        Object.freeze({ slot: 4, name: '4 Possess', active: false }),
    ]),
    2: Object.freeze([
        Object.freeze({ slot: 1, name: '1 Bow', active: false }),
        Object.freeze({ slot: 2, name: '2 Melee', active: true }),
        Object.freeze({ slot: 3, name: '3 Spear', active: false }),
        Object.freeze({ slot: 4, name: '4 Possess', active: false }),
    ]),
    3: Object.freeze([
        Object.freeze({ slot: 1, name: '1 Bow', active: false }),
        Object.freeze({ slot: 2, name: '2 Melee', active: false }),
        Object.freeze({ slot: 3, name: '3 Spear', active: true }),
        Object.freeze({ slot: 4, name: '4 Possess', active: false }),
    ]),
    4: Object.freeze([
        Object.freeze({ slot: 1, name: '1 Bow', active: false }),
        Object.freeze({ slot: 2, name: '2 Melee', active: false }),
        Object.freeze({ slot: 3, name: '3 Spear', active: false }),
        Object.freeze({ slot: 4, name: '4 Possess', active: true }),
    ]),
});

export class UiProjectionSystem {
    constructor(scene) {
        this.scene = scene;
        this._unsubscribeControlChanged = null;
        this._unsubscribeWeaponChanged = null;
        this._started = false;
    }

    start() {
        if (this._started) return;
        this._started = true;

        this._unsubscribeControlChanged = eventBus.on('control:changed', () => {
            this.publishImmediate();
        });

        this._unsubscribeWeaponChanged = eventBus.on('combat:weaponChanged', ({ entityId }) => {
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
        if (this._unsubscribeWeaponChanged) {
            this._unsubscribeWeaponChanged();
            this._unsubscribeWeaponChanged = null;
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

        const stats = controlled.getComponent('stats');
        const combat = controlled.getComponent('playerCombat');
        const networkSelf = uiStateStore.get('networkSelf');
        const currentWeapon = Number.isFinite(combat?.currentWeapon)
            ? Math.max(1, Math.min(4, combat.currentWeapon))
            : 1;
        const isPrimaryLocalPlayer = controlled.id === this.scene.player?.id;
        const canApplyNetworkSelf = !!networkSelf &&
            isPrimaryLocalPlayer &&
            networkSelf.sessionId === (networkManager.sessionId ?? null);
        const hp = canApplyNetworkSelf ? networkSelf.hp : (stats?.hp ?? 0);
        const hpMax = canApplyNetworkSelf ? networkSelf.hpMax : (stats?.hpMax ?? 0);

        return {
            entityId: controlled.id,
            entityType: controlled.type,
            sessionId: networkManager.sessionId ?? null,
            hp,
            hpMax,
            mana: stats?.mana ?? 0,
            manaMax: stats?.manaMax ?? 0,
            stamina: stats?.stamina ?? 0,
            staminaMax: stats?.staminaMax ?? 0,
            currentWeapon,
            weapons: WEAPON_STATES_BY_ACTIVE_SLOT[currentWeapon] ?? WEAPON_LABELS.map((name, idx) => ({
                slot: idx + 1,
                name,
                active: idx + 1 === currentWeapon,
            })),
            buffs: EMPTY_BUFFS,
        };
    }
}
