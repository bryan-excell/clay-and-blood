import { GAME_FONT_FAMILY } from '../../config.js';

export class HpBarWidget {
    constructor(scene, x = 16, y = 16, options = {}) {
        this.scene = scene;
        this.x = x;
        this.y = y;
        this.width = Number.isFinite(options.width) ? options.width : 200;
        this.height = Number.isFinite(options.height) ? options.height : 20;
        this.label = options.label ?? null;
        this.baseColor = Number.isFinite(options.baseColor) ? options.baseColor : 0x44aa66;
        this.midColor = Number.isFinite(options.midColor) ? options.midColor : 0xd6a83a;
        this.lowColor = Number.isFinite(options.lowColor) ? options.lowColor : 0xcc4444;
        this.frameColor = Number.isFinite(options.frameColor) ? options.frameColor : 0x324154;
        this._labelText = null;

        // All elements are right-anchored. x is the right edge of the bar.
        this._frame = scene.add.rectangle(this.x, this.y, this.width, this.height, 0x000000, 0.75)
            .setOrigin(1, 0)
            .setStrokeStyle(2, this.frameColor, 1);

        this._fill = scene.add.rectangle(this.x - this.width + 2, this.y + 2, this.width - 4, this.height - 4, this.baseColor, 1)
            .setOrigin(0, 0);

        if (this.label) {
            this._labelText = scene.add.text(this.x - this.width + 8, this.y + this.height / 2, this.label, {
                fontSize: '12px',
                fontFamily: GAME_FONT_FAMILY,
                color: '#dbe7f3',
                stroke: '#000000',
                strokeThickness: 3,
            }).setOrigin(0, 0.5);
        }

        this._valueText = scene.add.text(this.x - 8, this.y + this.height / 2, '0 / 0', {
            fontSize: '12px',
            fontFamily: GAME_FONT_FAMILY,
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
        this._labelText?.setPosition(x - this.width + 8, y + this.height / 2);
        this._valueText.setPosition(x - 8, y + this.height / 2);
    }

    update(current, max) {
        const safeMax     = Math.max(1, Math.round(max || 0));
        const safeCurrent = Math.max(0, Math.min(safeMax, Math.round(current || 0)));
        const pct         = safeCurrent / safeMax;
        const fillWidth   = Math.max(0, Math.round((this.width - 4) * pct));
        this._fill.setSize(fillWidth, this.height - 4);

        let color = this.baseColor;
        if (pct < 0.25)      color = this.lowColor;
        else if (pct < 0.6)  color = this.midColor;
        this._fill.setFillStyle(color, 1);
        this._valueText.setText(`${safeCurrent} / ${safeMax}`);
    }

    setVisible(visible) {
        this._frame.setVisible(visible);
        this._fill.setVisible(visible);
        this._labelText?.setVisible(visible);
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
        this._labelText?.destroy();
        this._valueText.destroy();
    }
}
