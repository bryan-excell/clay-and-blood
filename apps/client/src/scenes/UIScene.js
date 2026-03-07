import Phaser from 'phaser';
import { uiStateStore } from '../core/UiStateStore.js';
import { HpBarWidget } from '../ui/widgets/HpBarWidget.js';
import { WeaponSlotsWidget } from '../ui/widgets/WeaponSlotsWidget.js';

export class UIScene extends Phaser.Scene {
    constructor() {
        super({ key: 'UIScene', active: false });
        this._unsubscribeStore = null;
        this._onResize = null;
        this._pendingState = uiStateStore.getState();
    }

    create() {
        this._hpBar = new HpBarWidget(this, 16, 16);
        this._weapons = new WeaponSlotsWidget(this, 16, this.scale.height - 40);

        this._unsubscribeStore = uiStateStore.subscribe((state) => {
            this._pendingState = state;
            this._renderState();
        });

        this._onResize = (gameSize) => {
            this._layout(gameSize.width, gameSize.height);
        };
        this.scale.on('resize', this._onResize);

        this._layout(this.scale.width, this.scale.height);
        this._renderState();

        this.events.once('shutdown', () => {
            if (this._unsubscribeStore) {
                this._unsubscribeStore();
                this._unsubscribeStore = null;
            }
            if (this._onResize) {
                this.scale.off('resize', this._onResize);
                this._onResize = null;
            }
        });
    }

    _layout(width, height) {
        this._hpBar?.setPosition(16, 16);
        this._weapons?.setPosition(16, Math.max(16, height - 44));
    }

    _renderState() {
        const state = this._pendingState ?? uiStateStore.getState();
        const controlled = state.controlledEntity;
        const hasEntity = !!controlled?.entityId;

        this._hpBar?.setVisible(hasEntity);
        this._weapons?.setVisible(hasEntity);

        if (!hasEntity) return;

        this._hpBar?.update(controlled.hp, controlled.hpMax);
        this._weapons?.update(controlled.weapons, controlled.currentWeapon);
    }
}
