import { GAME_FONT_FAMILY } from '../../config.js';

const DEFAULT_DURATION_MS = 1800;

export class ToastFeedWidget {
    constructor(scene) {
        this.scene = scene;
        this._queue = [];
        this._active = null;
        this._bg = scene.add.rectangle(0, 0, 320, 40, 0x10161f, 0.92)
            .setOrigin(1, 1)
            .setStrokeStyle(1, 0x41546a, 1)
            .setScrollFactor(0)
            .setDepth(760)
            .setVisible(false);
        this._text = scene.add.text(0, 0, '', {
            fontSize: '13px',
            fontFamily: GAME_FONT_FAMILY,
            color: '#d9e7f5',
            align: 'right',
            wordWrap: { width: 290 },
        }).setOrigin(1, 1).setScrollFactor(0).setDepth(761).setVisible(false);
        this.setPosition(scene.scale.width - 24, scene.scale.height - 24);
    }

    setPosition(x, y) {
        this._bg.setPosition(x, y);
        this._text.setPosition(x - 12, y - 10);
    }

    enqueue(message, durationMs = DEFAULT_DURATION_MS) {
        if (!message) return;
        this._queue.push({
            text: message,
            durationMs: Number.isFinite(durationMs) ? Math.max(600, durationMs) : DEFAULT_DURATION_MS,
        });
        if (!this._active) this._showNext();
    }

    destroy() {
        this._active?.timer?.remove?.(false);
        this._bg.destroy();
        this._text.destroy();
    }

    _showNext() {
        const next = this._queue.shift() ?? null;
        if (!next) {
            this._active = null;
            this._bg.setVisible(false);
            this._text.setVisible(false);
            return;
        }

        this._active?.timer?.remove?.(false);
        this._active = {
            ...next,
            timer: this.scene.time.delayedCall(next.durationMs, () => {
                this._active = null;
                this._showNext();
            }),
        };
        this._text.setText(next.text);
        this._bg.setVisible(true);
        this._text.setVisible(true);
    }
}
