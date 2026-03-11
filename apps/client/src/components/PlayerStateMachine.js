import { Component } from './Component.js';
import { eventBus } from '../core/EventBus.js';
import { networkManager } from '../core/NetworkManager.js';
import { uiStateStore } from '../core/UiStateStore.js';
import { PLAYER_SPEED, PLAYER_SPRINT_MULTIPLIER } from '../config.js';

/**
 * Movement state machine for controllable entities.
 * Combat/weapon behavior is handled by PlayerCombatComponent.
 */
export class PlayerStateMachine extends Component {
    constructor() {
        super('playerStateMachine');

        this.movementStates = {
            STANDING: 'standing',
            WALKING: 'walking',
            RUNNING: 'running',
            DASHING: 'dashing',
        };

        this.currentMovementState = this.movementStates.STANDING;
        this.dashCooldown = 0;
        this.dashDuration = 0;
        this.dashDirection = { x: 0, y: 0 };
        this.maxDashCooldown = 1000;
        this.maxDashDuration = 250;
        this.desiredVelocity = { x: 0, y: 0 };

        this.requireComponent('intent');
    }

    onAttach() {
        if (!super.onAttach()) return false;
        return true;
    }

    updateDashState(intent, deltaTime) {
        const inputState = this._intentToInputState(intent);

        if (this.currentMovementState === this.movementStates.DASHING) {
            this.dashDuration -= deltaTime;

            if (this.dashDuration <= 0) {
                this.dashDuration = 0;
                if (inputState.up || inputState.down || inputState.left || inputState.right) {
                    this.currentMovementState = inputState.sprint
                        ? this.movementStates.RUNNING
                        : this.movementStates.WALKING;
                } else {
                    this.currentMovementState = this.movementStates.STANDING;
                }
                this.applyMovementFromIntent(intent);
            }

            this.desiredVelocity.x = this.dashDirection.x * 800;
            this.desiredVelocity.y = this.dashDirection.y * 800;
            return;
        }

        if (this.dashCooldown > 0) {
            this.dashCooldown -= deltaTime;
            if (this.dashCooldown < 0) this.dashCooldown = 0;
        }

        if (inputState.dash && this.dashCooldown === 0 && this.currentMovementState !== this.movementStates.STANDING) {
            this.startDashFromIntent(intent);
        }
    }

    updateLocomotionState(intent) {
        if (this.currentMovementState === this.movementStates.DASHING) return;

        const moving = Math.abs(intent.moveX) > 0.0001 || Math.abs(intent.moveY) > 0.0001;
        if (moving) {
            const newState = intent.wantsSprint ? this.movementStates.RUNNING : this.movementStates.WALKING;
            this.currentMovementState = newState;
            return;
        }

        this.currentMovementState = this.movementStates.STANDING;
    }

    startDashFromIntent(intent) {
        if (this.currentMovementState === this.movementStates.STANDING) return;
        if ((uiStateStore.get('controlledEntity')?.stamina ?? 0) <= 0) return;

        this.dashDirection = { x: intent.moveX, y: intent.moveY };
        if (this.dashDirection.x === 0 && this.dashDirection.y === 0) {
            this.dashDirection = { x: 0, y: 1 };
        }

        const dirLen = Math.sqrt(this.dashDirection.x ** 2 + this.dashDirection.y ** 2);
        if (dirLen > 0) {
            this.dashDirection.x /= dirLen;
            this.dashDirection.y /= dirLen;
        }

        this.currentMovementState = this.movementStates.DASHING;
        this.dashDuration = this.maxDashDuration;
        this.dashCooldown = this.maxDashCooldown;

        const keyboard = this.entity.getComponent('keyboard');
        const dashInput = keyboard?.inputState ?? this._intentToInputState(intent);
        const dashSeq = this.entity.getComponent('control')?.controlMode === 'local'
            ? networkManager.sendDash(dashInput)
            : -1;

        eventBus.emit('player:dashStarted', { input: dashInput, seq: dashSeq });
        this.desiredVelocity.x = this.dashDirection.x * 800;
        this.desiredVelocity.y = this.dashDirection.y * 800;
    }

    applyMovementFromIntent(intent) {
        if (this.currentMovementState === this.movementStates.DASHING) return;

        const direction = {
            x: intent.moveX ?? 0,
            y: intent.moveY ?? 0,
        };

        const isMoving = direction.x !== 0 || direction.y !== 0;
        if (!isMoving) {
            this.desiredVelocity.x = 0;
            this.desiredVelocity.y = 0;
            return;
        }

        if (direction.x !== 0 && direction.y !== 0) {
            const length = Math.sqrt(direction.x * direction.x + direction.y * direction.y);
            direction.x /= length;
            direction.y /= length;
        }

        let speed = 0;
        if (this.currentMovementState === this.movementStates.WALKING) {
            speed = PLAYER_SPEED;
        } else if (this.currentMovementState === this.movementStates.RUNNING) {
            speed = PLAYER_SPEED * PLAYER_SPRINT_MULTIPLIER;
        }

        this.desiredVelocity.x = direction.x * speed;
        this.desiredVelocity.y = direction.y * speed;
    }

    _intentToInputState(intent) {
        return {
            up: (intent.moveY ?? 0) < -0.0001,
            down: (intent.moveY ?? 0) > 0.0001,
            left: (intent.moveX ?? 0) < -0.0001,
            right: (intent.moveX ?? 0) > 0.0001,
            sprint: !!intent.wantsSprint,
            dash: !!intent.wantsDash,
        };
    }

    update(_deltaTime) {}
}
