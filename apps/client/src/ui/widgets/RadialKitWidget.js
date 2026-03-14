import Phaser from 'phaser';
import { GAME_FONT_FAMILY } from '../../config.js';

const SLOT_W = 152;
const SLOT_H = 42;
const SLOT_GAP_Y = 14;
const SLOT_OFFSET_X = 142;
const CONSUMABLE_OFFSET_Y = 122;
const CONSUMABLE_GAP_X = 168;
const DEAD_ZONE_X = 60;
const SLOT_BAND_Y = 52;

const COLORS = Object.freeze({
    panelFill: 0x101926,
    panelBorder: 0x2f425c,
    text: '#d8e7f7',
    activeFill: 0x203f5e,
    activeBorder: 0xcda85a,
    selectedBorder: 0x66b7d8,
    hoveredFill: 0x305278,
    hoveredBorder: 0x8fd2ff,
    inactiveText: '#8aa0b8',
});

function selectionEquals(a, b) {
    if (!a && !b) return true;
    if (!a || !b) return false;
    return a.type === b.type && a.slotIndex === b.slotIndex;
}

export class RadialKitWidget {
    constructor(scene, x, y, mode = 'config', callbacks = {}) {
        this.scene = scene;
        this.mode = mode;
        this.callbacks = callbacks;
        this._x = x;
        this._y = y;
        this._loadout = null;
        this._selectedSlot = null;
        this._hoverSelection = null;

        this._container = scene.add.container(x, y);
        this._container.setDepth(mode === 'quick' ? 720 : 540);
        this._container.setVisible(false);

        this._slots = [];
        this._build();
    }

    setPosition(x, y) {
        this._x = x;
        this._y = y;
        this._container.setPosition(x, y);
    }

    refresh(loadout, { selectedSlot = null, hoverSelection = null } = {}) {
        this._loadout = loadout ?? null;
        this._selectedSlot = selectedSlot;
        this._hoverSelection = hoverSelection;
        this._render();
    }

    show() {
        this._container.setVisible(true);
    }

    hide() {
        this._container.setVisible(false);
        this.setHoverSelection(null);
    }

    get visible() {
        return this._container.visible;
    }

    setHoverSelection(selection) {
        if (selectionEquals(this._hoverSelection, selection)) return;
        this._hoverSelection = selection;
        this._render();
    }

    updateQuickHover(pointer = this.scene.input?.activePointer) {
        if (this.mode !== 'quick') return null;
        if (!this.visible || !pointer) {
            this.setHoverSelection(null);
            return null;
        }

        const dx = pointer.x - this._x;
        const dy = pointer.y - this._y;
        let selection = null;

        if (dy >= CONSUMABLE_OFFSET_Y - SLOT_H) {
            if (dx <= -CONSUMABLE_GAP_X / 2) {
                selection = { type: 'consumable', slotIndex: 0 };
            } else if (dx >= CONSUMABLE_GAP_X / 2) {
                selection = { type: 'consumable', slotIndex: 2 };
            } else {
                selection = { type: 'consumable', slotIndex: 1 };
            }
        } else if (dx <= -DEAD_ZONE_X) {
            selection = { type: 'weapon', slotIndex: this._slotIndexForDy(dy) };
        } else if (dx >= DEAD_ZONE_X) {
            selection = { type: 'spell', slotIndex: this._slotIndexForDy(dy) };
        }

        this.setHoverSelection(selection);
        return selection;
    }

    getHoveredSelection() {
        return this._hoverSelection;
    }

    destroy() {
        for (const slot of this._slots) {
            slot.bg.destroy();
            slot.label.destroy();
        }
        this._container.destroy();
    }

    _build() {
        const slotDefs = [
            { type: 'weapon', slotIndex: 0, x: -SLOT_OFFSET_X, y: -(SLOT_H + SLOT_GAP_Y) },
            { type: 'weapon', slotIndex: 1, x: -SLOT_OFFSET_X, y: 0 },
            { type: 'weapon', slotIndex: 2, x: -SLOT_OFFSET_X, y: SLOT_H + SLOT_GAP_Y },
            { type: 'spell', slotIndex: 0, x: SLOT_OFFSET_X, y: -(SLOT_H + SLOT_GAP_Y) },
            { type: 'spell', slotIndex: 1, x: SLOT_OFFSET_X, y: 0 },
            { type: 'spell', slotIndex: 2, x: SLOT_OFFSET_X, y: SLOT_H + SLOT_GAP_Y },
            { type: 'consumable', slotIndex: 0, x: -CONSUMABLE_GAP_X, y: CONSUMABLE_OFFSET_Y },
            { type: 'consumable', slotIndex: 1, x: 0, y: CONSUMABLE_OFFSET_Y },
            { type: 'consumable', slotIndex: 2, x: CONSUMABLE_GAP_X, y: CONSUMABLE_OFFSET_Y },
        ];

        this._slots = slotDefs.map((slotDef) => {
            const bg = this.scene.add.rectangle(slotDef.x, slotDef.y, SLOT_W, SLOT_H, COLORS.panelFill, 0.94)
                .setOrigin(0.5, 0.5)
                .setStrokeStyle(2, COLORS.panelBorder, 1);
            const label = this.scene.add.text(slotDef.x, slotDef.y, '', {
                fontSize: '13px',
                fontFamily: GAME_FONT_FAMILY,
                color: COLORS.text,
                align: 'center',
            }).setOrigin(0.5, 0.5);

            if (this.mode === 'config') {
                bg.setInteractive({ useHandCursor: true });
                bg.on('pointerdown', () => {
                    if (slotDef.type === 'weapon') {
                        this.callbacks.onSelectWeaponSlot?.(slotDef.slotIndex);
                    } else if (slotDef.type === 'spell') {
                        this.callbacks.onSelectSpellSlot?.(slotDef.slotIndex);
                    } else {
                        this.callbacks.onSelectConsumableSlot?.(slotDef.slotIndex);
                    }
                });
            }

            this._container.add(bg);
            this._container.add(label);
            return { ...slotDef, bg, label };
        });
    }

    _render() {
        for (const slot of this._slots) {
            const item = slot.type === 'weapon'
                ? this._loadout?.weaponSlots?.[slot.slotIndex] ?? null
                : slot.type === 'spell'
                    ? this._loadout?.spellSlots?.[slot.slotIndex] ?? null
                    : this._loadout?.consumableSlots?.[slot.slotIndex] ?? null;
            const isActive = slot.type === 'weapon'
                ? this._loadout?.activeWeaponSlotIndex === slot.slotIndex
                : slot.type === 'spell'
                    ? this._loadout?.activeSpellSlotIndex === slot.slotIndex
                    : this._loadout?.activeConsumableSlotIndex === slot.slotIndex;
            const isSelected = this._selectedSlot?.type === slot.type && this._selectedSlot?.slotIndex === slot.slotIndex;
            const isHovered = this._hoverSelection?.type === slot.type && this._hoverSelection?.slotIndex === slot.slotIndex;

            let fill = COLORS.panelFill;
            let border = COLORS.panelBorder;
            let text = COLORS.text;

            if (isActive) {
                fill = COLORS.activeFill;
                border = COLORS.activeBorder;
            }
            if (isSelected) {
                border = COLORS.selectedBorder;
            }
            if (isHovered) {
                fill = COLORS.hoveredFill;
                border = COLORS.hoveredBorder;
            }
            if (!item) {
                text = COLORS.inactiveText;
            }

            slot.bg.setFillStyle(fill, 0.97);
            slot.bg.setStrokeStyle(isActive || isSelected || isHovered ? 3 : 2, border, 1);
            const label = slot.type === 'consumable'
                ? `${item?.name ?? 'Nothing'}${item?.id && item?.id !== 'nothing' ? ` x${item?.quantity ?? 0}` : ''}`
                : item?.name ?? (slot.type === 'weapon' ? 'Unarmed' : 'Nothing');
            slot.label.setText(label);
            slot.label.setColor(slot.type === 'consumable' && item?.isDepleted ? COLORS.inactiveText : text);
        }
    }

    _slotIndexForDy(dy) {
        if (dy <= -SLOT_BAND_Y) return 0;
        if (dy >= SLOT_BAND_Y) return 2;
        return 1;
    }
}
