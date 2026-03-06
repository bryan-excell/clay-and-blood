import { AuthoritySystem } from './AuthoritySystem.js';

/**
 * Consumes attack intent and dispatches weapon actions.
 */
export class CombatSystem {
    /**
     * @param {import('../entities/EntityManager.js').EntityManager} entityManager
     */
    static update(entityManager) {
        const entities = entityManager.getEntitiesWithComponent('playerCombat');
        for (const entity of entities) {
            const intent = entity.getComponent('intent');
            const combat = entity.getComponent('playerCombat');
            if (!intent || !combat) continue;
            if (!AuthoritySystem.canSimulateOnClient(entity)) {
                intent.clearTransient();
                continue;
            }

            if (!combat.isLocallyControlled()) {
                intent.clearTransient();
                continue;
            }

            const target = combat.resolveAimTarget(intent);

            if (intent.wantsAttackPrimary) {
                combat.handlePrimaryAttack(target.x, target.y);
            }
            if (intent.wantsAttackSecondary) {
                combat.handleSecondaryAttack();
            }

            intent.clearTransient();
        }
    }
}
