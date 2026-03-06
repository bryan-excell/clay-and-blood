/**
 * Central authority policy used by client-side simulation systems.
 */
export class AuthoritySystem {
    /**
     * Returns true when this client is allowed to simulate the entity.
     * Entities without an AuthorityComponent default to client-simulated.
     * @param {import('../entities/Entity.js').Entity} entity
     */
    static canSimulateOnClient(entity) {
        const authority = entity.getComponent('authority');
        if (!authority) return true;
        return authority.authority === 'client' || authority.authority === 'shared';
    }
}
