import { Component } from './Component.js';

export class DecayBarComponent extends Component {
    constructor({
        width = 36,
        height = 4,
        offsetY = 24,
        fillColor = 0x8844cc,
        backColor = 0x21142f,
    } = {}) {
        super('decayBar');
        this.requireComponent('transform');
        this.requireComponent('decay');
        this.optionalComponent('circle');
        this.width = width;
        this.height = height;
        this.offsetY = offsetY;
        this.fillColor = fillColor;
        this.backColor = backColor;
        this.graphics = null;
    }

    onAttach() {
        if (!super.onAttach()) return false;
        this.graphics = this.entity.scene.add.graphics();
        this.graphics.setDepth(30);
        return true;
    }

    onDetach() {
        this.graphics?.destroy();
        this.graphics = null;
    }

    update() {
        if (!this.graphics) return;
        const transform = this.getRequiredComponent('transform');
        const decay = this.getRequiredComponent('decay');
        const circle = this.getOptionalComponent('circle');
        const ratio = decay.getRatio();

        this.graphics.clear();
        if (circle?.gameObject && !circle.gameObject.visible) return;
        if (ratio <= 0) return;

        const radius = circle?.radius ?? 0;
        const x = transform.position.x - this.width / 2;
        const y = transform.position.y + radius + this.offsetY;

        this.graphics.fillStyle(this.backColor, 0.85);
        this.graphics.fillRect(x - 1, y - 1, this.width + 2, this.height + 2);
        this.graphics.fillStyle(this.fillColor, 1);
        this.graphics.fillRect(x, y, Math.round(this.width * ratio), this.height);
    }
}
