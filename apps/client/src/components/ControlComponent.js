import { Component } from './Component.js';
import { eventBus } from '../core/EventBus.js';

const VALID_CONTROL_MODES = new Set(['local', 'remote', 'ai', 'disabled']);

/**
 * Defines who currently drives intent for an entity.
 */
export class ControlComponent extends Component {
    constructor({
        controlMode = 'local',
        controllerId = null
    } = {}) {
        super('control');
        this.controlMode = VALID_CONTROL_MODES.has(controlMode) ? controlMode : 'disabled';
        this.controllerId = controllerId;
    }

    setControlMode(nextMode, reason = 'mode:set') {
        if (!VALID_CONTROL_MODES.has(nextMode) || nextMode === this.controlMode) return false;

        const previousControlMode = this.controlMode;
        const previousControllerId = this.controllerId;
        this.controlMode = nextMode;

        this.emitChanged(previousControlMode, previousControllerId, reason);
        return true;
    }

    setController(nextControllerId, reason = 'controller:set') {
        if (nextControllerId === this.controllerId) return false;

        const previousControlMode = this.controlMode;
        const previousControllerId = this.controllerId;
        this.controllerId = nextControllerId;

        this.emitChanged(previousControlMode, previousControllerId, reason);
        return true;
    }

    setControl(nextMode, nextControllerId, reason = 'control:set') {
        if (!VALID_CONTROL_MODES.has(nextMode)) return false;

        const modeChanged = nextMode !== this.controlMode;
        const controllerChanged = nextControllerId !== this.controllerId;
        if (!modeChanged && !controllerChanged) return false;

        const previousControlMode = this.controlMode;
        const previousControllerId = this.controllerId;
        this.controlMode = nextMode;
        this.controllerId = nextControllerId;

        this.emitChanged(previousControlMode, previousControllerId, reason);
        return true;
    }

    emitChanged(previousControlMode, previousControllerId, reason) {
        eventBus.emit('control:changed', {
            entityId: this.entity?.id ?? null,
            controlMode: this.controlMode,
            controllerId: this.controllerId,
            previousControlMode,
            previousControllerId,
            reason
        });
    }
}
