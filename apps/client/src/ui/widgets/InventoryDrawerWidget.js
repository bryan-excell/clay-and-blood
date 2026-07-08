/**
 * Slide-in character drawer for stats, equipment, and inventory.
 */

import Phaser from 'phaser';
import { GAME_FONT_FAMILY } from '../../config.js';
import { uiStateStore } from '../../core/UiStateStore.js';
import { eventBus } from '../../core/EventBus.js';

const RIBBON_W = 52;
const PANEL_W = 500;
export const DRAWER_TOTAL_W = RIBBON_W + PANEL_W;

const TAB_H = 54;
const TAB_PAD = 5;
const ROW_H = 32;
const ROW_GAP = 5;
const ROW_PAD = 10;
const HEADER_H = 38;
const GOLD_H = 26;
const TWEEN_DURATION = 180;
const UNEQUIP_ID = '__unequip__';

const TABS = Object.freeze([
    { id: 'stats', label: 'C', title: 'Character Stats' },
    { id: 'equipment', label: 'E', title: 'Equipment' },
    { id: 'inventory', label: 'I', title: 'Inventory' },
]);

const INVENTORY_FILTERS = Object.freeze([
    { id: 'all', label: 'All' },
    { id: 'consumables', label: 'Consumables' },
    { id: 'resources', label: 'Resources' },
]);

const C = Object.freeze({
    ribbonBg: 0x0e1520,
    panelBg: 0x141d2a,
    tabInactive: 0x1a2535,
    tabActive: 0x1f3b57,
    tabBorderInact: 0x273545,
    tabBorderAct: 0x5d91c7,
    tabLabelInact: '#6a8aaa',
    tabLabelAct: '#d8eeff',
    panelTitle: '#a9c8e4',
    rowInactive: 0x192030,
    rowActive: 0x1f3a58,
    rowSelected: 0x29496c,
    rowBorderInact: 0x263545,
    rowBorderAct: 0x4f86bd,
    rowTextInact: '#9fbed8',
    rowTextAct: '#e2f2ff',
    rowHover: 0x22304a,
    goldText: '#f1d77a',
    mutedText: '#647d96',
    sectionText: '#7899b7',
    statFill: 0x3d78a8,
    danger: 0x8d3333,
});

export class InventoryDrawerWidget {
    constructor(scene, onEquip = {}, height = 600) {
        this.scene = scene;
        this.onEquip = onEquip;

        this._open = false;
        this._activeTab = 1;
        this._inventoryFilter = 'all';
        this._controlledState = null;
        this._rowsKey = null;
        this._height = height;
        this._activeTween = null;
        this._contextMenu = [];

        this._container = null;
        this._ribbonBg = null;
        this._panelBg = null;
        this._panelTitle = null;
        this._goldText = null;
        this._tabButtons = [];
        this._rows = [];

        this._handleScenePointerDown = (pointer) => {
            const rightClick = pointer?.rightButtonDown?.() || pointer?.button === 2;
            if (!rightClick) this._hideContextMenu();
        };

        this._build();
        this.scene.input.on('pointerdown', this._handleScenePointerDown);
    }

    toggle() {
        if (this._open) this.close();
        else this.open();
    }

    open() {
        if (this._open) return;
        this._open = true;
        this._tweenTo(0);
    }

    close() {
        if (!this._open) return;
        this._open = false;
        uiStateStore.set('pendingSlotAssignment', null);
        this._tweenTo(-DRAWER_TOTAL_W);
    }

    get isOpen() {
        return this._open;
    }

    update(controlledState) {
        this._controlledState = controlledState ?? null;
        const key = this._controlledState
            ? JSON.stringify(this._controlledState)
                + '|' + this._activeTab
                + '|' + this._inventoryFilter
                + '|' + JSON.stringify(uiStateStore.get('pendingSlotAssignment'))
            : '';
        if (key === this._rowsKey) return;
        this._rowsKey = key;
        this._rebuildRows();
    }

    setHeight(height) {
        this._height = height;
        this._ribbonBg?.setSize(RIBBON_W, height);
        this._panelBg?.setSize(PANEL_W, height);
    }

    destroy() {
        this._destroyRows();
        this._hideContextMenu();
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
        this._panelBg = scene.add.rectangle(RIBBON_W, 0, PANEL_W, this._height, C.panelBg, 0.96)
            .setOrigin(0, 0)
            .setStrokeStyle(1, 0x1e2e42, 1)
            .setInteractive();
        this._panelTitle = scene.add.text(RIBBON_W + PANEL_W / 2, 10, TABS[this._activeTab].title, {
            fontSize: '14px',
            fontFamily: GAME_FONT_FAMILY,
            color: C.panelTitle,
        }).setOrigin(0.5, 0);
        this._goldText = scene.add.text(RIBBON_W + ROW_PAD, HEADER_H, '', {
            fontSize: '12px',
            fontFamily: GAME_FONT_FAMILY,
            color: C.goldText,
        }).setOrigin(0, 0);

        this._container.add([this._ribbonBg, this._panelBg, this._panelTitle, this._goldText]);

        this._tabButtons = TABS.map((tab, index) => {
            const ty = index * TAB_H + TAB_PAD;
            const bw = RIBBON_W - TAB_PAD * 2;
            const bh = TAB_H - TAB_PAD;
            const bg = scene.add.rectangle(TAB_PAD, ty, bw, bh, C.tabInactive, 1)
                .setOrigin(0, 0)
                .setStrokeStyle(1, C.tabBorderInact, 1)
                .setInteractive({ useHandCursor: true });
            const label = scene.add.text(TAB_PAD + bw / 2, ty + bh / 2, tab.label, {
                fontSize: '16px',
                fontFamily: GAME_FONT_FAMILY,
                color: C.tabLabelInact,
            }).setOrigin(0.5, 0.5);

            bg.on('pointerdown', () => this._setTab(index));
            bg.on('pointerover', () => {
                if (this._activeTab !== index) bg.setFillStyle(0x22334a, 1);
            });
            bg.on('pointerout', () => {
                if (this._activeTab !== index) bg.setFillStyle(C.tabInactive, 1);
            });

            this._container.add([bg, label]);
            return { bg, label };
        });

        this._refreshTabHighlights();
    }

    _setTab(index) {
        if (this._activeTab === index) return;
        this._activeTab = index;
        this._hideContextMenu();
        if (TABS[index]?.id !== 'equipment') uiStateStore.set('pendingSlotAssignment', null);
        this._refreshTabHighlights();
        this._rebuildRows();
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

        if (tab.id === 'stats') this._buildStatsTab(controlled);
        else if (tab.id === 'equipment') this._buildEquipmentTab(controlled);
        else this._buildInventoryTab(controlled);
    }

    _buildStatsTab(controlled) {
        let y = HEADER_H + GOLD_H + 8;
        y = this._addSectionLabel('Vitals', y);
        y = this._addStatBar('HP', controlled.hp, controlled.hpMax, y, 0x4fa568);
        y = this._addStatBar('MP', controlled.mana, controlled.manaMax, y, 0x4c83c7);
        y = this._addStatBar('ST', controlled.stamina, controlled.staminaMax, y, 0xb5a14a);
        y += 8;
        y = this._addSectionLabel('Character', y);
        y = this._addInfoRow('Form', controlled.entityType ?? 'unknown', y);
        y = this._addInfoRow('Level', '1', y);
        y = this._addInfoRow('XP', '0 / 0', y);
        y += 8;
        y = this._addSectionLabel('Active Effects', y);
        const buffs = Array.isArray(controlled.buffs) ? controlled.buffs : [];
        if (buffs.length === 0) {
            this._addEmptyRow(y, 'none');
            return;
        }
        buffs.slice(0, 6).forEach((buff, index) => {
            this._addInfoRow(buff?.type ?? 'effect', `${Math.ceil((buff?.remainingMs ?? 0) / 1000)}s`, y + index * (ROW_H + ROW_GAP));
        });
    }

    _buildEquipmentTab(controlled) {
        const loadout = controlled.loadout ?? {};
        const pending = this._getEquipmentSelection(controlled);
        let y = HEADER_H + GOLD_H + 4;

        y = this._addSectionLabel('Weapon Slots', y);
        const slots = Array.isArray(loadout.actionSlots) ? loadout.actionSlots : [];
        for (let index = 0; index < 4; index += 1) {
            const item = slots[index] ?? { id: 'unarmed', name: 'Unarmed' };
            const active = (loadout.activeActionSlotIndex ?? 0) === index;
            const selected = pending?.type === 'action' && pending.slotIndex === index;
            y = this._addSlotRow({
                label: `${index + 1}`,
                name: item?.name ?? item?.id ?? 'Unarmed',
                y,
                active,
                selected,
                onClick: () => this._setPending({ type: 'action', slotIndex: index }),
            });
        }

        y += 14;
        y = this._addSectionLabel('Consumable', y);
        const consumable = loadout.consumableSlots?.[0] ?? null;
        y = this._addSlotRow({
            label: 'Q',
            name: consumable?.id && consumable.id !== 'nothing'
                ? `${consumable.name ?? consumable.id} x${consumable.quantity ?? 0}`
                : 'Nothing',
            y,
            selected: pending?.type === 'consumable',
            onClick: () => this._setPending({ type: 'consumable', slotIndex: 0 }),
        });

        y += 14;
        y = this._addSectionLabel('Armor', y);
        y = this._addSlotRow({
            label: 'AR',
            name: this._findById(loadout.armorSets, loadout.equipped?.armorSetId)?.name ?? 'None',
            y,
            selected: pending?.type === 'armor',
            onClick: () => this._setPending({ type: 'armor' }),
        });

        y += 14;
        y = this._addSectionLabel('Accessory', y);
        y = this._addSlotRow({
            label: 'AC',
            name: this._findById(loadout.accessories, loadout.equipped?.accessoryId)?.name ?? 'None',
            y,
            selected: pending?.type === 'accessory',
            onClick: () => this._setPending({ type: 'accessory' }),
        });

        y += 22;
        this._buildEquipmentCandidates(controlled, pending, y);
    }

    _buildEquipmentCandidates(controlled, pending, y) {
        const mode = pending?.type ?? 'action';
        const title = mode === 'action'
            ? `Weapons - Slot ${(pending?.slotIndex ?? 0) + 1}`
            : mode === 'consumable'
                ? 'Consumables'
                : mode === 'armor'
                    ? 'Armor'
                    : 'Accessories';
        y = this._addSectionLabel(title, y);

        const items = this._getEquipmentCandidates(controlled, mode);
        if (items.length === 0) {
            this._addEmptyRow(y, 'none');
            return;
        }

        const maxRows = Math.max(1, Math.floor((this._height - y - 8) / (ROW_H + ROW_GAP)));
        items.slice(0, maxRows).forEach((item, index) => {
            const itemY = y + index * (ROW_H + ROW_GAP);
            const itemId = item.definitionId ?? item.spellId ?? item.id ?? null;
            const equipped = this._isCandidateEquipped(controlled, mode, itemId, pending);
            this._addItemRow({
                item,
                y: itemY,
                equipped,
                onClick: () => this._onEquipmentCandidateClick(mode, pending, itemId),
            });
        });
    }

    _buildInventoryTab(controlled) {
        let y = HEADER_H + GOLD_H + 8;
        y = this._buildInventoryFilters(y);
        y += 6;

        const items = this._getInventoryItems(controlled);
        if (items.length === 0) {
            this._addEmptyRow(y, 'none');
            return;
        }

        const maxRows = Math.max(1, Math.floor((this._height - y - 8) / (ROW_H + ROW_GAP)));
        items.slice(0, maxRows).forEach((item, index) => {
            this._addItemRow({
                item,
                y: y + index * (ROW_H + ROW_GAP),
                onClick: null,
            });
        });
    }

    _buildInventoryFilters(y) {
        const x = RIBBON_W + ROW_PAD;
        const gap = 5;
        const widths = [48, 104, 94];
        let nextX = x;

        INVENTORY_FILTERS.forEach((filter, index) => {
            const active = this._inventoryFilter === filter.id;
            const bg = this.scene.add.rectangle(nextX, y, widths[index], 26, active ? C.rowSelected : C.rowInactive, 1)
                .setOrigin(0, 0)
                .setStrokeStyle(1, active ? C.rowBorderAct : C.rowBorderInact, 1)
                .setInteractive({ useHandCursor: true });
            const label = this.scene.add.text(nextX + widths[index] / 2, y + 13, filter.label, {
                fontSize: '11px',
                fontFamily: GAME_FONT_FAMILY,
                color: active ? C.rowTextAct : C.rowTextInact,
            }).setOrigin(0.5, 0.5);
            bg.on('pointerdown', () => {
                this._inventoryFilter = filter.id;
                this._rebuildRows();
            });
            this._container.add([bg, label]);
            this._rows.push(bg, label);
            nextX += widths[index] + gap;
        });

        return y + 28;
    }

    _getEquipmentSelection(controlled) {
        const pending = uiStateStore.get('pendingSlotAssignment');
        if (pending?.type) return pending;
        return {
            type: 'action',
            slotIndex: controlled.loadout?.activeActionSlotIndex ?? 0,
            implicit: true,
        };
    }

    _setPending(next) {
        uiStateStore.set('pendingSlotAssignment', next);
        this._rebuildRows();
    }

    _getEquipmentCandidates(controlled, mode) {
        const unequip = { id: UNEQUIP_ID, name: 'Unequip' };
        if (mode === 'action') {
            const actionWeapons = (controlled.loadout?.actionWeapons ?? []).filter((item) => item?.id !== 'unarmed');
            return [unequip, ...actionWeapons];
        }
        if (mode === 'consumable') return [unequip, ...(controlled.inventory?.consumables ?? [])];
        if (mode === 'armor') return [unequip, ...(controlled.loadout?.armorSets ?? [])];
        if (mode === 'accessory') return [unequip, ...(controlled.loadout?.accessories ?? [])];
        return [];
    }

    _getInventoryItems(controlled) {
        const inventory = controlled.inventory ?? {};
        if (this._inventoryFilter === 'consumables') return inventory.consumables ?? [];
        if (this._inventoryFilter === 'resources') return inventory.resources ?? [];
        return [
            ...(inventory.armor ?? []),
            ...(inventory.accessories ?? []),
            ...(inventory.consumables ?? []),
            ...(inventory.resources ?? []),
        ];
    }

    _isCandidateEquipped(controlled, mode, itemId, pending) {
        const loadout = controlled.loadout ?? {};
        if (itemId === UNEQUIP_ID) {
            if (mode === 'action') return loadout.actionSlots?.[pending?.slotIndex ?? 0]?.id === 'unarmed';
            if (mode === 'consumable') return (loadout.consumableSlots?.[0]?.id ?? 'nothing') === 'nothing';
            if (mode === 'armor') return !loadout.equipped?.armorSetId;
            if (mode === 'accessory') return !loadout.equipped?.accessoryId;
        }
        if (mode === 'action') return loadout.actionSlots?.[pending?.slotIndex ?? 0]?.id === itemId;
        if (mode === 'consumable') return loadout.consumableSlots?.[0]?.id === itemId;
        if (mode === 'armor') return loadout.equipped?.armorSetId === itemId;
        if (mode === 'accessory') return loadout.equipped?.accessoryId === itemId;
        return false;
    }

    _onEquipmentCandidateClick(mode, pending, itemId) {
        if (!itemId) return;
        if (itemId === UNEQUIP_ID) {
            this._onUnequipCandidateClick(mode, pending);
            return;
        }
        if (mode === 'action') {
            eventBus.emit('ui:assignActionSlot', { slotIndex: pending?.slotIndex ?? 0, id: itemId });
            return;
        }
        if (mode === 'consumable') {
            eventBus.emit('ui:assignConsumableSlot', { slotIndex: 0, id: itemId });
            return;
        }
        if (mode === 'armor') {
            this.onEquip.armor?.(itemId);
            return;
        }
        if (mode === 'accessory') {
            this.onEquip.accessory?.(itemId);
        }
    }

    _onUnequipCandidateClick(mode, pending) {
        if (mode === 'action') {
            eventBus.emit('ui:assignActionSlot', { slotIndex: pending?.slotIndex ?? 0, id: 'unarmed' });
            return;
        }
        if (mode === 'consumable') {
            eventBus.emit('ui:assignConsumableSlot', { slotIndex: 0, id: 'nothing' });
            return;
        }
        if (mode === 'armor') {
            this.onEquip.armor?.(null);
            return;
        }
        if (mode === 'accessory') {
            this.onEquip.accessory?.(null);
        }
    }

    _addSectionLabel(label, y) {
        const text = this.scene.add.text(RIBBON_W + ROW_PAD, y, label, {
            fontSize: '11px',
            fontFamily: GAME_FONT_FAMILY,
            color: C.sectionText,
        }).setOrigin(0, 0);
        this._container.add(text);
        this._rows.push(text);
        return y + 18;
    }

    _addSlotRow({ label, name, y, active = false, selected = false, onClick }) {
        const rowX = RIBBON_W + ROW_PAD;
        const rowW = PANEL_W - ROW_PAD * 2;
        const fill = selected ? C.rowSelected : (active ? C.rowActive : C.rowInactive);
        const bg = this.scene.add.rectangle(rowX, y, rowW, ROW_H, fill, 1)
            .setOrigin(0, 0)
            .setStrokeStyle(selected || active ? 2 : 1, selected || active ? C.rowBorderAct : C.rowBorderInact, 1)
            .setInteractive({ useHandCursor: true });
        const keyText = this.scene.add.text(rowX + 12, y + ROW_H / 2, label, {
            fontSize: '11px',
            fontFamily: GAME_FONT_FAMILY,
            color: selected || active ? C.rowTextAct : C.rowTextInact,
        }).setOrigin(0.5, 0.5);
        const nameText = this.scene.add.text(rowX + 34, y + ROW_H / 2, name, {
            fontSize: '12px',
            fontFamily: GAME_FONT_FAMILY,
            color: selected || active ? C.rowTextAct : C.rowTextInact,
        }).setOrigin(0, 0.5);

        bg.on('pointerover', () => {
            if (!selected && !active) bg.setFillStyle(C.rowHover, 1);
        });
        bg.on('pointerout', () => {
            if (!selected && !active) bg.setFillStyle(C.rowInactive, 1);
        });
        bg.on('pointerdown', onClick);

        this._container.add([bg, keyText, nameText]);
        this._rows.push(bg, keyText, nameText);
        return y + ROW_H + ROW_GAP;
    }

    _addItemRow({ item, y, equipped = false, onClick = null }) {
        const rowX = RIBBON_W + ROW_PAD;
        const rowW = PANEL_W - ROW_PAD * 2;
        const bg = this.scene.add.rectangle(rowX, y, rowW, ROW_H, equipped ? C.rowActive : C.rowInactive, 1)
            .setOrigin(0, 0)
            .setStrokeStyle(1, equipped ? C.rowBorderAct : C.rowBorderInact, 1)
            .setInteractive({ useHandCursor: !!onClick });
        const label = this.scene.add.text(rowX + 8, y + ROW_H / 2, this._formatRowLabel(item), {
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
        bg.on('pointerdown', (pointer) => {
            const rightClick = pointer?.rightButtonDown?.() || pointer?.button === 2;
            if (rightClick) {
                if (item?.canDrop) this._showContextMenu(item, pointer);
                else this._hideContextMenu();
                return;
            }
            this._hideContextMenu();
            onClick?.();
        });

        this._container.add([bg, label]);
        this._rows.push(bg, label);
    }

    _addInfoRow(label, value, y) {
        const rowX = RIBBON_W + ROW_PAD;
        const rowW = PANEL_W - ROW_PAD * 2;
        const bg = this.scene.add.rectangle(rowX, y, rowW, ROW_H, C.rowInactive, 0.82)
            .setOrigin(0, 0)
            .setStrokeStyle(1, C.rowBorderInact, 0.8);
        const labelText = this.scene.add.text(rowX + 8, y + ROW_H / 2, label, {
            fontSize: '12px',
            fontFamily: GAME_FONT_FAMILY,
            color: C.rowTextInact,
        }).setOrigin(0, 0.5);
        const valueText = this.scene.add.text(rowX + rowW - 8, y + ROW_H / 2, value, {
            fontSize: '12px',
            fontFamily: GAME_FONT_FAMILY,
            color: C.rowTextAct,
        }).setOrigin(1, 0.5);
        this._container.add([bg, labelText, valueText]);
        this._rows.push(bg, labelText, valueText);
        return y + ROW_H + ROW_GAP;
    }

    _addStatBar(label, value, max, y, color) {
        const rowX = RIBBON_W + ROW_PAD;
        const rowW = PANEL_W - ROW_PAD * 2;
        const safeMax = Number.isFinite(max) && max > 0 ? max : 1;
        const pct = Phaser.Math.Clamp((Number.isFinite(value) ? value : 0) / safeMax, 0, 1);
        const bg = this.scene.add.rectangle(rowX, y, rowW, ROW_H, C.rowInactive, 0.86)
            .setOrigin(0, 0)
            .setStrokeStyle(1, C.rowBorderInact, 1);
        const fill = this.scene.add.rectangle(rowX + 1, y + 1, Math.max(1, (rowW - 2) * pct), ROW_H - 2, color, 0.72)
            .setOrigin(0, 0);
        const text = this.scene.add.text(rowX + 8, y + ROW_H / 2, `${label} ${Math.floor(value ?? 0)} / ${Math.floor(max ?? 0)}`, {
            fontSize: '12px',
            fontFamily: GAME_FONT_FAMILY,
            color: C.rowTextAct,
        }).setOrigin(0, 0.5);
        this._container.add([bg, fill, text]);
        this._rows.push(bg, fill, text);
        return y + ROW_H + ROW_GAP;
    }

    _addEmptyRow(y, label) {
        const rowX = RIBBON_W + ROW_PAD;
        const rowW = PANEL_W - ROW_PAD * 2;
        const bg = this.scene.add.rectangle(rowX, y, rowW, ROW_H, 0x131c28, 0.6)
            .setOrigin(0, 0)
            .setStrokeStyle(1, 0x1e2e42, 1);
        const text = this.scene.add.text(rowX + rowW / 2, y + ROW_H / 2, label, {
            fontSize: '11px',
            fontFamily: GAME_FONT_FAMILY,
            color: C.mutedText,
        }).setOrigin(0.5, 0.5);
        this._container.add([bg, text]);
        this._rows.push(bg, text);
    }

    _formatRowLabel(item) {
        const base = item.displayName ?? item.name ?? item.definitionId ?? item.spellId ?? item.id ?? 'Unknown';
        const upgradeSuffix = Number.isFinite(item.upgradeLevel) && item.upgradeLevel > 0 ? ` +${item.upgradeLevel}` : '';
        const quantitySuffix = Number.isFinite(item.quantity) ? ` x${item.quantity}` : '';
        return `${base}${upgradeSuffix}${quantitySuffix}`;
    }

    _findById(items, id) {
        if (!id || !Array.isArray(items)) return null;
        return items.find((item) => item?.id === id || item?.definitionId === id) ?? null;
    }

    _showContextMenu(item, pointer) {
        this._hideContextMenu();
        if (!item?.canDrop || typeof item?.entryId !== 'string') return;

        const options = [
            { label: 'Drop 1', mode: 'one' },
            { label: 'Drop All', mode: 'all' },
        ];
        const menuX = Phaser.Math.Clamp(
            pointer.x + 12 - this._container.x,
            RIBBON_W + 8,
            RIBBON_W + PANEL_W - 92
        );
        const menuY = Phaser.Math.Clamp(
            pointer.y - 6,
            HEADER_H + GOLD_H,
            this._height - Math.max(72, options.length * 28 + 8)
        );

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
                eventBus.emit('ui:dropEntry', { entryId: item.entryId, mode: option.mode });
                this._hideContextMenu();
            });
            this._container.add([bg, label]);
            return [bg, label];
        });
    }

    _hideContextMenu() {
        if (this._contextMenu.length === 0) return;
        this._contextMenu.forEach((node) => this._container.remove(node, true));
        this._contextMenu = [];
    }

    _destroyRows() {
        this._rows.forEach((node) => this._container.remove(node, true));
        this._rows = [];
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
