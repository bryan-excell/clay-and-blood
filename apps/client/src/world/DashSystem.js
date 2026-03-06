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
            const intent = entity.getComponent('intent');
            const stateMachine = entity.getComponent('playerStateMachine');
            if (!intent || !stateMachine) continue;

            stateMachine.updateDashState(intent, deltaTime);
        }
    }
}
