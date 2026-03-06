import { Component } from './Component.js'

/**
 * Base class for all input components
 */
export class InputComponent extends Component {
    constructor() {
        super('input');
        this.enabled = true;
    }

    enable() {
        this.enabled = true;
    }

    disable() {
        this.enabled = false;
    }
}