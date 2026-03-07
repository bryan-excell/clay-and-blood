export class HpBarWidget {
    constructor(scene, x = 16, y = 16) {
        this.scene = scene;
        this.x = x;
        this.y = y;
        this.width = 200;
        this.height = 20;

        // All elements are right-anchored. x is the right edge of the bar.
        this._frame = scene.add.rectangle(this.x, this.y, this.width, this.height, 0x000000, 0.75)
            .setOrigin(1, 0)
            .setStrokeStyle(2, 0x324154, 1);

        this._fill = scene.add.rectangle(this.x - this.width + 2, this.y + 2, this.width - 4, this.height - 4, 0x44aa66, 1)
            .setOrigin(0, 0);

        this._valueText = scene.add.text(this.x - 8, this.y + this.height / 2, '0 / 0', {
            fontSize: '12px',
            fontFamily: 'monospace',
            color: '#ffffff',
            stroke: '#000000',
            strokeThickness: 3,
        }).setOrigin(1, 0.5);
    }

    setPosition(x, y) {
        this.x = x;
        this.y = y;
        this._frame.setPosition(x, y);
        this._fill.setPosition(x - this.width + 2, y + 2);
        this._valueText.setPosition(x - 8, y + this.height / 2);
    }

    update(current, max) {
        const safeMax     = Math.max(1, Math.round(max || 0));
        const safeCurrent = Math.max(0, Math.min(safeMax, Math.round(current || 0)));
        const pct         = safeCurrent / safeMax;
        const fillWidth   = Math.max(0, Math.round((this.width - 4) * pct));
        this._fill.setSize(fillWidth, this.height - 4);

        let color = 0x44aa66;
        if (pct < 0.25)      color = 0xcc4444;
        else if (pct < 0.6)  color = 0xd6a83a;
        this._fill.setFillStyle(color, 1);
        this._valueText.setText(`${safeCurrent} / ${safeMax}`);
    }

    setVisible(visible) {
        this._frame.setVisible(visible);
        this._fill.setVisible(visible);
        this._valueText.setVisible(visible);
    }

    flash() {
        this.scene.tweens.add({
            targets: this._frame,
            alpha: 0.35,
            duration: 60,
            yoyo: true,
            repeat: 1,
        });
    }

    destroy() {
        this._frame.destroy();
        this._fill.destroy();
        this._valueText.destroy();
    }
}
