import { Component } from './Component.js';

/**
 * Marks whether an entity can use stage exits while locally controlled.
 */
export class ExitTraversalComponent extends Component {
    constructor({ canUseExits = true } = {}) {
        super('exitTraversal');
        this.canUseExits = !!canUseExits;
    }
}
