/**
 * InventoryDrawerWidget
 *
 * A slide-in panel that opens from the left side of the screen on TAB.
 *
 * Layout (all sizes in px):
 *   [ RIBBON 44px ][ CONTENT PANEL 200px ]   total = 244px
 *
 * The ribbon holds four vertical tab buttons (Weapons / Spells / Armor / Accessories).
 * The content panel shows the item list for the active tab.
 *
 * A Phaser Container is used so the whole widget can be tweened by changing
 * container.x rather than repositioning every individual GameObject.
 *
 * Input guard:
 *   The caller (UIScene) writes { drawerOpen, drawerWidth } to uiStateStore so
 *   gameplay components can suppress clicks that land inside the drawer.
 */

import Phaser from 'phaser';

const RIBBON_W = 44;
const PANEL_W  = 200;
export const DRAWER_TOTAL_W = RIBBON_W + PANEL_W;  // exported for UIScene to write to store

const TAB_H    = 56;   // height of each ribbon tab button
const TAB_PAD  = 4;    // gap between ribbon edge and button edge
const ROW_H    = 30;   // height of each item row
const ROW_GAP  = 4;    // vertical gap between rows
const ROW_PAD  = 6;    // horizontal inset inside the panel
const HEADER_H = 36;   // space at the top of the panel for the tab title

const TWEEN_DURATION = 180; // ms

const TABS = Object.freeze([
    { id: 'weapons',     label: '⚔',  title: 'Weapons'     },
    { id: 'spells',      label: '✦',  title: 'Spells'      },
    { id: 'armor',       label: '▣',  title: 'Armor'       },
    { id: 'accessories', label: '◈',  title: 'Accessories' },
]);

// Colour palette
const C = Object.freeze({
    ribbonBg:       0x0e1520,
    panelBg:        0x141d2a,
    tabInactive:    0x1a2535,
    tabActive:      0x1e3450,
    tabBorderInact: 0x273545,
    tabBorderAct:   0x4a7aaa,
    tabLabelInact:  '#6a8aaa',
    tabLabelAct:    '#c8e0ff',
    panelTitle:     '#9bbbd8',
    rowInactive:    0x192030,
    rowActive:      0x1e3b5e,
    rowBorderInact: 0x263545,
    rowBorderAct:   0x3d7ab8,
    rowTextInact:   '#8aaecc',
    rowTextAct:     '#d8eeff',
    rowHover:       0x22304a,
    glyphColor:     '#e8b050',  // dual-bind indicator
});

export class InventoryDrawerWidget {
    /**
     * @param {Phaser.Scene} scene
     * @param {object} onEquip  - Callbacks keyed by category: { weapon, spell, armor, accessory }
     * @param {number} height   - Initial scene height
     */
    constructor(scene, onEquip = {}, height = 600) {
        this.scene   = scene;
        this.onEquip = onEquip;

        this._open       = false;
        this._activeTab  = 0;
        this._loadout    = null;
        this._rowsKey    = null;
        this._height     = height;
        this._activeTween = null;

        this._container   = null;
        this._ribbonBg    = null;
        this._panelBg     = null;
        this._panelTitle  = null;
        this._tabButtons  = [];  // [{ bg, label }]
        this._rows        = [];  // [{ bg, nameText, glyphText? }]

        this._build();
    }

    // ------------------------------------------------------------------
    // Public API
    // ------------------------------------------------------------------

    /** Toggle open/closed. */
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
        this._tweenTo(-DRAWER_TOTAL_W);
    }

    get isOpen() { return this._open; }

    /**
     * Feed updated loadout data from the store.
     * @param {object|null} loadout - Resolved loadout snapshot from UiProjectionSystem.
     */
    update(loadout) {
        this._loadout = loadout;
        // Only rebuild DOM-heavy rows when something actually changed.
        const key = loadout
            ? JSON.stringify(loadout.equipped)
                + '|' + loadout.weapons.length
                + '|' + loadout.spells.length
                + '|' + loadout.accessories.length
                + '|' + loadout.armorSets.length
                + '|' + this._activeTab
            : '';
        if (key === this._rowsKey) return;
        this._rowsKey = key;
        this._rebuildRows();
    }

    /** Called by UIScene on resize. */
    setHeight(height) {
        this._height = height;
        this._ribbonBg?.setSize(RIBBON_W, height);
        this._panelBg?.setSize(PANEL_W, height);
    }

    destroy() {
        this._destroyRows();
        this._tabButtons.forEach(({ bg, label }) => { bg.destroy(); label.destroy(); });
        this._ribbonBg?.destroy();
        this._panelBg?.destroy();
        this._panelTitle?.destroy();
        this._container?.destroy();
    }

    // ------------------------------------------------------------------
    // Build
    // ------------------------------------------------------------------

    _build() {
        const scene = this.scene;
        const h     = this._height;

        // Container starts fully off-screen left.
        this._container = scene.add.container(-DRAWER_TOTAL_W, 0);
        this._container.setDepth(500);

        // Ribbon background (leftmost strip)
        this._ribbonBg = scene.add.rectangle(0, 0, RIBBON_W, h, C.ribbonBg, 0.97)
            .setOrigin(0, 0)
            .setStrokeStyle(1, 0x1e2e42, 1);
        this._container.add(this._ribbonBg);

        // Content panel background
        this._panelBg = scene.add.rectangle(RIBBON_W, 0, PANEL_W, h, C.panelBg, 0.95)
            .setOrigin(0, 0)
            .setStrokeStyle(1, 0x1e2e42, 1)
            .setInteractive();  // absorbs clicks on the empty panel area
        this._container.add(this._panelBg);

        // Panel section title
        this._panelTitle = scene.add.text(
            RIBBON_W + PANEL_W / 2,
            10,
            TABS[0].title,
            { fontSize: '13px', fontFamily: 'monospace', color: C.panelTitle }
        ).setOrigin(0.5, 0);
        this._container.add(this._panelTitle);

        // Ribbon tab buttons
        this._tabButtons = TABS.map((tab, i) => {
            const ty = i * TAB_H + TAB_PAD;
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
                { fontSize: '17px', fontFamily: 'monospace', color: C.tabLabelInact }
            ).setOrigin(0.5, 0.5);

            bg.on('pointerdown', () => this._setTab(i));
            bg.on('pointerover',  () => { if (this._activeTab !== i) bg.setFillStyle(0x22334a, 1); });
            bg.on('pointerout',   () => { if (this._activeTab !== i) bg.setFillStyle(C.tabInactive, 1); });

            this._container.add(bg);
            this._container.add(label);
            return { bg, label };
        });

        this._refreshTabHighlights();
    }

    // ------------------------------------------------------------------
    // Tab management
    // ------------------------------------------------------------------

    _setTab(index) {
        if (this._activeTab === index) return;
        this._activeTab = index;
        this._refreshTabHighlights();
        this._rebuildRows();
    }

    _refreshTabHighlights() {
        this._tabButtons.forEach(({ bg, label }, i) => {
            const active = i === this._activeTab;
            bg.setFillStyle(active ? C.tabActive : C.tabInactive, 1);
            bg.setStrokeStyle(active ? 2 : 1, active ? C.tabBorderAct : C.tabBorderInact, 1);
            label.setColor(active ? C.tabLabelAct : C.tabLabelInact);
        });
        this._panelTitle?.setText(TABS[this._activeTab]?.title ?? '');
    }

    // ------------------------------------------------------------------
    // Row management
    // ------------------------------------------------------------------

    _rebuildRows() {
        this._destroyRows();
        if (!this._loadout) return;

        const tab = TABS[this._activeTab];
        if (!tab) return;

        let items      = [];
        let equippedId = null;

        switch (tab.id) {
            case 'weapons':
                items      = this._loadout.weapons     ?? [];
                equippedId = this._loadout.equipped?.weaponId    ?? null;
                break;
            case 'spells':
                items      = this._loadout.spells      ?? [];
                equippedId = this._loadout.equipped?.spellId     ?? null;
                break;
            case 'armor':
                items      = this._loadout.armorSets   ?? [];
                equippedId = this._loadout.equipped?.armorSetId  ?? null;
                break;
            case 'accessories':
                items      = this._loadout.accessories ?? [];
                equippedId = this._loadout.equipped?.accessoryId ?? null;
                break;
        }

        if (items.length === 0) {
            // Show an empty-state placeholder row.
            this._buildEmptyRow();
            return;
        }

        items.forEach((item, idx) => {
            const rowY     = HEADER_H + idx * (ROW_H + ROW_GAP);
            const rowX     = RIBBON_W + ROW_PAD;
            const rowW     = PANEL_W - ROW_PAD * 2;
            const equipped = item.id === equippedId;
            const dualBind = item.mouseUsage === 'both';

            const bg = this.scene.add.rectangle(rowX, rowY, rowW, ROW_H, equipped ? C.rowActive : C.rowInactive, 1)
                .setOrigin(0, 0)
                .setStrokeStyle(1, equipped ? C.rowBorderAct : C.rowBorderInact, 1)
                .setInteractive({ useHandCursor: true });

            const nameText = this.scene.add.text(
                rowX + 8,
                rowY + ROW_H / 2,
                item.name ?? item.id,
                { fontSize: '12px', fontFamily: 'monospace', color: equipped ? C.rowTextAct : C.rowTextInact }
            ).setOrigin(0, 0.5);

            // Dual-bind glyph — warns the player this item occupies both mouse buttons.
            let glyphText = null;
            if (dualBind) {
                glyphText = this.scene.add.text(
                    rowX + rowW - 8,
                    rowY + ROW_H / 2,
                    '⊕',
                    { fontSize: '13px', fontFamily: 'monospace', color: C.glyphColor }
                ).setOrigin(1, 0.5);
                this._container.add(glyphText);
            }

            bg.on('pointerover', () => {
                if (!equipped) bg.setFillStyle(C.rowHover, 1);
            });
            bg.on('pointerout', () => {
                if (!equipped) bg.setFillStyle(C.rowInactive, 1);
            });
            bg.on('pointerdown', () => this._onItemClick(tab.id, item.id));

            this._container.add(bg);
            this._container.add(nameText);
            this._rows.push({ bg, nameText, glyphText });
        });
    }

    _buildEmptyRow() {
        const rowY = HEADER_H;
        const rowX = RIBBON_W + ROW_PAD;
        const rowW = PANEL_W - ROW_PAD * 2;

        const bg = this.scene.add.rectangle(rowX, rowY, rowW, ROW_H, 0x131c28, 0.6)
            .setOrigin(0, 0)
            .setStrokeStyle(1, 0x1e2e42, 1);
        const nameText = this.scene.add.text(
            rowX + rowW / 2,
            rowY + ROW_H / 2,
            '— none —',
            { fontSize: '11px', fontFamily: 'monospace', color: '#3a5068' }
        ).setOrigin(0.5, 0.5);

        this._container.add(bg);
        this._container.add(nameText);
        this._rows.push({ bg, nameText, glyphText: null });
    }

    _destroyRows() {
        this._rows.forEach(({ bg, nameText, glyphText }) => {
            this._container.remove(bg,       true);
            this._container.remove(nameText, true);
            if (glyphText) this._container.remove(glyphText, true);
        });
        this._rows = [];
    }

    _onItemClick(tabId, itemId) {
        switch (tabId) {
            case 'weapons':     this.onEquip.weapon?.(itemId);    break;
            case 'spells':      this.onEquip.spell?.(itemId);     break;
            case 'armor':       this.onEquip.armor?.(itemId);     break;
            case 'accessories': this.onEquip.accessory?.(itemId); break;
        }
    }

    // ------------------------------------------------------------------
    // Tween
    // ------------------------------------------------------------------

    _tweenTo(targetX) {
        if (this._activeTween) {
            this._activeTween.stop();
            this._activeTween = null;
        }

        const startX   = this._container.x;
        const tweenObj = { t: 0 };

        this._activeTween = this.scene.tweens.add({
            targets:  tweenObj,
            t:        1,
            duration: TWEEN_DURATION,
            ease:     'Quad.easeOut',
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
