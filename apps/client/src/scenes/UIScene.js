import Phaser from 'phaser';
import { uiStateStore } from '../core/UiStateStore.js';
import { eventBus } from '../core/EventBus.js';
import { HpBarWidget } from '../ui/widgets/HpBarWidget.js';
import { InventoryDrawerWidget, DRAWER_TOTAL_W } from '../ui/widgets/InventoryDrawerWidget.js';
import { RadialKitWidget } from '../ui/widgets/RadialKitWidget.js';
import { ToastFeedWidget } from '../ui/widgets/ToastFeedWidget.js';
import { MerchantShopWidget } from '../ui/widgets/MerchantShopWidget.js';
import { UpgraderWidget } from '../ui/widgets/UpgraderWidget.js';
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
        this._onUseConsumableKeyDown = null;
        this._onCycleConsumableKeyDown = null;
        this._quickRadialWidget = null;
        this._escDebounceActive = false;
        this._pendingState     = uiStateStore.getState();
        this._equippedWeaponText = null;
        this._equippedSpellText = null;
        this._equippedConsumableText = null;
        this._toastFeed = null;
        this._merchantShop = null;
        this._upgrader = null;
        this._unsubscribeToast = null;
        this._unsubscribeOpenShop = null;
        this._unsubscribeCloseShop = null;
        this._unsubscribeOpenUpgrader = null;
        this._unsubscribeCloseUpgrader = null;
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
        this._equippedConsumableText = this.add.text(24, 152, '', {
            fontSize: '13px',
            fontFamily: GAME_FONT_FAMILY,
            color: '#c5deb0',
        }).setOrigin(0, 0);
        this._toastFeed = new ToastFeedWidget(this);
        this._merchantShop = new MerchantShopWidget(this);
        this._merchantShop.hide();
        this._merchantShop.setPosition(this.scale.width / 2, this.scale.height / 2);
        this._upgrader = new UpgraderWidget(this);
        this._upgrader.hide();
        this._upgrader.setPosition(this.scale.width / 2, this.scale.height / 2);
        this.events.on('merchant:sell', ({ merchantId, entryId, mode }) => {
            eventBus.emit('ui:sellEntry', { merchantId, entryId, mode });
        });
        this.events.on('merchant:buy', ({ merchantId, definitionId }) => {
            eventBus.emit('ui:buyMerchantItem', { merchantId, definitionId });
        });
        this.events.on('upgrader:upgrade', ({ upgraderId, type, entryId, spellId }) => {
            if (type === 'weapon') {
                eventBus.emit('ui:upgradeWeaponItem', { upgraderId, entryId });
            } else if (type === 'spell') {
                eventBus.emit('ui:upgradeSpellItem', { upgraderId, spellId });
            }
        });

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
            if (uiStateStore.get('merchantShopOpen')) {
                this._closeMerchantShop();
            } else if (uiStateStore.get('upgraderOpen')) {
                this._closeUpgrader();
            } else {
                this._toggleDrawer();
            }
            this.time.delayedCall(200, () => {
                this._escDebounceActive = false;
            });
        };
        this.input.keyboard.on('keydown-ESC', this._onEscKeyDown);

        this._onCycleWeaponKeyDown = () => eventBus.emit('ui:cycleWeaponSlot');
        this._onCycleSpellKeyDown = () => eventBus.emit('ui:cycleSpellSlot');
        this._onUseConsumableKeyDown = () => eventBus.emit('ui:useConsumable');
        this._onCycleConsumableKeyDown = () => eventBus.emit('ui:cycleConsumableSlot');
        this.input.keyboard.on('keydown-ONE', this._onCycleWeaponKeyDown);
        this.input.keyboard.on('keydown-LEFT', this._onCycleWeaponKeyDown);
        this.input.keyboard.on('keydown-TWO', this._onCycleSpellKeyDown);
        this.input.keyboard.on('keydown-RIGHT', this._onCycleSpellKeyDown);
        this.input.keyboard.on('keydown-Q', this._onUseConsumableKeyDown);
        this.input.keyboard.on('keydown-THREE', this._onCycleConsumableKeyDown);
        this.input.keyboard.on('keydown-UP', this._onCycleConsumableKeyDown);
        this._unsubscribeToast = eventBus.on('toast:enqueue', ({ message, durationMs }) => {
            this._toastFeed?.enqueue(message, durationMs);
        });
        this._unsubscribeOpenShop = eventBus.on('ui:openMerchantShop', (context) => this._openMerchantShop(context));
        this._unsubscribeCloseShop = eventBus.on('ui:closeMerchantShop', () => this._closeMerchantShop());
        this._unsubscribeOpenUpgrader = eventBus.on('ui:openUpgrader', (context) => this._openUpgrader(context));
        this._unsubscribeCloseUpgrader = eventBus.on('ui:closeUpgrader', () => this._closeUpgrader());

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
            if (this._onUseConsumableKeyDown) {
                this.input.keyboard.off('keydown-Q', this._onUseConsumableKeyDown);
                this._onUseConsumableKeyDown = null;
            }
            if (this._onCycleConsumableKeyDown) {
                this.input.keyboard.off('keydown-THREE', this._onCycleConsumableKeyDown);
                this.input.keyboard.off('keydown-UP', this._onCycleConsumableKeyDown);
                this._onCycleConsumableKeyDown = null;
            }
            this._unsubscribeToast?.();
            this._unsubscribeOpenShop?.();
            this._unsubscribeCloseShop?.();
            this._unsubscribeOpenUpgrader?.();
            this._unsubscribeCloseUpgrader?.();
            this.events.off('merchant:sell');
            this.events.off('merchant:buy');
            this.events.off('upgrader:upgrade');
            this._hpBar?.destroy();
            this._staminaBar?.destroy();
            this._manaBar?.destroy();
            this._equippedWeaponText?.destroy();
            this._equippedSpellText?.destroy();
            this._equippedConsumableText?.destroy();
            this._toastFeed?.destroy();
            this._merchantShop?.destroy();
            this._upgrader?.destroy();
            this._quickRadialWidget?.destroy();
            // Clean up drawer state in the store.
            uiStateStore.set('drawerOpen', false);
            uiStateStore.set('drawerWidth', 0);
            uiStateStore.set('pendingSlotAssignment', null);
            uiStateStore.set('quickRadialOpen', false);
            uiStateStore.set('quickRadialHover', null);
            uiStateStore.set('merchantShopOpen', false);
            uiStateStore.set('merchantShopContext', null);
            uiStateStore.set('merchantShopBounds', null);
            uiStateStore.set('upgraderOpen', false);
            uiStateStore.set('upgraderContext', null);
            uiStateStore.set('upgraderBounds', null);
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
        this._equippedConsumableText?.setPosition(leftPadding, topPadding + 132);
        // Drawer height tracks the scene.
        this._drawer?.setHeight(height);
        this._quickRadialWidget?.setPosition(width / 2, height / 2);
        this._toastFeed?.setPosition(width - 24, height - 24);
        this._merchantShop?.setPosition(width / 2, height / 2);
        this._upgrader?.setPosition(width / 2, height / 2);
        uiStateStore.set('merchantShopBounds', {
            x: width / 2 - (this._merchantShop?.width ?? 0) / 2,
            y: height / 2 - (this._merchantShop?.height ?? 0) / 2,
            width: this._merchantShop?.width ?? 0,
            height: this._merchantShop?.height ?? 0,
        });
        uiStateStore.set('upgraderBounds', {
            x: width / 2 - (this._upgrader?.width ?? 0) / 2,
            y: height / 2 - (this._upgrader?.height ?? 0) / 2,
            width: this._upgrader?.width ?? 0,
            height: this._upgrader?.height ?? 0,
        });
    }

    // ------------------------------------------------------------------
    // Drawer toggle
    // ------------------------------------------------------------------

    _toggleDrawer() {
        if (uiStateStore.get('merchantShopOpen') || uiStateStore.get('upgraderOpen')) return;
        if (!this._drawer) return;
        this._drawer.toggle();
        const open = this._drawer.isOpen;
        uiStateStore.set('drawerOpen', open);
        uiStateStore.set('drawerWidth', open ? DRAWER_TOTAL_W : 0);
        if (!open) uiStateStore.set('pendingSlotAssignment', null);
    }

    _showQuickRadial() {
        if (this._drawer?.isOpen || uiStateStore.get('merchantShopOpen') || uiStateStore.get('upgraderOpen')) return;
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
        } else if (selection?.type === 'consumable') {
            eventBus.emit('ui:activateConsumableSlot', { slotIndex: selection.slotIndex });
        }

        this._quickRadialWidget.hide();
        uiStateStore.set('quickRadialOpen', false);
        uiStateStore.set('quickRadialHover', null);
    }

    _openMerchantShop(context) {
        if (uiStateStore.get('upgraderOpen')) this._closeUpgrader();
        if (this._drawer?.isOpen) {
            this._drawer.close();
            uiStateStore.set('drawerOpen', false);
            uiStateStore.set('drawerWidth', 0);
            uiStateStore.set('pendingSlotAssignment', null);
        }
        this._quickRadialWidget?.hide();
        uiStateStore.patch({
            merchantShopOpen: true,
            merchantShopContext: {
                merchantId: context?.merchantId ?? null,
                title: context?.title ?? 'Shop',
                stock: Array.isArray(context?.stock) ? context.stock : [],
            },
            quickRadialOpen: false,
            quickRadialHover: null,
        });
        this._merchantShop?.show();
        this._renderState();
    }

    _closeMerchantShop() {
        this._merchantShop?.hide();
        uiStateStore.patch({
            merchantShopOpen: false,
            merchantShopContext: null,
        });
    }

    _openUpgrader(context) {
        if (uiStateStore.get('merchantShopOpen')) this._closeMerchantShop();
        if (this._drawer?.isOpen) {
            this._drawer.close();
            uiStateStore.set('drawerOpen', false);
            uiStateStore.set('drawerWidth', 0);
            uiStateStore.set('pendingSlotAssignment', null);
        }
        this._quickRadialWidget?.hide();
        uiStateStore.patch({
            upgraderOpen: true,
            upgraderContext: {
                upgraderId: context?.upgraderId ?? null,
                type: context?.type ?? null,
                title: context?.title ?? 'Upgrader',
            },
            quickRadialOpen: false,
            quickRadialHover: null,
        });
        this._upgrader?.show();
        this._renderState();
    }

    _closeUpgrader() {
        this._upgrader?.hide();
        uiStateStore.patch({
            upgraderOpen: false,
            upgraderContext: null,
        });
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
        this._equippedConsumableText?.setVisible(hasEntity);
        if (!state.quickRadialOpen) this._quickRadialWidget?.hide();

        if (!hasEntity) {
            this._drawer?.update(null);
            this._merchantShop?.hide();
            this._upgrader?.hide();
            return;
        }

        this._hpBar?.update(controlled.hp, controlled.hpMax);
        this._staminaBar?.update(controlled.stamina, controlled.staminaMax);
        this._manaBar?.update(controlled.mana, controlled.manaMax);
        this._equippedWeaponText?.setText(`⚔ ${controlled.loadout?.equipped?.weaponId ? (controlled.loadout.weapons?.find(item => item.id === controlled.loadout.equipped.weaponId)?.name ?? 'Unarmed') : 'Unarmed'}`);
        this._equippedSpellText?.setText(`✦ ${controlled.loadout?.equipped?.spellId ? (controlled.loadout.spells?.find(item => item.id === controlled.loadout.equipped.spellId)?.name ?? 'Nothing') : 'Nothing'}`);
        const consumableSlot = controlled.loadout?.consumableSlots?.[controlled.loadout?.activeConsumableSlotIndex ?? 0] ?? null;
        this._equippedConsumableText?.setText(`Q ${consumableSlot?.name ?? 'Nothing'}${consumableSlot?.id && consumableSlot?.id !== 'nothing' ? ` x${consumableSlot?.quantity ?? 0}` : ''}`);
        this._drawer?.update(controlled);
        if (state.merchantShopOpen) {
            this._merchantShop?.show();
            this._merchantShop?.update(controlled, state.merchantShopContext);
        } else {
            this._merchantShop?.hide();
        }
        if (state.upgraderOpen) {
            this._upgrader?.show();
            this._upgrader?.update(controlled, state.upgraderContext);
        } else {
            this._upgrader?.hide();
        }
        this._quickRadialWidget?.refresh(controlled.loadout ?? null, {
            hoverSelection: uiStateStore.get('quickRadialHover'),
        });
    }
}
