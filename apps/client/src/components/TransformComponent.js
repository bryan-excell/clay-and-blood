import { Component } from "./Component.js";

export class TransformComponent extends Component {
    constructor(x = 0, y = 0) {
        super('transform');
        this.position = { x, y };
        this.previousPosition = { x, y };
        this.rotation = 0;
        this.scale = { x: 1, y: 1 };
        this.needsUpdate = false;
    }

    /**
     * Set position
     * @param {number} x - X coordinate
     * @param {number} y - Y coordinate
     */
    setPosition(x, y) {
        this.previousPosition.x = this.position.x;
        this.previousPosition.y = this.position.y;
        this.position.x = x;
        this.position.y = y;
        this.needsUpdate = true;
    }

    /**
     * Set rotation
     * @param {number} rotation - Rotation in radians
     */
    setRotation(rotation) {
        this.rotation = rotation;
        this.needsUpdate = true;
    }

    /**
     * Set scale
     * @param {number} x - X scale
     * @param {number} y - Y scale
     */
    setScale(x, y) {
        this.scale.x = x;
        this.scale.y = y || x; // If y is not provided, use x
        this.needsUpdate = true;
    }

    /**
     * Get interpolated position for smooth rendering
     * @param {number} alpha - Interpolation factor (0-1)
     * @returns {object} - Interpolated position {x, y}
     */
    getInterpolatedPosition(alpha) {
        return {
            x: this.previousPosition.x + (this.position.x - this.previousPosition.x) * alpha,
            y: this.previousPosition.y + (this.position.y - this.previousPosition.y) * alpha
        };
    }

    /**
     * Network state serialization
     */
    getNetworkState() {
        return {
            position: { ...this.position },
            rotation: this.rotation,
            scale: { ...this.scale }
        };
    }

    /**
     * Apply network state
     */
    applyNetworkState(state) {
        if (state.position) {
            this.setPosition(state.position.x, state.position.y);
        }

        if (state.rotation !== undefined) {
            this.setRotation(state.rotation);
        }

        if (state.scale) {
            this.setScale(state.scale.x, state.scale.y);
        }
    }
}