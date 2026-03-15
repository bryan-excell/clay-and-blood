import Phaser from 'phaser';
import { GAME_FONT_FAMILY } from '../../config.js';
import { getItemDef } from '../../data/ItemRegistry.js';

const PANEL_W = 640;
const PANEL_H = 420;
const HEADER_H = 56;
const FOOTER_H = 84;
const COL_GAP = 18;
const COL_W = 270;
const ROW_H = 28;
const ROW_GAP = 4;
const ROW_MAX = 8;

const C = Object.freeze({
    bg: 0x111a26,
    panelBorder: 0x3b5f86,
    header: '#d7e8ff',
    gold: '#f1d77a',
    subhead: '#8eb5da',
    row: 0x182331,
    rowHover: 0x203249,
    rowSelected: 0x244669,
    rowBorder: 0x2e435a,
    rowSelectedBorder: 0x5f95d0,
    rowText: '#d8eeff',
    muted: '#6c86a0',
    action: 0x29486d,
    actionDisabled: 0x1a2634,
    actionBorder: 0x5a89ba,
    actionText: '#e8f4ff',
    actionTextDisabled: '#6d849c',
    price: '#c7e3a7',
});

export class MerchantShopWidget {
    constructor(scene) {
        this.scene = scene;
        this.visible = false;
        this._controlledState = null;
        this._shopContext = null;
        this._selection = null;
        this._renderKey = null;
        this._rowNodes = [];
        this._actionNodes = [];

        this._container = scene.add.container(0, 0).setDepth(610).setVisible(false);
        this._bg = scene.add.rectangle(0, 0, PANEL_W, PANEL_H, C.bg, 0.96)
            .setOrigin(0.5, 0.5)
            .setStrokeStyle(2, C.panelBorder, 1);
        this._title = scene.add.text(0, -PANEL_H / 2 + 16, 'Shop', {
            fontSize: '22px',
            fontFamily: GAME_FONT_FAMILY,
            color: C.header,
        }).setOrigin(0.5, 0);
        this._gold = scene.add.text(0, -PANEL_H / 2 + 18, '', {
            fontSize: '14px',
            fontFamily: GAME_FONT_FAMILY,
            color: C.gold,
        }).setOrigin(0, 0);
        this._sellHeader = scene.add.text(-COL_GAP / 2 - COL_W / 2, -PANEL_H / 2 + HEADER_H, 'Sell', {
            fontSize: '16px',
            fontFamily: GAME_FONT_FAMILY,
            color: C.subhead,
        }).setOrigin(0.5, 0);
        this._buyHeader = scene.add.text(COL_GAP / 2 + COL_W / 2, -PANEL_H / 2 + HEADER_H, 'Buy', {
            fontSize: '16px',
            fontFamily: GAME_FONT_FAMILY,
            color: C.subhead,
        }).setOrigin(0.5, 0);
        this._info = scene.add.text(0, PANEL_H / 2 - FOOTER_H + 8, '', {
            fontSize: '14px',
            fontFamily: GAME_FONT_FAMILY,
            color: C.price,
            align: 'center',
        }).setOrigin(0.5, 0);

        this._container.add([this._bg, this._title, this._gold, this._sellHeader, this._buyHeader, this._info]);
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

    update(controlledState, shopContext) {
        this._controlledState = controlledState ?? null;
        this._shopContext = shopContext ?? null;
        if (!this.visible) return;
        const nextKey = this._buildRenderKey();
        if (nextKey === this._renderKey) return;
        this._renderKey = nextKey;
        this._render();
    }

    destroy() {
        this._clearRows();
        this._clearActions();
        this._container.destroy(true);
    }

    _render() {
        const gold = this._controlledState?.inventory?.gold ?? 0;
        this._title.setText(this._shopContext?.title ?? 'Shop');
        this._gold.setText(`Gold: ${gold}`);

        const sellRows = [
            ...(this._controlledState?.inventory?.weapons ?? []),
            ...(this._controlledState?.inventory?.armor ?? []),
            ...(this._controlledState?.inventory?.accessories ?? []),
            ...(this._controlledState?.inventory?.consumables ?? []),
            ...(this._controlledState?.inventory?.resources ?? []),
        ].filter((item) => item?.canSell);

        const buyRows = (this._shopContext?.stock ?? [])
            .map((definitionId) => getItemDef(definitionId))
            .filter(Boolean)
            .map((definition) => ({
                definitionId: definition.id,
                displayName: definition.name,
                quantity: null,
                buyPrice: definition.buyPrice ?? 0,
            }));

        if (this._selection?.side === 'sell' && !sellRows.some((row) => row.entryId === this._selection.id)) {
            this._selection = null;
        }
        if (this._selection?.side === 'buy' && !buyRows.some((row) => row.definitionId === this._selection.id)) {
            this._selection = null;
        }

        this._clearRows();
        this._clearActions();
        this._buildColumn('sell', sellRows, -COL_GAP / 2 - COL_W, -PANEL_H / 2 + HEADER_H + 28);
        this._buildColumn('buy', buyRows, COL_GAP / 2, -PANEL_H / 2 + HEADER_H + 28);
        this._buildActions(gold, sellRows, buyRows);
    }

    _buildColumn(side, rows, startX, startY) {
        const visibleRows = rows.slice(0, ROW_MAX);
        const emptyLabel = side === 'sell' ? 'No sellable items' : 'No wares';
        if (visibleRows.length === 0) {
            const text = this.scene.add.text(startX + COL_W / 2, startY + 18, emptyLabel, {
                fontSize: '12px',
                fontFamily: GAME_FONT_FAMILY,
                color: C.muted,
            }).setOrigin(0.5, 0.5);
            this._container.add(text);
            this._rowNodes.push(text);
            return;
        }

        visibleRows.forEach((row, index) => {
            const selected = this._selection?.side === side
                && ((side === 'sell' && this._selection.id === row.entryId) || (side === 'buy' && this._selection.id === row.definitionId));
            const y = startY + index * (ROW_H + ROW_GAP);
            const bg = this.scene.add.rectangle(startX, y, COL_W, ROW_H, selected ? C.rowSelected : C.row, 1)
                .setOrigin(0, 0)
                .setStrokeStyle(1, selected ? C.rowSelectedBorder : C.rowBorder, 1)
                .setInteractive({ useHandCursor: true });
            const label = this.scene.add.text(startX + 8, y + ROW_H / 2, this._formatRowLabel(side, row), {
                fontSize: '12px',
                fontFamily: GAME_FONT_FAMILY,
                color: C.rowText,
            }).setOrigin(0, 0.5);
            bg.on('pointerover', () => {
                if (!selected) bg.setFillStyle(C.rowHover, 1);
            });
            bg.on('pointerout', () => {
                if (!selected) bg.setFillStyle(C.row, 1);
            });
            bg.on('pointerdown', () => {
                this._selection = {
                    side,
                    id: side === 'sell' ? row.entryId : row.definitionId,
                };
                this._renderKey = null;
                this._render();
            });
            this._container.add([bg, label]);
            this._rowNodes.push(bg, label);
        });
    }

    _formatRowLabel(side, row) {
        if (side === 'sell') {
            const upgrade = Number.isFinite(row.upgradeLevel) && row.upgradeLevel > 0 ? ` +${row.upgradeLevel}` : '';
            const quantity = Number.isFinite(row.quantity) ? ` x${row.quantity}` : '';
            return `${row.displayName}${upgrade}${quantity}`;
        }
        return `${row.displayName} (${row.buyPrice}g)`;
    }

    _buildActions(gold, sellRows, buyRows) {
        if (!this._selection) {
            this._info.setText('Select a player item to sell or a vendor item to buy.');
            return;
        }

        if (this._selection.side === 'sell') {
            const row = sellRows.find((entry) => entry.entryId === this._selection.id);
            if (!row) {
                this._info.setText('');
                return;
            }
            const def = getItemDef(row.definitionId);
            const unitPrice = def?.sellPrice ?? 0;
            const allPrice = unitPrice * (row.quantity ?? 1);
            this._info.setText(`Sell ${row.displayName}: ${unitPrice}g each, ${allPrice}g all`);
            this._buildActionButton(-88, 'Sell 1', true, () => {
                this.scene.events.emit('merchant:sell', {
                    merchantId: this._shopContext?.merchantId,
                    entryId: row.entryId,
                    mode: 'one',
                });
            });
            this._buildActionButton(88, 'Sell All', true, () => {
                this.scene.events.emit('merchant:sell', {
                    merchantId: this._shopContext?.merchantId,
                    entryId: row.entryId,
                    mode: 'all',
                });
            });
            return;
        }

        const row = buyRows.find((entry) => entry.definitionId === this._selection.id);
        if (!row) {
            this._info.setText('');
            return;
        }
        const affordable = gold >= (row.buyPrice ?? 0);
        this._info.setText(`Buy ${row.displayName}: ${row.buyPrice}g`);
        this._buildActionButton(0, `Buy`, affordable, () => {
            this.scene.events.emit('merchant:buy', {
                merchantId: this._shopContext?.merchantId,
                definitionId: row.definitionId,
            });
        });
    }

    _buildActionButton(offsetX, label, enabled, onClick) {
        const y = PANEL_H / 2 - FOOTER_H / 2 + 18;
        const bg = this.scene.add.rectangle(offsetX, y, 120, 32, enabled ? C.action : C.actionDisabled, 1)
            .setOrigin(0.5, 0.5)
            .setStrokeStyle(1, enabled ? C.actionBorder : C.rowBorder, 1);
        const text = this.scene.add.text(offsetX, y, label, {
            fontSize: '13px',
            fontFamily: GAME_FONT_FAMILY,
            color: enabled ? C.actionText : C.actionTextDisabled,
        }).setOrigin(0.5, 0.5);
        if (enabled) {
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

    _clearActions() {
        this._actionNodes.forEach((node) => this._container.remove(node, true));
        this._actionNodes = [];
    }

    _buildRenderKey() {
        const gold = this._controlledState?.inventory?.gold ?? 0;
        const stock = Array.isArray(this._shopContext?.stock) ? this._shopContext.stock : [];
        const sellRows = [
            ...(this._controlledState?.inventory?.weapons ?? []),
            ...(this._controlledState?.inventory?.armor ?? []),
            ...(this._controlledState?.inventory?.accessories ?? []),
            ...(this._controlledState?.inventory?.consumables ?? []),
            ...(this._controlledState?.inventory?.resources ?? []),
        ]
            .filter((item) => item?.canSell)
            .map((item) => ({
                entryId: item.entryId,
                quantity: item.quantity,
                canSell: item.canSell,
                upgradeLevel: item.upgradeLevel ?? 0,
            }));
        return JSON.stringify({
            gold,
            stock,
            sellRows,
            selection: this._selection,
            merchantId: this._shopContext?.merchantId ?? null,
            title: this._shopContext?.title ?? 'Shop',
        });
    }
}
