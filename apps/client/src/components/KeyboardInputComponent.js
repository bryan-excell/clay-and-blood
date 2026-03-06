import { InputComponent } from './InputComponent.js';
import { actionManager } from '../core/ActionManager.js';
import { PLAYER_SPEED, PLAYER_SPRINT_MULTIPLIER } from '../config.js';

export class KeyboardInputComponent extends InputComponent {
    constructor() {
        super();
        this.type = 'keyboard';
        this.keys = null;
        this.inputState = {
            up: false,
            down: false,
            left: false,
            right: false,
            sprint: false,
            dash: false,  // New dash input
            attack: false // Generic attack input
        };

        // Optional dependency on physics component - StateMachine will handle movement if present
        this.optionalComponent('physics');
    }

    onAttach() {
        if (!super.onAttach()) return false;

        // Set up keyboard inputs
        this.keys = this.entity.scene.input.keyboard.addKeys({
            up: Phaser.Input.Keyboard.KeyCodes.W,
            down: Phaser.Input.Keyboard.KeyCodes.S,
            left: Phaser.Input.Keyboard.KeyCodes.A,
            right: Phaser.Input.Keyboard.KeyCodes.D,
            sprint: Phaser.Input.Keyboard.KeyCodes.SHIFT,
            dash: Phaser.Input.Keyboard.KeyCodes.SPACE, // Dash with spacebar
            attack: Phaser.Input.Keyboard.KeyCodes.E    // Extra attack key (if needed)
        });

        return true;
    }

    update(deltaTime) {
        if (!this.enabled) return;

        const previousState = { ...this.inputState };

        // Update input state
        this.inputState.up = this.keys.up.isDown;
        this.inputState.down = this.keys.down.isDown;
        this.inputState.left = this.keys.left.isDown;
        this.inputState.right = this.keys.right.isDown;
        this.inputState.sprint = this.keys.sprint.isDown;
        this.inputState.dash = Phaser.Input.Keyboard.JustDown(this.keys.dash); // Only trigger on key press, not hold
        this.inputState.attack = Phaser.Input.Keyboard.JustDown(this.keys.attack);

        // Check if input has changed
        const inputChanged = (
            previousState.up !== this.inputState.up ||
            previousState.down !== this.inputState.down ||
            previousState.left !== this.inputState.left ||
            previousState.right !== this.inputState.right ||
            previousState.sprint !== this.inputState.sprint ||
            previousState.dash !== this.inputState.dash ||
            previousState.attack !== this.inputState.attack
        );

        // Process movement if input changed or if we're processing continuous movement
        if (inputChanged || (
            this.inputState.up || this.inputState.down || 
            this.inputState.left || this.inputState.right
        )) {
            this.processMovementInput();
        }

        // Handle attack input
        if (this.inputState.attack) {
            this.processAttackInput();
        }
    }

    /**
     * Process movement input
     * Defers to state machine if present, otherwise handles movement directly
     */
    processMovementInput() {
        // Check if we have a state machine - if so, it will handle movement
        const stateMachine = this.entity.getComponent('playerStateMachine');
        if (stateMachine) {
            // The state machine will handle all movement
            return;
        }

        // If no state machine, use legacy movement processing
        this.processLegacyMovement();
    }

    /**
     * Process legacy movement (without state machine)
     * This is kept for backward compatibility
     */
    processLegacyMovement() {
        // Calculate movement direction
        const direction = this.getMovementDirection();

        // Check if there's any movement input
        const isMoving = direction.x !== 0 || direction.y !== 0;

        if (isMoving) {
            // Normalize direction vector for diagonal movement
            if (direction.x !== 0 && direction.y !== 0) {
                const length = Math.sqrt(direction.x * direction.x + direction.y * direction.y);
                direction.x /= length;
                direction.y /= length;
            }

            // Calculate speed based on sprint state
            const sprintMultiplier = this.inputState.sprint ? PLAYER_SPRINT_MULTIPLIER : 1;
            const speed = PLAYER_SPEED * sprintMultiplier;

            // Apply movement directly if we have physics
            const physics = this.entity.getComponent('physics');
            if (physics) {
                physics.setVelocity(direction.x * speed, direction.y * speed);
            }

            // Queue the action for future multiplayer compatibility
            actionManager.queueAction({
                type: 'entity:move',
                entityId: this.entity.id,
                direction,
                speed,
                immediate: true
            });
        } else {
            // No movement keys pressed, stop movement
            const physics = this.entity.getComponent('physics');
            if (physics) {
                physics.setVelocity(0, 0);
            }

            actionManager.queueAction({
                type: 'entity:move',
                entityId: this.entity.id,
                direction: { x: 0, y: 0 },
                speed: 0,
                immediate: true
            });
        }
    }

    /**
     * Get the movement direction based on input
     * @returns {object} Direction vector {x, y}
     */
    getMovementDirection() {
        const direction = {
            x: 0,
            y: 0
        };

        if (this.inputState.left) direction.x -= 1;
        if (this.inputState.right) direction.x += 1;
        if (this.inputState.up) direction.y -= 1;
        if (this.inputState.down) direction.y += 1;

        return direction;
    }

    /**
     * Process attack input
     */
    processAttackInput() {
        // For now, just log the attack
        console.log("Attack key pressed!");
        
        // Queue the action for future multiplayer compatibility
        actionManager.queueAction({
            type: 'entity:attack',
            entityId: this.entity.id,
            attackType: 'primary',
            immediate: true
        });
    }
}