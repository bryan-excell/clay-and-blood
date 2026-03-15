import Phaser from 'phaser';
import { GAME_FONT_FAMILY } from '../../config.js';
import { SPELLS, getItemDef } from '../../data/ItemRegistry.js';

const PANEL_W = 640;
const PANEL_H = 420;
const HEADER_H = 56;
const FOOTER_H = 84;
const COL_GAP = 18;
const COL_W = 270;
const ROW_H = 28;
const ROW_GAP = 4;
const ROW_MAX = 8;
const MAX_UPGRADE_LEVEL = 3;
const COST_BY_LEVEL = Object.freeze({
    0: Object.freeze({ gold: 100, materials: 1 }),
    1: Object.freeze({ gold: 200, materials: 2 }),
    2: Object.freeze({ gold: 300, materials: 3 }),
});

const C = Object.freeze({
    bg: 0x131a25,
    panelBorder: 0x587a98,
    header: '#d8e9ff',
    gold: '#f1d77a',
    subhead: '#8eb5da',
    rowReady: 0x1b3a29,
    rowMissing: 0x3a2020,
    rowHover: 0x203249,
    rowSelected: 0x244669,
    rowBorder: 0x2e435a,
    rowSelectedBorder: 0x5f95d0,
    rowText: '#d8eeff',
    muted: '#6c86a0',
    ok: '#a8dfa0',
    bad: '#e39a9a',
    action: 0x29486d,
    actionDisabled: 0x1a2634,
    actionBorder: 0x5a89ba,
    actionText: '#e8f4ff',
    actionTextDisabled: '#6d849c',
});

function getCost(currentLevel) {
    return COST_BY_LEVEL[currentLevel] ?? null;
}

function getSpellName(spellId) {
    return SPELLS[spellId]?.name ?? spellId;
}

export class UpgraderWidget {
    constructor(scene) {
        this.scene = scene;
        this.visible = false;
        this._controlledState = null;
        this._context = null;
        this._selection = null;
        this._renderKey = null;
        this._rowNodes = [];
        this._detailNodes = [];
        this._actionNodes = [];

        this._container = scene.add.container(0, 0).setDepth(620).setVisible(false);
        this._bg = scene.add.rectangle(0, 0, PANEL_W, PANEL_H, C.bg, 0.97)
            .setOrigin(0.5, 0.5)
            .setStrokeStyle(2, C.panelBorder, 1);
        this._title = scene.add.text(0, -PANEL_H / 2 + 16, 'Upgrader', {
            fontSize: '22px',
            fontFamily: GAME_FONT_FAMILY,
            color: C.header,
        }).setOrigin(0.5, 0);
        this._gold = scene.add.text(0, -PANEL_H / 2 + 18, '', {
            fontSize: '14px',
            fontFamily: GAME_FONT_FAMILY,
            color: C.gold,
        }).setOrigin(0, 0);
        this._leftHeader = scene.add.text(-COL_GAP / 2 - COL_W / 2, -PANEL_H / 2 + HEADER_H, 'Items', {
            fontSize: '16px',
            fontFamily: GAME_FONT_FAMILY,
            color: C.subhead,
        }).setOrigin(0.5, 0);
        this._rightHeader = scene.add.text(COL_GAP / 2 + COL_W / 2, -PANEL_H / 2 + HEADER_H, 'Upgrade Preview', {
            fontSize: '16px',
            fontFamily: GAME_FONT_FAMILY,
            color: C.subhead,
        }).setOrigin(0.5, 0);
        this._container.add([this._bg, this._title, this._gold, this._leftHeader, this._rightHeader]);
    }

    get width() { return PANEL_W; }
    get height() { return PANEL_H; }

    setPosition(x, y) {
        this._container.setPosition(x, y);
        this._gold.setPosition(-PANEL_W / 2 + 18, -PANEL_H / 2 + 18);
    }

    show() {
        this.visible = true;
        this._container.setVisible(true);
    }

    hide() {
        this.visible = false;
        this._container.setVisible(false);
        this._selection = null;
        this._renderKey = null;
    }

    update(controlledState, context) {
        this._controlledState = controlledState ?? null;
        this._context = context ?? null;
        if (!this.visible) return;
        const nextKey = this._buildRenderKey();
        if (nextKey === this._renderKey) return;
        this._renderKey = nextKey;
        this._render();
    }

    destroy() {
        this._clearRows();
        this._clearDetails();
        this._clearActions();
        this._container.destroy(true);
    }

    _render() {
        const gold = this._controlledState?.inventory?.gold ?? 0;
        this._title.setText(this._context?.title ?? 'Upgrader');
        this._gold.setText(`Gold: ${gold}`);

        const candidates = this._buildCandidates();
        if (this._selection && !candidates.some((entry) => entry.id === this._selection)) {
            this._selection = candidates[0]?.id ?? null;
        }
        if (!this._selection && candidates[0]) {
            this._selection = candidates[0].id;
        }

        this._clearRows();
        this._clearDetails();
        this._clearActions();
        this._buildLeftList(candidates);
        this._buildRightPane(candidates, gold);
    }

    _buildCandidates() {
        const mode = this._context?.type;
        const gold = this._controlledState?.inventory?.gold ?? 0;
        if (mode === 'weapon') {
            const materialQty = this._controlledState?.inventory?.resources?.find((entry) => entry.definitionId === 'weapon_upgrade_material')?.quantity ?? 0;
            return (this._controlledState?.inventory?.weapons ?? []).map((row) => {
                const nextLevel = (row.upgradeLevel ?? 0) + 1;
                const cost = getCost(row.upgradeLevel ?? 0);
                const canUpgrade = !!cost && (row.upgradeLevel ?? 0) < MAX_UPGRADE_LEVEL;
                const affordable = !!cost && materialQty >= cost.materials && gold >= cost.gold && canUpgrade;
                return {
                    id: row.entryId,
                    displayName: row.displayName,
                    definitionId: row.definitionId,
                    upgradeLevel: row.upgradeLevel ?? 0,
                    nextLabel: `${row.displayName}${nextLevel > 0 ? ` +${nextLevel}` : ''}`,
                    cost,
                    affordable,
                    canUpgrade,
                    materialDefinitionId: 'weapon_upgrade_material',
                    materialName: 'Weapon Upgrade Material',
                };
            });
        }

        const materialQty = this._controlledState?.inventory?.resources?.find((entry) => entry.definitionId === 'spell_upgrade_material')?.quantity ?? 0;
        return (this._controlledState?.spellbook?.knownSpells ?? []).map((row) => {
            const nextLevel = (row.upgradeLevel ?? 0) + 1;
            const cost = getCost(row.upgradeLevel ?? 0);
            const canUpgrade = !!cost && (row.upgradeLevel ?? 0) < MAX_UPGRADE_LEVEL;
            const affordable = !!cost && materialQty >= cost.materials && gold >= cost.gold && canUpgrade;
            return {
                id: row.spellId,
                displayName: row.displayName,
                spellId: row.spellId,
                upgradeLevel: row.upgradeLevel ?? 0,
                nextLabel: `${row.displayName}${nextLevel > 0 ? ` +${nextLevel}` : ''}`,
                cost,
                affordable,
                canUpgrade,
                materialDefinitionId: 'spell_upgrade_material',
                materialName: 'Spell Upgrade Material',
            };
        });
    }

    _buildLeftList(candidates) {
        const startX = -COL_GAP / 2 - COL_W;
        const startY = -PANEL_H / 2 + HEADER_H + 28;
        const visibleRows = candidates.slice(0, ROW_MAX);
        if (visibleRows.length === 0) {
            const text = this.scene.add.text(startX + COL_W / 2, startY + 18, 'Nothing to upgrade', {
                fontSize: '12px',
                fontFamily: GAME_FONT_FAMILY,
                color: C.muted,
            }).setOrigin(0.5, 0.5);
            this._container.add(text);
            this._rowNodes.push(text);
            return;
        }

        visibleRows.forEach((row, index) => {
            const y = startY + index * (ROW_H + ROW_GAP);
            const selected = this._selection === row.id;
            const fill = selected ? C.rowSelected : (row.affordable ? C.rowReady : C.rowMissing);
            const border = selected ? C.rowSelectedBorder : C.rowBorder;
            const bg = this.scene.add.rectangle(startX, y, COL_W, ROW_H, fill, 0.95)
                .setOrigin(0, 0)
                .setStrokeStyle(1, border, 1)
                .setInteractive({ useHandCursor: true });
            const label = this.scene.add.text(startX + 8, y + ROW_H / 2, this._formatLeftLabel(row), {
                fontSize: '12px',
                fontFamily: GAME_FONT_FAMILY,
                color: C.rowText,
            }).setOrigin(0, 0.5);
            bg.on('pointerover', () => {
                if (!selected) bg.setFillStyle(C.rowHover, 1);
            });
            bg.on('pointerout', () => {
                if (!selected) bg.setFillStyle(row.affordable ? C.rowReady : C.rowMissing, 0.95);
            });
            bg.on('pointerdown', () => {
                this._selection = row.id;
                this._renderKey = null;
                this._render();
            });
            this._container.add([bg, label]);
            this._rowNodes.push(bg, label);
        });
    }

    _buildRightPane(candidates, gold) {
        const selected = candidates.find((row) => row.id === this._selection) ?? null;
        const baseX = COL_GAP / 2;
        const startY = -PANEL_H / 2 + HEADER_H + 34;
        if (!selected) {
            const text = this.scene.add.text(baseX + COL_W / 2, startY, 'Select an item to preview its upgrade.', {
                fontSize: '12px',
                fontFamily: GAME_FONT_FAMILY,
                color: C.muted,
                align: 'center',
                wordWrap: { width: COL_W - 24 },
            }).setOrigin(0.5, 0);
            this._container.add(text);
            this._detailNodes.push(text);
            return;
        }

        const materialQty = this._controlledState?.inventory?.resources?.find((entry) => entry.definitionId === selected.materialDefinitionId)?.quantity ?? 0;
        const title = this.scene.add.text(baseX + COL_W / 2, startY, selected.nextLabel, {
            fontSize: '18px',
            fontFamily: GAME_FONT_FAMILY,
            color: C.header,
            align: 'center',
            wordWrap: { width: COL_W - 20 },
        }).setOrigin(0.5, 0);
        this._container.add(title);
        this._detailNodes.push(title);

        const currentText = this.scene.add.text(baseX + 8, startY + 48, `${selected.displayName} +${selected.upgradeLevel}`, {
            fontSize: '13px',
            fontFamily: GAME_FONT_FAMILY,
            color: '#a8c2dd',
        }).setOrigin(0, 0);
        this._container.add(currentText);
        this._detailNodes.push(currentText);

        if (!selected.canUpgrade || !selected.cost) {
            const maxed = this.scene.add.text(baseX + 8, startY + 86, 'Max upgrade reached', {
                fontSize: '14px',
                fontFamily: GAME_FONT_FAMILY,
                color: C.bad,
            }).setOrigin(0, 0);
            this._container.add(maxed);
            this._detailNodes.push(maxed);
            this._buildActionButton('Upgrade', false, null);
            return;
        }

        const materialColor = materialQty >= selected.cost.materials ? C.ok : C.bad;
        const goldColor = gold >= selected.cost.gold ? C.ok : C.bad;
        const materialText = this.scene.add.text(baseX + 8, startY + 86, `${selected.materialName} x${selected.cost.materials} (${materialQty})`, {
            fontSize: '14px',
            fontFamily: GAME_FONT_FAMILY,
            color: materialColor,
        }).setOrigin(0, 0);
        const goldText = this.scene.add.text(baseX + 8, startY + 114, `Gold ${selected.cost.gold} (${gold})`, {
            fontSize: '14px',
            fontFamily: GAME_FONT_FAMILY,
            color: goldColor,
        }).setOrigin(0, 0);
        this._container.add([materialText, goldText]);
        this._detailNodes.push(materialText, goldText);

        this._buildActionButton('Upgrade', selected.affordable, () => {
            this.scene.events.emit('upgrader:upgrade', {
                upgraderId: this._context?.upgraderId ?? null,
                type: this._context?.type ?? null,
                entryId: selected.definitionId ? selected.id : null,
                spellId: selected.spellId ?? null,
            });
        });
    }

    _formatLeftLabel(row) {
        return `${row.displayName}${row.upgradeLevel > 0 ? ` +${row.upgradeLevel}` : ''}`;
    }

    _buildActionButton(label, enabled, onClick) {
        const y = PANEL_H / 2 - FOOTER_H / 2 + 18;
        const bg = this.scene.add.rectangle(0, y, 140, 34, enabled ? C.action : C.actionDisabled, 1)
            .setOrigin(0.5, 0.5)
            .setStrokeStyle(1, enabled ? C.actionBorder : C.rowBorder, 1);
        const text = this.scene.add.text(0, y, label, {
            fontSize: '14px',
            fontFamily: GAME_FONT_FAMILY,
            color: enabled ? C.actionText : C.actionTextDisabled,
        }).setOrigin(0.5, 0.5);
        if (enabled && typeof onClick === 'function') {
            bg.setInteractive({ useHandCursor: true });
            bg.on('pointerdown', onClick);
            bg.on('pointerover', () => bg.setFillStyle(0x355a85, 1));
            bg.on('pointerout', () => bg.setFillStyle(C.action, 1));
        }
        this._container.add([bg, text]);
        this._actionNodes.push(bg, text);
    }

    _clearRows() {
        this._rowNodes.forEach((node) => this._container.remove(node, true));
        this._rowNodes = [];
    }

    _clearDetails() {
        this._detailNodes.forEach((node) => this._container.remove(node, true));
        this._detailNodes = [];
    }

    _clearActions() {
        this._actionNodes.forEach((node) => this._container.remove(node, true));
        this._actionNodes = [];
    }

    _buildRenderKey() {
        return JSON.stringify({
            gold: this._controlledState?.inventory?.gold ?? 0,
            weapons: (this._controlledState?.inventory?.weapons ?? []).map((entry) => ({
                entryId: entry.entryId,
                quantity: entry.quantity,
                upgradeLevel: entry.upgradeLevel ?? 0,
            })),
            spells: (this._controlledState?.spellbook?.knownSpells ?? []).map((entry) => ({
                spellId: entry.spellId,
                upgradeLevel: entry.upgradeLevel ?? 0,
            })),
            resources: (this._controlledState?.inventory?.resources ?? []).map((entry) => ({
                definitionId: entry.definitionId,
                quantity: entry.quantity,
            })),
            context: this._context,
            selection: this._selection,
        });
    }
}
