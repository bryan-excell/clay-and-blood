import { Component } from './Component.js';

export class StatsComponent extends Component {
    constructor({
        hp = 100,
        hpMax = 100,
        mana = 0,
        manaMax = 0,
        stamina = 0,
        staminaMax = 0,
    } = {}) {
        super('stats');
        this.hp = hp;
        this.hpMax = hpMax;
        this.mana = mana;
        this.manaMax = manaMax;
        this.stamina = stamina;
        this.staminaMax = staminaMax;
    }

    setHp(nextHp) {
        this.hp = Math.max(0, Math.min(this.hpMax, Math.round(nextHp)));
    }

    setHpMax(nextHpMax) {
        this.hpMax = Math.max(1, Math.round(nextHpMax));
        this.hp = Math.min(this.hp, this.hpMax);
    }
}
