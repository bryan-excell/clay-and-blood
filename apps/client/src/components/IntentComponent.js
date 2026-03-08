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
        attackPrimaryDown = false,
        attackPrimaryHeld = false,
        attackPrimaryUp = false,
        attackSecondaryDown = false,
        attackSecondaryHeld = false,
        attackSecondaryUp = false,
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
        this.attackPrimaryDown = attackPrimaryDown;
        this.attackPrimaryHeld = attackPrimaryHeld;
        this.attackPrimaryUp = attackPrimaryUp;
        this.attackSecondaryDown = attackSecondaryDown;
        this.attackSecondaryHeld = attackSecondaryHeld;
        this.attackSecondaryUp = attackSecondaryUp;
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
        attackPrimaryDown = this.attackPrimaryDown,
        attackPrimaryHeld = this.attackPrimaryHeld,
        attackPrimaryUp = this.attackPrimaryUp,
        attackSecondaryDown = this.attackSecondaryDown,
        attackSecondaryHeld = this.attackSecondaryHeld,
        attackSecondaryUp = this.attackSecondaryUp,
        aimX = this.aimX,
        aimY = this.aimY
    } = {}) {
        this.moveX = moveX;
        this.moveY = moveY;
        this.wantsSprint = wantsSprint;
        this.wantsDash = wantsDash;
        this.wantsAttackPrimary = wantsAttackPrimary;
        this.wantsAttackSecondary = wantsAttackSecondary;
        this.attackPrimaryDown = attackPrimaryDown;
        this.attackPrimaryHeld = attackPrimaryHeld;
        this.attackPrimaryUp = attackPrimaryUp;
        this.attackSecondaryDown = attackSecondaryDown;
        this.attackSecondaryHeld = attackSecondaryHeld;
        this.attackSecondaryUp = attackSecondaryUp;
        this.aimX = aimX;
        this.aimY = aimY;
    }

    clearTransient() {
        this.wantsDash = false;
        this.wantsAttackPrimary = false;
        this.wantsAttackSecondary = false;
        this.attackPrimaryDown = false;
        this.attackPrimaryUp = false;
        this.attackSecondaryDown = false;
        this.attackSecondaryUp = false;
    }
}
