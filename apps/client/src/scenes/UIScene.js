import Phaser from 'phaser';
import { uiStateStore } from '../core/UiStateStore.js';
import { eventBus } from '../core/EventBus.js';
import { HpBarWidget } from '../ui/widgets/HpBarWidget.js';
import { InventoryDrawerWidget, DRAWER_TOTAL_W } from '../ui/widgets/InventoryDrawerWidget.js';
import { ToastFeedWidget } from '../ui/widgets/ToastFeedWidget.js';
import { MerchantShopWidget } from '../ui/widgets/MerchantShopWidget.js';
import { UpgraderWidget } from '../ui/widgets/UpgraderWidget.js';
import { DEBUG_WORLD_OVERLAY_DEFAULT, GAME_FONT_FAMILY } from '../config.js';

export class UIScene extends Phaser.Scene {
    constructor() {
        super({ key: 'UIScene', active: false });
        this._unsubscribeStore = null;
        this._onResize         = null;
        this._onEscKeyDown     = null;
        this._onActionSlotKeyDown = [];
        this._onUseConsumableKeyDown = null;
        this._onToggleDebugOverlayKeyDown = null;
        this._escDebounceActive = false;
        this._showWorldDebug = DEBUG_WORLD_OVERLAY_DEFAULT;
        this._pendingState     = uiStateStore.getState();
        this._equippedWeaponText = null;
        this._equippedSpellText = null;
        this._equippedConsumableText = null;
        this._worldDebugText = null;
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
        this._worldDebugText = this.add.text(this.scale.width - 24, 24, '', {
            fontSize: '13px',
            fontFamily: GAME_FONT_FAMILY,
            color: '#d9e6f2',
            stroke: '#0f141a',
            strokeThickness: 4,
            align: 'right',
        }).setOrigin(1, 0).setDepth(760);
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

        this._onActionSlotKeyDown = [0, 1, 2, 3].map((slotIndex) => (
            () => eventBus.emit('ui:activateActionSlot', { slotIndex })
        ));
        this._onUseConsumableKeyDown = () => eventBus.emit('ui:useConsumable');
        this.input.keyboard.on('keydown-ONE', this._onActionSlotKeyDown[0]);
        this.input.keyboard.on('keydown-TWO', this._onActionSlotKeyDown[1]);
        this.input.keyboard.on('keydown-THREE', this._onActionSlotKeyDown[2]);
        this.input.keyboard.on('keydown-FOUR', this._onActionSlotKeyDown[3]);
        this.input.keyboard.on('keydown-Q', this._onUseConsumableKeyDown);
        this._onToggleDebugOverlayKeyDown = (event) => {
            event.preventDefault?.();
            this._showWorldDebug = !this._showWorldDebug;
            this._renderState();
        };
        this.input.keyboard.on('keydown-P', this._onToggleDebugOverlayKeyDown);
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
            if (this._onEscKeyDown) {
                this.input.keyboard.off('keydown-ESC', this._onEscKeyDown);
                this._onEscKeyDown = null;
            }
            if (this._onActionSlotKeyDown.length > 0) {
                this.input.keyboard.off('keydown-ONE', this._onActionSlotKeyDown[0]);
                this.input.keyboard.off('keydown-TWO', this._onActionSlotKeyDown[1]);
                this.input.keyboard.off('keydown-THREE', this._onActionSlotKeyDown[2]);
                this.input.keyboard.off('keydown-FOUR', this._onActionSlotKeyDown[3]);
                this._onActionSlotKeyDown = [];
            }
            if (this._onUseConsumableKeyDown) {
                this.input.keyboard.off('keydown-Q', this._onUseConsumableKeyDown);
                this._onUseConsumableKeyDown = null;
            }
            if (this._onToggleDebugOverlayKeyDown) {
                this.input.keyboard.off('keydown-P', this._onToggleDebugOverlayKeyDown);
                this._onToggleDebugOverlayKeyDown = null;
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
            this._worldDebugText?.destroy();
            this._toastFeed?.destroy();
            this._merchantShop?.destroy();
            this._upgrader?.destroy();
            // Clean up drawer state in the store.
            uiStateStore.set('drawerOpen', false);
            uiStateStore.set('drawerWidth', 0);
            uiStateStore.set('pendingSlotAssignment', null);
            uiStateStore.set('merchantShopOpen', false);
            uiStateStore.set('merchantShopContext', null);
            uiStateStore.set('merchantShopBounds', null);
            uiStateStore.set('upgraderOpen', false);
            uiStateStore.set('upgraderContext', null);
            uiStateStore.set('upgraderBounds', null);
        });
    }

    update() {
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
        this._worldDebugText?.setPosition(width - 24, topPadding);
        // Drawer height tracks the scene.
        this._drawer?.setHeight(height);
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

    _openMerchantShop(context) {
        if (uiStateStore.get('upgraderOpen')) this._closeUpgrader();
        if (this._drawer?.isOpen) {
            this._drawer.close();
            uiStateStore.set('drawerOpen', false);
            uiStateStore.set('drawerWidth', 0);
            uiStateStore.set('pendingSlotAssignment', null);
        }
        uiStateStore.patch({
            merchantShopOpen: true,
            merchantShopContext: {
                merchantId: context?.merchantId ?? null,
                title: context?.title ?? 'Shop',
                stock: Array.isArray(context?.stock) ? context.stock : [],
            },
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
        uiStateStore.patch({
            upgraderOpen: true,
            upgraderContext: {
                upgraderId: context?.upgraderId ?? null,
                type: context?.type ?? null,
                title: context?.title ?? 'Upgrader',
            },
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
        this._worldDebugText?.setVisible(this._showWorldDebug);
        const worldDebug = state.worldDebug ?? null;
        const debugLines = [
            `Stage Slug: ${worldDebug?.stageSlug ?? 'unknown'}`,
            `Stage UUID: ${worldDebug?.stageUuid ?? 'unknown'}`,
            `Name: ${worldDebug?.displayName ?? 'unknown'}`,
            `Kind: ${worldDebug?.stageKind ?? 'unknown'}`,
            `Zone: ${worldDebug?.zoneName ?? worldDebug?.zoneId ?? 'none'}`,
        ];
        if (Number.isFinite(worldDebug?.tileX) && Number.isFinite(worldDebug?.tileY)) {
            debugLines.push(`Tile: ${worldDebug.tileX}, ${worldDebug.tileY}`);
        }
        this._worldDebugText?.setText(this._showWorldDebug ? debugLines.join('\n') : '');
        if (!hasEntity) {
            this._drawer?.update(null);
            this._merchantShop?.hide();
            this._upgrader?.hide();
            return;
        }

        this._hpBar?.update(controlled.hp, controlled.hpMax);
        this._staminaBar?.update(controlled.stamina, controlled.staminaMax);
        this._manaBar?.update(controlled.mana, controlled.manaMax);
        const actionSlots = controlled.loadout?.actionSlots ?? [];
        const activeActionIndex = controlled.loadout?.activeActionSlotIndex ?? 0;
        const activeAction = actionSlots[activeActionIndex] ?? null;
        const slotSummary = actionSlots
            .slice(0, 4)
            .map((item, index) => `${index + 1}:${item?.name ?? item?.id ?? 'None'}`)
            .join('  ');
        this._equippedWeaponText?.setText(`Weapon ${activeActionIndex + 1}: ${activeAction?.name ?? 'Unarmed'}`);
        this._equippedSpellText?.setText(slotSummary);
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
    }
}
