import { Component } from './Component.js';

/**
 * Controller-agnostic resolved intent consumed by gameplay systems.
 */
export class IntentComponent extends Component {
    constructor({
        moveX = 0,
        moveY = 0,
        wantsSprint = false,
        wantsDash = false,
        wantsAttackPrimary = false,
        wantsAttackSecondary = false,
        aimX = 0,
        aimY = 0
    } = {}) {
        super('intent');
        this.moveX = moveX;
        this.moveY = moveY;
        this.wantsSprint = wantsSprint;
        this.wantsDash = wantsDash;
        this.wantsAttackPrimary = wantsAttackPrimary;
        this.wantsAttackSecondary = wantsAttackSecondary;
        this.aimX = aimX;
        this.aimY = aimY;
    }

    set({
        moveX = this.moveX,
        moveY = this.moveY,
        wantsSprint = this.wantsSprint,
        wantsDash = this.wantsDash,
        wantsAttackPrimary = this.wantsAttackPrimary,
        wantsAttackSecondary = this.wantsAttackSecondary,
        aimX = this.aimX,
        aimY = this.aimY
    } = {}) {
        this.moveX = moveX;
        this.moveY = moveY;
        this.wantsSprint = wantsSprint;
        this.wantsDash = wantsDash;
        this.wantsAttackPrimary = wantsAttackPrimary;
        this.wantsAttackSecondary = wantsAttackSecondary;
        this.aimX = aimX;
        this.aimY = aimY;
    }

    clearTransient() {
        this.wantsDash = false;
        this.wantsAttackPrimary = false;
        this.wantsAttackSecondary = false;
    }
}
