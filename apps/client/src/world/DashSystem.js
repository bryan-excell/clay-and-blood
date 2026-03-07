import { AuthoritySystem } from './AuthoritySystem.js';

/**
 * Handles dash cooldown/timing and dash velocity overrides.
 */
export class DashSystem {
    /**
     * @param {import('../entities/EntityManager.js').EntityManager} entityManager
     * @param {number} deltaTime
     */
    static update(entityManager, deltaTime) {
        const entities = entityManager.getEntitiesWithComponent('playerStateMachine');
        for (const entity of entities) {
            if (!AuthoritySystem.canSimulateOnClient(entity)) continue;
            const intent = entity.getComponent('intent');
            const stateMachine = entity.getComponent('playerStateMachine');
            if (!intent || !stateMachine) continue;

            // If the entity has a loadout, it must have a 'dash' accessory to dash.
            // Entities without a loadout component are not gated (legacy/non-loadout entities).
            const loadout = entity.getComponent('loadout');
            if (loadout && !loadout.hasSpacebarAction('dash')) {
                intent.wantsDash = false;
            }

            stateMachine.updateDashState(intent, deltaTime);
        }
    }
}
