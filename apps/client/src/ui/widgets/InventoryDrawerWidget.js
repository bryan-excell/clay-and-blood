/**
 * InventoryDrawerWidget
 *
 * Slide-in inventory drawer used for inventory projection and loadout assignment.
 */

import Phaser from 'phaser';
import { GAME_FONT_FAMILY } from '../../config.js';
import { uiStateStore } from '../../core/UiStateStore.js';
import { eventBus } from '../../core/EventBus.js';
import { RadialKitWidget } from './RadialKitWidget.js';

const RIBBON_W = 44;
const PANEL_W  = 240;
export const DRAWER_TOTAL_W = RIBBON_W + PANEL_W;

const TAB_H    = 48;
const TAB_PAD  = 4;
const ROW_H    = 32;
const ROW_GAP  = 4;
const ROW_PAD  = 6;
const HEADER_H = 36;
const GOLD_H   = 30;
const TWEEN_DURATION = 180;

const TABS = Object.freeze([
    { id: 'weapons', label: 'W', title: 'Weapons' },
    { id: 'spells', label: 'S', title: 'Spells' },
    { id: 'armor', label: 'A', title: 'Armor' },
    { id: 'accessories', label: 'X', title: 'Accessories' },
    { id: 'consumables', label: 'Q', title: 'Consumables' },
    { id: 'resources', label: 'R', title: 'Resources' },
]);

const C = Object.freeze({
    ribbonBg: 0x0e1520,
    panelBg: 0x141d2a,
    tabInactive: 0x1a2535,
    tabActive: 0x1e3450,
    tabBorderInact: 0x273545,
    tabBorderAct: 0x4a7aaa,
    tabLabelInact: '#6a8aaa',
    tabLabelAct: '#c8e0ff',
    panelTitle: '#9bbbd8',
    rowInactive: 0x192030,
    rowActive: 0x1e3b5e,
    rowBorderInact: 0x263545,
    rowBorderAct: 0x3d7ab8,
    rowTextInact: '#8aaecc',
    rowTextAct: '#d8eeff',
    rowHover: 0x22304a,
    goldText: '#f1d77a',
    mutedText: '#587089',
});

export class InventoryDrawerWidget {
    constructor(scene, onEquip = {}, height = 600) {
        this.scene = scene;
        this.onEquip = onEquip;

        this._open = false;
        this._activeTab = 0;
        this._controlledState = null;
        this._rowsKey = null;
        this._height = height;
        this._activeTween = null;
        this._radial = null;
        this._contextMenu = [];
        this._contextMenuItem = null;
        this._handleScenePointerDown = (pointer) => {
            const rightClick = pointer?.rightButtonDown?.() || pointer?.button === 2;
            if (!rightClick) this._hideContextMenu();
        };

        this._container = null;
        this._ribbonBg = null;
        this._panelBg = null;
        this._panelTitle = null;
        this._goldText = null;
        this._tabButtons = [];
        this._rows = [];

        this._build();
        this._buildRadial();
        this.scene.input.on('pointerdown', this._handleScenePointerDown);
    }

    toggle() {
        if (this._open) this.close();
        else this.open();
    }

    open() {
        if (this._open) return;
        this._open = true;
        this._radial?.show();
        this._tweenTo(0);
    }

    close() {
        if (!this._open) return;
        this._open = false;
        this._radial?.hide();
        uiStateStore.set('pendingSlotAssignment', null);
        this._tweenTo(-DRAWER_TOTAL_W);
    }

    get isOpen() {
        return this._open;
    }

    update(controlledState) {
        this._controlledState = controlledState ?? null;
        const pendingSlotAssignment = uiStateStore.get('pendingSlotAssignment');
        const key = this._controlledState
            ? JSON.stringify(this._controlledState)
                + '|' + this._activeTab
                + '|' + JSON.stringify(pendingSlotAssignment)
            : '';
        if (key === this._rowsKey) return;
        this._rowsKey = key;
        this._rebuildRows();
        this._radial?.refresh(this._controlledState?.loadout ?? null, { selectedSlot: pendingSlotAssignment });
    }

    setHeight(height) {
        this._height = height;
        this._ribbonBg?.setSize(RIBBON_W, height);
        this._panelBg?.setSize(PANEL_W, height);
        this._positionRadial();
    }

    destroy() {
        this._destroyRows();
        this._hideContextMenu();
        this._radial?.destroy();
        this.scene.input.off('pointerdown', this._handleScenePointerDown);
        this._tabButtons.forEach(({ bg, label }) => { bg.destroy(); label.destroy(); });
        this._goldText?.destroy();
        this._ribbonBg?.destroy();
        this._panelBg?.destroy();
        this._panelTitle?.destroy();
        this._container?.destroy();
    }

    _build() {
        const scene = this.scene;
        this._container = scene.add.container(-DRAWER_TOTAL_W, 0);
        this._container.setDepth(500);

        this._ribbonBg = scene.add.rectangle(0, 0, RIBBON_W, this._height, C.ribbonBg, 0.97)
            .setOrigin(0, 0)
            .setStrokeStyle(1, 0x1e2e42, 1);
        this._panelBg = scene.add.rectangle(RIBBON_W, 0, PANEL_W, this._height, C.panelBg, 0.95)
            .setOrigin(0, 0)
            .setStrokeStyle(1, 0x1e2e42, 1)
            .setInteractive();
        this._panelTitle = scene.add.text(RIBBON_W + PANEL_W / 2, 10, TABS[0].title, {
            fontSize: '13px',
            fontFamily: GAME_FONT_FAMILY,
            color: C.panelTitle,
        }).setOrigin(0.5, 0);
        this._goldText = scene.add.text(RIBBON_W + ROW_PAD, HEADER_H, '', {
            fontSize: '12px',
            fontFamily: GAME_FONT_FAMILY,
            color: C.goldText,
        }).setOrigin(0, 0);

        this._container.add(this._ribbonBg);
        this._container.add(this._panelBg);
        this._container.add(this._panelTitle);
        this._container.add(this._goldText);

        this._tabButtons = TABS.map((tab, index) => {
            const ty = index * TAB_H + TAB_PAD;
            const bw = RIBBON_W - TAB_PAD * 2;
            const bh = TAB_H - TAB_PAD;
            const bg = scene.add.rectangle(TAB_PAD, ty, bw, bh, C.tabInactive, 1)
                .setOrigin(0, 0)
                .setStrokeStyle(1, C.tabBorderInact, 1)
                .setInteractive({ useHandCursor: true });
            const label = scene.add.text(
                TAB_PAD + bw / 2,
                ty + bh / 2,
                tab.label,
                { fontSize: '15px', fontFamily: GAME_FONT_FAMILY, color: C.tabLabelInact }
            ).setOrigin(0.5, 0.5);

            bg.on('pointerdown', () => this._setTab(index));
            bg.on('pointerover', () => {
                if (this._activeTab !== index) bg.setFillStyle(0x22334a, 1);
            });
            bg.on('pointerout', () => {
                if (this._activeTab !== index) bg.setFillStyle(C.tabInactive, 1);
            });

            this._container.add(bg);
            this._container.add(label);
            return { bg, label };
        });

        this._refreshTabHighlights();
    }

    _buildRadial() {
        this._radial = new RadialKitWidget(
            this.scene,
            this.scene.scale.width / 2,
            this.scene.scale.height / 2,
            'config',
            {
                onSelectWeaponSlot: (slotIndex) => this._beginAssignment('weapon', 'weapons', slotIndex),
                onSelectSpellSlot: (slotIndex) => this._beginAssignment('spell', 'spells', slotIndex),
                onSelectConsumableSlot: (slotIndex) => this._beginAssignment('consumable', 'consumables', slotIndex),
            }
        );
        this._radial.hide();
    }

    _beginAssignment(type, tabId, slotIndex) {
        uiStateStore.set('pendingSlotAssignment', { type, slotIndex });
        this._setTabById(tabId);
        this._radial?.refresh(this._controlledState?.loadout ?? null, { selectedSlot: { type, slotIndex } });
    }

    _positionRadial() {
        this._radial?.setPosition(this.scene.scale.width / 2, this.scene.scale.height / 2);
    }

    _setTab(index) {
        if (this._activeTab === index) return;
        this._activeTab = index;
        this._hideContextMenu();
        this._refreshTabHighlights();
        this._rebuildRows();
    }

    _setTabById(tabId) {
        const index = TABS.findIndex((tab) => tab.id === tabId);
        if (index !== -1) this._setTab(index);
    }

    _refreshTabHighlights() {
        this._tabButtons.forEach(({ bg, label }, index) => {
            const active = index === this._activeTab;
            bg.setFillStyle(active ? C.tabActive : C.tabInactive, 1);
            bg.setStrokeStyle(active ? 2 : 1, active ? C.tabBorderAct : C.tabBorderInact, 1);
            label.setColor(active ? C.tabLabelAct : C.tabLabelInact);
        });
        this._panelTitle?.setText(TABS[this._activeTab]?.title ?? '');
    }

    _rebuildRows() {
        this._destroyRows();
        this._hideContextMenu();
        const controlled = this._controlledState;
        const tab = TABS[this._activeTab];
        if (!controlled || !tab) {
            this._goldText?.setText('');
            return;
        }

        this._goldText?.setText(`Gold: ${controlled.inventory?.gold ?? 0}`);

        let items = [];
        let equippedId = null;
        switch (tab.id) {
            case 'weapons':
                items = controlled.inventory?.weapons ?? [];
                equippedId = controlled.loadout?.equipped?.weaponId ?? null;
                break;
            case 'spells':
                items = controlled.spellbook?.knownSpells ?? [];
                equippedId = controlled.loadout?.equipped?.spellId ?? null;
                break;
            case 'armor':
                items = controlled.inventory?.armor ?? [];
                equippedId = controlled.loadout?.equipped?.armorSetId ?? null;
                break;
            case 'accessories':
                items = controlled.inventory?.accessories ?? [];
                equippedId = controlled.loadout?.equipped?.accessoryId ?? null;
                break;
            case 'consumables':
                items = controlled.inventory?.consumables ?? [];
                equippedId = controlled.loadout?.selectedConsumableDefinitionId ?? null;
                break;
            case 'resources':
                items = controlled.inventory?.resources ?? [];
                break;
        }

        if (!Array.isArray(items) || items.length === 0) {
            this._buildEmptyRow();
            return;
        }

        items.forEach((item, idx) => {
            const rowY = HEADER_H + GOLD_H + idx * (ROW_H + ROW_GAP);
            const rowX = RIBBON_W + ROW_PAD;
            const rowW = PANEL_W - ROW_PAD * 2;
            const itemId = item.definitionId ?? item.spellId ?? item.id ?? null;
            const equipped = itemId === equippedId;
            const label = this._formatRowLabel(item);

            const bg = this.scene.add.rectangle(rowX, rowY, rowW, ROW_H, equipped ? C.rowActive : C.rowInactive, 1)
                .setOrigin(0, 0)
                .setStrokeStyle(1, equipped ? C.rowBorderAct : C.rowBorderInact, 1)
                .setInteractive({ useHandCursor: true });
            const nameText = this.scene.add.text(rowX + 8, rowY + ROW_H / 2, label, {
                fontSize: '12px',
                fontFamily: GAME_FONT_FAMILY,
                color: equipped ? C.rowTextAct : C.rowTextInact,
            }).setOrigin(0, 0.5);

            bg.on('pointerover', () => {
                if (!equipped) bg.setFillStyle(C.rowHover, 1);
            });
            bg.on('pointerout', () => {
                if (!equipped) bg.setFillStyle(C.rowInactive, 1);
            });
            bg.on('pointerdown', (pointer) => this._onRowPointerDown(pointer, tab.id, item));

            this._container.add(bg);
            this._container.add(nameText);
            this._rows.push({ bg, nameText, glyphText: null });
        });
    }

    _formatRowLabel(item) {
        const base = item.displayName ?? item.name ?? item.definitionId ?? item.spellId ?? item.id ?? 'Unknown';
        const upgradeSuffix = Number.isFinite(item.upgradeLevel) && item.upgradeLevel > 0 ? ` +${item.upgradeLevel}` : '';
        const quantitySuffix = Number.isFinite(item.quantity) ? ` x${item.quantity}` : '';
        return `${base}${upgradeSuffix}${quantitySuffix}`;
    }

    _buildEmptyRow() {
        const rowY = HEADER_H + GOLD_H;
        const rowX = RIBBON_W + ROW_PAD;
        const rowW = PANEL_W - ROW_PAD * 2;
        const bg = this.scene.add.rectangle(rowX, rowY, rowW, ROW_H, 0x131c28, 0.6)
            .setOrigin(0, 0)
            .setStrokeStyle(1, 0x1e2e42, 1);
        const nameText = this.scene.add.text(rowX + rowW / 2, rowY + ROW_H / 2, 'none', {
            fontSize: '11px',
            fontFamily: GAME_FONT_FAMILY,
            color: C.mutedText,
        }).setOrigin(0.5, 0.5);
        this._container.add(bg);
        this._container.add(nameText);
        this._rows.push({ bg, nameText, glyphText: null });
    }

    _destroyRows() {
        this._rows.forEach(({ bg, nameText, glyphText }) => {
            this._container.remove(bg, true);
            this._container.remove(nameText, true);
            if (glyphText) this._container.remove(glyphText, true);
        });
        this._rows = [];
    }

    _onRowPointerDown(pointer, tabId, item) {
        const itemId = item?.definitionId ?? item?.spellId ?? item?.id ?? null;
        const rightClick = pointer?.rightButtonDown?.() || pointer?.button === 2;
        if (rightClick) {
            if (item?.canDrop || item?.canSell) this._showContextMenu(tabId, item, pointer);
            else this._hideContextMenu();
            return;
        }
        this._hideContextMenu();
        this._onItemClick(tabId, itemId);
    }

    _showContextMenu(tabId, item, pointer) {
        this._hideContextMenu();
        if ((!item?.canDrop && !item?.canSell) || typeof item?.entryId !== 'string') return;

        const options = [];
        if (item.canDrop) {
            options.push(
                { label: 'Drop 1', action: 'drop', mode: 'one' },
                { label: 'Drop All', action: 'drop', mode: 'all' },
            );
        }
        if (item.canSell) {
            options.push(
                { label: 'Sell 1', action: 'sell', mode: 'one' },
                { label: 'Sell All', action: 'sell', mode: 'all' },
            );
        }
        if (options.length === 0) return;
        const menuX = Phaser.Math.Clamp(
            pointer.worldX + 12 - this._container.x,
            RIBBON_W + 8,
            RIBBON_W + PANEL_W - 92
        );
        const menuY = Phaser.Math.Clamp(
            pointer.worldY - 6,
            HEADER_H + GOLD_H,
            this._height - Math.max(72, options.length * 28 + 8)
        );

        this._contextMenuItem = item;
        this._contextMenu = options.flatMap((option, index) => {
            const y = menuY + index * 28;
            const bg = this.scene.add.rectangle(menuX, y, 84, 24, 0x101926, 0.98)
                .setOrigin(0, 0)
                .setStrokeStyle(1, 0x4671a4, 1)
                .setInteractive({ useHandCursor: true });
            const label = this.scene.add.text(menuX + 42, y + 12, option.label, {
                fontSize: '11px',
                fontFamily: GAME_FONT_FAMILY,
                color: '#d8eeff',
            }).setOrigin(0.5, 0.5);
            bg.on('pointerover', () => bg.setFillStyle(0x1f2f48, 1));
            bg.on('pointerout', () => bg.setFillStyle(0x101926, 0.98));
            bg.on('pointerdown', () => {
                if (option.action === 'sell') {
                    eventBus.emit('ui:sellEntry', { entryId: item.entryId, mode: option.mode, tabId });
                } else {
                    eventBus.emit('ui:dropEntry', { entryId: item.entryId, mode: option.mode, tabId });
                }
                this._hideContextMenu();
            });
            this._container.add(bg);
            this._container.add(label);
            return [bg, label];
        });
    }

    _hideContextMenu() {
        if (this._contextMenu.length === 0) return;
        this._contextMenu.forEach((node) => this._container.remove(node, true));
        this._contextMenu = [];
        this._contextMenuItem = null;
    }

    _onItemClick(tabId, itemId) {
        const pending = uiStateStore.get('pendingSlotAssignment');
        switch (tabId) {
            case 'weapons':
                if (pending?.type !== 'weapon') return;
                eventBus.emit('ui:assignWeaponSlot', { slotIndex: pending.slotIndex, id: itemId });
                uiStateStore.set('pendingSlotAssignment', null);
                break;
            case 'spells':
                if (pending?.type !== 'spell') return;
                eventBus.emit('ui:assignSpellSlot', { slotIndex: pending.slotIndex, id: itemId });
                uiStateStore.set('pendingSlotAssignment', null);
                break;
            case 'consumables':
                if (pending?.type !== 'consumable') return;
                eventBus.emit('ui:assignConsumableSlot', { slotIndex: pending.slotIndex, id: itemId });
                uiStateStore.set('pendingSlotAssignment', null);
                break;
            case 'armor':
                this.onEquip.armor?.(itemId);
                break;
            case 'accessories':
                this.onEquip.accessory?.(itemId);
                break;
        }
        this._radial?.refresh(this._controlledState?.loadout ?? null, { selectedSlot: null });
    }

    _tweenTo(targetX) {
        if (this._activeTween) {
            this._activeTween.stop();
            this._activeTween = null;
        }

        const startX = this._container.x;
        const tweenObj = { t: 0 };
        this._activeTween = this.scene.tweens.add({
            targets: tweenObj,
            t: 1,
            duration: TWEEN_DURATION,
            ease: 'Quad.easeOut',
            onUpdate: () => {
                this._container.x = Phaser.Math.Linear(startX, targetX, tweenObj.t);
            },
            onComplete: () => {
                this._container.x = targetX;
                this._activeTween = null;
            },
        });
    }
}
