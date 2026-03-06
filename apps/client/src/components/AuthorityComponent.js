import { Component } from './Component.js';

const VALID_AUTHORITIES = new Set(['client', 'server', 'shared', 'none']);

/**
 * Defines which simulation side is authoritative for this entity.
 */
export class AuthorityComponent extends Component {
    constructor({
        authority = 'client',
        ownerId = null
    } = {}) {
        super('authority');
        this.authority = VALID_AUTHORITIES.has(authority) ? authority : 'none';
        this.ownerId = ownerId;
    }

    setAuthority(nextAuthority) {
        if (!VALID_AUTHORITIES.has(nextAuthority) || nextAuthority === this.authority) return false;
        this.authority = nextAuthority;
        return true;
    }

    setOwner(nextOwnerId) {
        if (nextOwnerId === this.ownerId) return false;
        this.ownerId = nextOwnerId;
        return true;
    }
}
