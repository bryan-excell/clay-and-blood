export class WeaponSlotsWidget {
    constructor(scene, x = 16, y = 16) {
        this.scene = scene;
        this.x = x;
        this.y = y;
        this.slotW = 84;
        this.slotH = 28;
        this.padding = 8;
        this.slots = [];

        this._labelsFallback = ['1 Bow', '2 Melee', '3 Spear', '4 Possess'];
        this._buildSlots();
    }

    _buildSlots() {
        this._destroySlots();
        this.slots = this._labelsFallback.map((label, idx) => {
            const x = this.x + idx * (this.slotW + this.padding);
            const bg = this.scene.add.rectangle(x, this.y, this.slotW, this.slotH, 0x1e252d, 0.88)
                .setOrigin(0, 0)
                .setStrokeStyle(1, 0x3b4a5c, 0.9);
            const text = this.scene.add.text(x + this.slotW / 2, this.y + this.slotH / 2, label, {
                fontSize: '12px',
                fontFamily: 'monospace',
                color: '#d8e1ec',
                stroke: '#000000',
                strokeThickness: 2,
            }).setOrigin(0.5, 0.5);
            return { bg, text };
        });
    }

    _destroySlots() {
        this.slots.forEach(({ bg, text }) => {
            bg.destroy();
            text.destroy();
        });
        this.slots = [];
    }

    setPosition(x, y) {
        this.x = x;
        this.y = y;
        this.slots.forEach(({ bg, text }, idx) => {
            const slotX = this.x + idx * (this.slotW + this.padding);
            bg.setPosition(slotX, this.y);
            text.setPosition(slotX + this.slotW / 2, this.y + this.slotH / 2);
        });
    }

    update(weapons = [], currentWeapon = 1) {
        const source = weapons.length > 0 ? weapons : this._labelsFallback.map((name, idx) => ({
            slot: idx + 1,
            name,
            active: idx + 1 === currentWeapon,
        }));

        source.forEach((weapon, idx) => {
            const slot = this.slots[idx];
            if (!slot) return;

            const isActive = weapon.active ?? weapon.slot === currentWeapon;
            slot.bg.setFillStyle(isActive ? 0x6e4b1f : 0x1e252d, isActive ? 1 : 0.88);
            slot.bg.setStrokeStyle(isActive ? 2 : 1, isActive ? 0xffb347 : 0x3b4a5c, isActive ? 1 : 0.9);

            const label = weapon.name ?? this._labelsFallback[idx] ?? `Slot ${idx + 1}`;
            slot.text.setText(label);
        });
    }

    setVisible(visible) {
        this.slots.forEach(({ bg, text }) => {
            bg.setVisible(visible);
            text.setVisible(visible);
        });
    }

    destroy() {
        this._destroySlots();
    }
}
