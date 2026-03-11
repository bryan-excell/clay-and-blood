import Phaser from 'phaser';
import { uiStateStore } from '../core/UiStateStore.js';
import { eventBus } from '../core/EventBus.js';
import { HpBarWidget } from '../ui/widgets/HpBarWidget.js';
import { InventoryDrawerWidget, DRAWER_TOTAL_W } from '../ui/widgets/InventoryDrawerWidget.js';
import { RadialKitWidget } from '../ui/widgets/RadialKitWidget.js';
import { GAME_FONT_FAMILY } from '../config.js';

export class UIScene extends Phaser.Scene {
    constructor() {
        super({ key: 'UIScene', active: false });
        this._unsubscribeStore = null;
        this._onResize         = null;
        this._onTabKeyDown     = null;
        this._onTabKeyUp       = null;
        this._onEscKeyDown     = null;
        this._onCycleWeaponKeyDown = null;
        this._onCycleSpellKeyDown = null;
        this._quickRadialWidget = null;
        this._escDebounceActive = false;
        this._pendingState     = uiStateStore.getState();
        this._equippedWeaponText = null;
        this._equippedSpellText = null;
    }

    create() {
        // HP bar — upper-right. x is the right edge; _layout sets the exact value.
        this._hpBar = new HpBarWidget(this, 244, 24, {
            label: 'HP',
            baseColor: 0x44aa66,
            midColor: 0xd6a83a,
            lowColor: 0xcc4444,
        });
        this._staminaBar = new HpBarWidget(this, 244, 52, {
            label: 'ST',
            baseColor: 0x8ebc4d,
            midColor: 0xd1b44a,
            lowColor: 0xb56a2e,
        });
        this._manaBar = new HpBarWidget(this, 244, 80, {
            label: 'MP',
            baseColor: 0x4689d6,
            midColor: 0x4f67cc,
            lowColor: 0x6a4cb5,
        });
        this._equippedWeaponText = this.add.text(24, 112, '', {
            fontSize: '13px',
            fontFamily: GAME_FONT_FAMILY,
            color: '#d7c8a4',
        }).setOrigin(0, 0);
        this._equippedSpellText = this.add.text(24, 132, '', {
            fontSize: '13px',
            fontFamily: GAME_FONT_FAMILY,
            color: '#a9c7ef',
        }).setOrigin(0, 0);

        // Inventory drawer — equip actions are emitted over the event bus so
        // GameScene can route them to the controlled entity's LoadoutComponent.
        this._drawer = new InventoryDrawerWidget(
            this,
            {
                armor:     (id) => eventBus.emit('ui:equipArmor',     { id }),
                accessory: (id) => eventBus.emit('ui:equipAccessory', { id }),
            },
            this.scale.height
        );

        this._quickRadialWidget = new RadialKitWidget(
            this,
            this.scale.width / 2,
            this.scale.height / 2,
            'quick'
        );
        this._quickRadialWidget.hide();

        // TAB holds the quick radial. Prevent the browser default focus change.
        this._onTabKeyDown = (event) => {
            event.preventDefault?.();
            this._showQuickRadial();
        };
        this.input.keyboard.on('keydown-TAB', this._onTabKeyDown);
        this._onTabKeyUp = () => this._confirmAndHideQuickRadial();
        this.input.keyboard.on('keyup-TAB', this._onTabKeyUp);

        // ESC toggles the drawer; debounce prevents key repeat flicker.
        this._onEscKeyDown = () => {
            if (this._escDebounceActive) return;
            this._escDebounceActive = true;
            this._toggleDrawer();
            this.time.delayedCall(200, () => {
                this._escDebounceActive = false;
            });
        };
        this.input.keyboard.on('keydown-ESC', this._onEscKeyDown);

        this._onCycleWeaponKeyDown = () => eventBus.emit('ui:cycleWeaponSlot');
        this._onCycleSpellKeyDown = () => eventBus.emit('ui:cycleSpellSlot');
        this.input.keyboard.on('keydown-ONE', this._onCycleWeaponKeyDown);
        this.input.keyboard.on('keydown-LEFT', this._onCycleWeaponKeyDown);
        this.input.keyboard.on('keydown-TWO', this._onCycleSpellKeyDown);
        this.input.keyboard.on('keydown-RIGHT', this._onCycleSpellKeyDown);

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
            if (this._onTabKeyUp) {
                this.input.keyboard.off('keyup-TAB', this._onTabKeyUp);
                this._onTabKeyUp = null;
            }
            if (this._onEscKeyDown) {
                this.input.keyboard.off('keydown-ESC', this._onEscKeyDown);
                this._onEscKeyDown = null;
            }
            if (this._onCycleWeaponKeyDown) {
                this.input.keyboard.off('keydown-ONE', this._onCycleWeaponKeyDown);
                this.input.keyboard.off('keydown-LEFT', this._onCycleWeaponKeyDown);
                this._onCycleWeaponKeyDown = null;
            }
            if (this._onCycleSpellKeyDown) {
                this.input.keyboard.off('keydown-TWO', this._onCycleSpellKeyDown);
                this.input.keyboard.off('keydown-RIGHT', this._onCycleSpellKeyDown);
                this._onCycleSpellKeyDown = null;
            }
            this._hpBar?.destroy();
            this._staminaBar?.destroy();
            this._manaBar?.destroy();
            this._equippedWeaponText?.destroy();
            this._equippedSpellText?.destroy();
            this._quickRadialWidget?.destroy();
            // Clean up drawer state in the store.
            uiStateStore.set('drawerOpen', false);
            uiStateStore.set('drawerWidth', 0);
            uiStateStore.set('pendingSlotAssignment', null);
            uiStateStore.set('quickRadialOpen', false);
            uiStateStore.set('quickRadialHover', null);
        });
    }

    update() {
        if (!this._quickRadialWidget?.visible) return;
        const hover = this._quickRadialWidget.updateQuickHover();
        uiStateStore.set('quickRadialHover', hover);
    }

    // ------------------------------------------------------------------
    // Layout
    // ------------------------------------------------------------------

    _layout(width, height) {
        const leftPadding = 24;
        const topPadding = 24;
        const barWidth = this._hpBar?.width ?? 200;
        const rightEdge = leftPadding + barWidth + 20;
        this._hpBar?.setPosition(rightEdge, topPadding);
        this._staminaBar?.setPosition(rightEdge, topPadding + 28);
        this._manaBar?.setPosition(rightEdge, topPadding + 56);
        this._equippedWeaponText?.setPosition(leftPadding, topPadding + 92);
        this._equippedSpellText?.setPosition(leftPadding, topPadding + 112);
        // Drawer height tracks the scene.
        this._drawer?.setHeight(height);
        this._quickRadialWidget?.setPosition(width / 2, height / 2);
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
        if (!open) uiStateStore.set('pendingSlotAssignment', null);
    }

    _showQuickRadial() {
        if (this._drawer?.isOpen) return;
        const loadout = uiStateStore.get('controlledEntity')?.loadout ?? null;
        this._quickRadialWidget?.refresh(loadout, { hoverSelection: uiStateStore.get('quickRadialHover') });
        this._quickRadialWidget?.show();
        uiStateStore.set('quickRadialOpen', true);
    }

    _confirmAndHideQuickRadial() {
        if (!this._quickRadialWidget?.visible) return;

        const selection = this._quickRadialWidget.getHoveredSelection();
        if (selection?.type === 'weapon') {
            eventBus.emit('ui:activateWeaponSlot', { slotIndex: selection.slotIndex });
        } else if (selection?.type === 'spell') {
            eventBus.emit('ui:activateSpellSlot', { slotIndex: selection.slotIndex });
        }

        this._quickRadialWidget.hide();
        uiStateStore.set('quickRadialOpen', false);
        uiStateStore.set('quickRadialHover', null);
    }

    // ------------------------------------------------------------------
    // State rendering
    // ------------------------------------------------------------------

    _renderState() {
        const state      = this._pendingState ?? uiStateStore.getState();
        const controlled = state.controlledEntity;
        const hasEntity  = !!controlled?.entityId;

        this._hpBar?.setVisible(hasEntity);
        this._staminaBar?.setVisible(hasEntity);
        this._manaBar?.setVisible(hasEntity);
        this._equippedWeaponText?.setVisible(hasEntity);
        this._equippedSpellText?.setVisible(hasEntity);
        if (!state.quickRadialOpen) this._quickRadialWidget?.hide();

        if (!hasEntity) {
            this._drawer?.update(null);
            return;
        }

        this._hpBar?.update(controlled.hp, controlled.hpMax);
        this._staminaBar?.update(controlled.stamina, controlled.staminaMax);
        this._manaBar?.update(controlled.mana, controlled.manaMax);
        this._equippedWeaponText?.setText(`⚔ ${controlled.loadout?.equipped?.weaponId ? (controlled.loadout.weapons?.find(item => item.id === controlled.loadout.equipped.weaponId)?.name ?? 'Unarmed') : 'Unarmed'}`);
        this._equippedSpellText?.setText(`✦ ${controlled.loadout?.equipped?.spellId ? (controlled.loadout.spells?.find(item => item.id === controlled.loadout.equipped.spellId)?.name ?? 'Nothing') : 'Nothing'}`);
        this._drawer?.update(controlled.loadout ?? null);
        this._quickRadialWidget?.refresh(controlled.loadout ?? null, {
            hoverSelection: uiStateStore.get('quickRadialHover'),
        });
    }
}
