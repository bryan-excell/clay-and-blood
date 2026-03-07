import Phaser from 'phaser';
import { uiStateStore } from '../core/UiStateStore.js';
import { eventBus } from '../core/EventBus.js';
import { HpBarWidget } from '../ui/widgets/HpBarWidget.js';
import { InventoryDrawerWidget, DRAWER_TOTAL_W } from '../ui/widgets/InventoryDrawerWidget.js';

export class UIScene extends Phaser.Scene {
    constructor() {
        super({ key: 'UIScene', active: false });
        this._unsubscribeStore = null;
        this._onResize         = null;
        this._onTabKeyDown     = null;
        this._onEscKeyDown     = null;
        this._pendingState     = uiStateStore.getState();
    }

    create() {
        // HP bar — upper-right. x is the right edge; _layout sets the exact value.
        this._hpBar = new HpBarWidget(this, this.scale.width - 16, 16);

        // Inventory drawer — equip actions are emitted over the event bus so
        // GameScene can route them to the controlled entity's LoadoutComponent.
        this._drawer = new InventoryDrawerWidget(
            this,
            {
                weapon:    (id) => eventBus.emit('ui:equipWeapon',    { id }),
                spell:     (id) => eventBus.emit('ui:equipSpell',     { id }),
                armor:     (id) => eventBus.emit('ui:equipArmor',     { id }),
                accessory: (id) => eventBus.emit('ui:equipAccessory', { id }),
            },
            this.scale.height
        );

        // TAB toggles the drawer. Prevent the browser default (focus jump).
        this._onTabKeyDown = (event) => {
            event.preventDefault?.();
            this._toggleDrawer();
        };
        this.input.keyboard.on('keydown-TAB', this._onTabKeyDown);

        // ESC closes the drawer if it is open.
        this._onEscKeyDown = () => {
            if (this._drawer?.isOpen) this._toggleDrawer();
        };
        this.input.keyboard.on('keydown-ESC', this._onEscKeyDown);

        // Subscribe to the state store.
        this._unsubscribeStore = uiStateStore.subscribe((state) => {
            this._pendingState = state;
            this._renderState();
        });

        // Resize handler.
        this._onResize = (gameSize) => this._layout(gameSize.width, gameSize.height);
        this.scale.on('resize', this._onResize);

        this._layout(this.scale.width, this.scale.height);
        this._renderState();

        this.events.once('shutdown', () => {
            this._unsubscribeStore?.();
            this._unsubscribeStore = null;
            this.scale.off('resize', this._onResize);
            this._onResize = null;
            if (this._onTabKeyDown) {
                this.input.keyboard.off('keydown-TAB', this._onTabKeyDown);
                this._onTabKeyDown = null;
            }
            if (this._onEscKeyDown) {
                this.input.keyboard.off('keydown-ESC', this._onEscKeyDown);
                this._onEscKeyDown = null;
            }
            // Clean up drawer state in the store.
            uiStateStore.set('drawerOpen', false);
            uiStateStore.set('drawerWidth', 0);
        });
    }

    // ------------------------------------------------------------------
    // Layout
    // ------------------------------------------------------------------

    _layout(width, height) {
        // HP bar: right edge 16px from the right.
        this._hpBar?.setPosition(width - 16, 16);
        // Drawer height tracks the scene.
        this._drawer?.setHeight(height);
    }

    // ------------------------------------------------------------------
    // Drawer toggle
    // ------------------------------------------------------------------

    _toggleDrawer() {
        if (!this._drawer) return;
        this._drawer.toggle();
        const open = this._drawer.isOpen;
        uiStateStore.set('drawerOpen', open);
        uiStateStore.set('drawerWidth', open ? DRAWER_TOTAL_W : 0);
    }

    // ------------------------------------------------------------------
    // State rendering
    // ------------------------------------------------------------------

    _renderState() {
        const state      = this._pendingState ?? uiStateStore.getState();
        const controlled = state.controlledEntity;
        const hasEntity  = !!controlled?.entityId;

        this._hpBar?.setVisible(hasEntity);

        if (!hasEntity) return;

        this._hpBar?.update(controlled.hp, controlled.hpMax);
        this._drawer?.update(controlled.loadout ?? null);
    }
}
