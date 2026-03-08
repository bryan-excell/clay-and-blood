import { AuthoritySystem } from './AuthoritySystem.js';

/**
 * Converts controller-specific input into controller-agnostic IntentComponent data.
 */
export class InputIntentSystem {
    /**
     * Update intent for all entities that carry an IntentComponent.
     * @param {import('../entities/EntityManager.js').EntityManager} entityManager
     */
    static update(entityManager) {
        const entities = entityManager.getEntitiesWithComponent('intent');
        for (const entity of entities) {
            InputIntentSystem.updateEntity(entity);
        }
    }

    /**
     * Update a single entity's intent from its active control source.
     * @param {import('../entities/Entity.js').Entity} entity
     */
    static updateEntity(entity) {
        const intent = entity.getComponent('intent');
        if (!intent) return;
        if (!AuthoritySystem.canSimulateOnClient(entity)) {
            intent.set({
                moveX: 0,
                moveY: 0,
                wantsSprint: false,
                wantsDash: false,
                wantsAttackPrimary: false,
                wantsAttackSecondary: false,
                attackPrimaryDown: false,
                attackPrimaryHeld: false,
                attackPrimaryUp: false,
                attackSecondaryDown: false,
                attackSecondaryHeld: false,
                attackSecondaryUp: false,
            });
            return;
        }

        const control = entity.getComponent('control');
        if (control && control.controlMode !== 'local') {
            intent.set({
                moveX: 0,
                moveY: 0,
                wantsSprint: false,
                wantsDash: false,
                // Preserve edge-trigger actions set by non-keyboard adapters
                wantsAttackPrimary: intent.wantsAttackPrimary,
                wantsAttackSecondary: intent.wantsAttackSecondary,
                attackPrimaryDown: intent.attackPrimaryDown,
                attackPrimaryHeld: intent.attackPrimaryHeld,
                attackPrimaryUp: intent.attackPrimaryUp,
                attackSecondaryDown: intent.attackSecondaryDown,
                attackSecondaryHeld: intent.attackSecondaryHeld,
                attackSecondaryUp: intent.attackSecondaryUp,
            });
            return;
        }

        // Current implementation: keyboard is the local controller adapter.
        const keyboard = entity.getComponent('keyboard');
        if (!keyboard) return;

        const direction = keyboard.getMovementDirection();
        let moveX = direction.x;
        let moveY = direction.y;

        // Normalize diagonal movement to unit-length intent.
        if (moveX !== 0 && moveY !== 0) {
            const len = Math.sqrt(moveX * moveX + moveY * moveY);
            moveX /= len;
            moveY /= len;
        }

        intent.set({
            moveX,
            moveY,
            wantsSprint: !!keyboard.inputState.sprint,
            wantsDash: !!keyboard.inputState.dash,
            // Merge keyboard action edges with other adapters (pointer, AI, replay).
            wantsAttackPrimary: !!keyboard.inputState.attack || !!intent.wantsAttackPrimary,
            wantsAttackSecondary: !!intent.wantsAttackSecondary,
            attackPrimaryDown: !!keyboard.inputState.attack || !!intent.attackPrimaryDown,
            attackPrimaryHeld: !!keyboard.inputState.attackHeld || !!intent.attackPrimaryHeld,
            attackPrimaryUp: !!keyboard.inputState.attackUp || !!intent.attackPrimaryUp,
            attackSecondaryDown: !!intent.attackSecondaryDown,
            attackSecondaryHeld: !!intent.attackSecondaryHeld,
            attackSecondaryUp: !!intent.attackSecondaryUp,
        });
    }
}
