import { eventBus } from "./EventBus.js";
import { gameState } from "./GameState.js";

/**
 * Manages game actions in a way that can be networked
 * This pattern separates intent from execution, crucial for multiplayer
 */
export class ActionManager {
    constructor() {
        this.pendingActions = [];
        this.actionHandlers = {};

        // In multiplayer, actions would be:
        // 1. Generated locally
        // 2. Sent to server
        // 3. Validated by server
        // 4. Broadcast to all clients
        // 5. Applied consistently
    }

    /**
     * Register an action handler
     * @param {string} type - Action type
     * @param {function} handler - Action handler function
     */
    registerHandler(type, handler) {
        this.actionHandlers[type] = handler;
    }

    /**
     * Queue an action to be processed
     * @param {object} action - The action to queue
     */
    queueAction(action) {
        // Add a timestamp and sequence ID
        const actionWithMeta = {
            ...action,
            timestamp: Date.now(),
            sequence: this.pendingActions.length
        };

        this.pendingActions.push(actionWithMeta);

        // In single-player, we can process immediately
        // In multiplayer, we'd wait for server confirmation
        if (action.immediate) {
            this.processAction(actionWithMeta);
        }

        // Log action for debugging (helpful for multiplayer debugging)
        // console.log('Action queued:', actionWithMeta);
    }

    /**
     * Process all pending actions
     * Called during game update cycle
     */
    processActions() {
        // Process all pending actions
        const actions = [...this.pendingActions];
        this.pendingActions = [];

        actions.forEach(action => this.processAction(action));
    }

    /**
     * Process a single action
     * @param {object} action - The action to process
     */
    processAction(action) {
        const { type } = action;

        if (this.actionHandlers[type]) {
            try {
                this.actionHandlers[type](action);
                eventBus.emit('action:processed', { action });
            } catch (error) {
                console.error(`Error processing action ${type}:`, error);
                eventBus.emit('action:error', { action, error });
            }
        } else {
            console.warn(`No handler registered for action type: ${type}`);
        }
    }
}

// Create a global instance
export const actionManager = new ActionManager();

// Register some common action handlers

actionManager.registerHandler('stage:transition', action => {
    const { stageId, entityId, position } = action;

    // Update game state
    eventBus.emit('stage:transition', { stageId });

    // In multiplayer, this would be a critical sync point
});

actionManager.registerHandler('entity:move', action => {
    const { entityId, direction, speed } = action;
    const entity = gameState.entities[entityId];

    if (entity) {
        const physics = entity.getComponent('physics');
        if (physics) {
            physics.setVelocity(
                direction.x * speed,
                direction.y * speed
            );
        }
    }
});

actionManager.registerHandler('entity:attack', action => {
    const { entityId } = action;
    const entity = gameState.entities[entityId];

    if (entity) {
        // Will implement attack behavior later
        console.log(`Entity ${entityId} is attacking!`);
    }
});
