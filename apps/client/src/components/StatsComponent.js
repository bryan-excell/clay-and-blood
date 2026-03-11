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

    setMana(nextMana) {
        this.mana = Math.max(0, Math.min(this.manaMax, Math.round(nextMana)));
    }

    setManaMax(nextManaMax) {
        this.manaMax = Math.max(0, Math.round(nextManaMax));
        this.mana = Math.min(this.mana, this.manaMax);
    }

    setStamina(nextStamina) {
        this.stamina = Math.max(0, Math.min(this.staminaMax, Math.round(nextStamina)));
    }

    setStaminaMax(nextStaminaMax) {
        this.staminaMax = Math.max(0, Math.round(nextStaminaMax));
        this.stamina = Math.min(this.stamina, this.staminaMax);
    }

    applyResourceSummary(resources = null) {
        if (!resources || typeof resources !== 'object') return;
        const hp = resources.hp ?? {};
        const mana = resources.mana ?? {};
        const stamina = resources.stamina ?? {};
        if (Number.isFinite(hp.max)) this.setHpMax(hp.max);
        if (Number.isFinite(hp.current)) this.setHp(hp.current);
        if (Number.isFinite(mana.max)) this.setManaMax(mana.max);
        if (Number.isFinite(mana.current)) this.setMana(mana.current);
        if (Number.isFinite(stamina.max)) this.setStaminaMax(stamina.max);
        if (Number.isFinite(stamina.current)) this.setStamina(stamina.current);
    }
}
