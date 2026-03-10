import { Component } from './Component.js';

export class CorpseIdentityComponent extends Component {
    constructor(identity = null) {
        super('corpseIdentity');
        this.identity = identity ? { ...identity } : null;
    }

    setIdentity(identity = null) {
        this.identity = identity ? { ...identity } : null;
    }
}
