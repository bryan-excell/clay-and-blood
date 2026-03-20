import { PLAYER_RADIUS, COLOR_PLAYER, TILE_SIZE } from "../config.js";
import { gameState } from "../core/GameState.js";
import { CircleComponent } from "../components/CircleComponent.js";
import { KeyboardInputComponent } from "../components/KeyboardInputComponent.js";
import { PlayerStateMachine } from "../components/PlayerStateMachine.js";
import { PlayerCombatComponent } from "../components/PlayerCombatComponent.js";
import { VisibilityComponent } from "../components/VisibilityComponent.js";
import { TransformComponent } from "../components/TransformComponent.js";
import { ControlComponent } from "../components/ControlComponent.js";
import { AuthorityComponent } from "../components/AuthorityComponent.js";
import { IntentComponent } from "../components/IntentComponent.js";
import { ExitTraversalComponent } from "../components/ExitTraversalComponent.js";
import { networkManager } from "../core/NetworkManager.js";
import { getExitApproachDirection, resolveExitTransition, resolveExitSpawnPosition } from '@clay-and-blood/shared';

/**
 * Manages transitions between levels via exits
 */
export class ExitManager {
    /**
     * Create a new exit manager
     * @param {Phaser.Scene} scene - The scene this manager belongs to
     */
    constructor(scene) {
        this.scene = scene;
        this.canTransition = true;
        this._cooldownUntilMs = 0;
        this._blockedExit = null; // { entityId, levelId, exitIndex, exitId } until entity leaves this exit
    }

    /**
     * Handle locally-controlled entity interaction with an exit.
     * @param {Entity} controlledEntity
     * @param {number} exitIndex
     * @param {string|null} exitId
     * @param {{x:number,y:number,width:number,height:number}|null} exitBounds
     */
    handleExit(controlledEntity, exitIndex, exitId = null, exitBounds = null) {
        if (!this.canTransition) return;
        if (!this.canEntityUseExits(controlledEntity)) return;
        const now = performance.now();
        if (now < this._cooldownUntilMs) return;

        const currentLevelId = gameState.currentLevelId;
        if (this._isBlockedExit(controlledEntity, currentLevelId, exitIndex, exitId)) return;

        this.canTransition = false;
        console.log(`Entity ${controlledEntity?.id} using exit ${exitId ?? exitIndex}`);

        const currentLevel = gameState.levels[currentLevelId];

        if (!currentLevel) {
            console.error("Current level not found in game state");
            this.canTransition = true;
            return;
        }

        let targetLevelId;
        let targetExitIndex;
        let targetExitId = null;
        let arrivalDirection = null;

        const approachDirection = this._getApproachDirection(controlledEntity, currentLevel, exitIndex, exitId, exitBounds);

        if (!currentLevel.exitConnections || !currentLevel.exitConnections[exitIndex]) {
            const resolved = resolveExitTransition(currentLevelId, exitIndex, exitId);
            targetLevelId = resolved.toLevelId;
            targetExitIndex = resolved.toExitIndex;
            targetExitId = resolved.toExitId ?? null;
            arrivalDirection = resolved.arrivalDirection ?? resolved.entryDirection ?? null;

            this.scene.levelManager.connectLevels(
                currentLevelId,
                exitIndex,
                targetLevelId,
                targetExitIndex
            );
        } else {
            const connection = currentLevel.exitConnections[exitIndex];
            targetLevelId = connection.levelId;
            targetExitIndex = connection.exitIndex;
            targetExitId = connection.exitId ?? null;
            arrivalDirection = connection.arrivalDirection ?? connection.entryDirection ?? null;
        }

        const targetLevel = this.scene.levelManager.getLevel(targetLevelId);
        const targetExit = (typeof targetExitId === 'string'
            ? targetLevel?.exits?.find((e) => e.id === targetExitId)
            : null) ?? targetLevel?.exits?.find((e) => e.exitIndex === targetExitIndex);
        if (!targetExit) {
            console.error(`Exit ${targetExitId ?? targetExitIndex} not found in target level ${targetLevelId}`);
            this.canTransition = true;
            return;
        }

        const finalPos = this.positionEntityAtExit(
            controlledEntity,
            targetLevel,
            {
                exitIndex: targetExitIndex,
                exitId: targetExit.id ?? targetExitId ?? null,
                approachDirection,
                arrivalDirection,
            }
        );

        this.scene.levelManager.setupLevel(targetLevelId);

        if (finalPos) {
            networkManager.sendLevelChange(targetLevelId, finalPos.x, finalPos.y, {
                entityKey: this.getEntityNetworkKey(controlledEntity),
                fromLevelId: currentLevelId,
                fromExitIndex: exitIndex,
                fromExitId: exitId ?? null,
                toExitIndex: targetExit.exitIndex,
                toExitId: targetExit.id ?? targetExitId ?? null,
                approachDirection,
                arrivalDirection: finalPos.arrivalDirection ?? arrivalDirection ?? null,
            });
        }

        this.scene.setupCollisions();
        this._cooldownUntilMs = performance.now() + 500;
        this._blockedExit = {
            entityId: controlledEntity?.id ?? null,
            levelId: targetLevelId,
            exitIndex: targetExitIndex,
            exitId: targetExit.id ?? targetExitId ?? null,
        };
        this.canTransition = true;
    }

    /**
     * Position an entity near the destination exit tile using deterministic rules.
     * @param {Entity} entity
     * @param {object} targetLevel
     * @param {{ exitIndex:number, exitId?:string|null, approachDirection?:'north'|'east'|'south'|'west'|null, arrivalDirection?:'north'|'east'|'south'|'west'|null }} options
     * @returns {{x:number,y:number,arrivalDirection:'north'|'east'|'south'|'west'|null}|null}
     */
    positionEntityAtExit(entity, targetLevel, options = {}) {
        const targetExit = (typeof options.exitId === 'string'
            ? targetLevel.exits.find((e) => e.id === options.exitId)
            : null) ?? targetLevel.exits.find((e) => e.exitIndex === options.exitIndex);
        if (!targetExit) {
            console.error(`Exit ${options.exitId ?? options.exitIndex} not found in target level`);
            return null;
        }

        const spawn = resolveExitSpawnPosition({
            toLevelId: targetLevel.id,
            toExitIndex: targetExit.exitIndex,
            toExitId: targetExit.id ?? null,
            approachDirection: options.approachDirection ?? null,
            arrivalDirection: options.arrivalDirection ?? null,
        });
        if (!spawn) return null;

        const safeX = spawn.x;
        const safeY = spawn.y;

        const transform = entity.getComponent('transform');
        if (transform) {
            transform.setPosition(safeX, safeY);
            transform.levelId = targetLevel?.id ?? transform.levelId ?? gameState.currentLevelId;
        }

        const visualComponent = entity.getComponent('circle');
        if (!visualComponent || !visualComponent.gameObject) {
            console.log("Recreating controlled entity components after level transition");

            const componentsToRemove = [...entity.components.keys()];
            const position = transform
                ? { x: transform.position.x, y: transform.position.y }
                : { x: safeX, y: safeY };

            for (const componentType of componentsToRemove.reverse()) {
                entity.removeComponent(componentType);
            }

            const newTransform = new TransformComponent(position.x, position.y);
            entity.addComponent(newTransform);
            entity.addComponent(new CircleComponent(PLAYER_RADIUS, COLOR_PLAYER));
            entity.addComponent(new ControlComponent({ controlMode: 'local', controllerId: null }));
            entity.addComponent(new AuthorityComponent({ authority: 'client', ownerId: null }));
            entity.addComponent(new IntentComponent());
            entity.addComponent(new ExitTraversalComponent({ canUseExits: true }));
            entity.addComponent(new KeyboardInputComponent());
            entity.addComponent(new PlayerStateMachine());
            entity.addComponent(new PlayerCombatComponent());
            entity.addComponent(new VisibilityComponent(320));

            const newVisualComponent = entity.getComponent('circle');
            if (newVisualComponent?.gameObject) {
                this.scene.cameras.main.startFollow(newVisualComponent.gameObject);
            }
        } else {
            visualComponent.gameObject.setPosition(safeX, safeY);
        }

        return { x: safeX, y: safeY, arrivalDirection: spawn.arrivalDirection ?? spawn.entryDirection ?? null };
    }

    canEntityUseExits(entity) {
        if (!entity) return false;
        const traversal = entity.getComponent('exitTraversal');
        return !!traversal?.canUseExits;
    }

    updateDebounceState(entity, overlappingExitIndex, overlappingExitId, levelId) {
        if (!this._blockedExit) return;
        if (!entity?.id || this._blockedExit.entityId !== entity.id) return;
        if (this._blockedExit.levelId !== levelId) {
            this._blockedExit = null;
            return;
        }

        // Rearm once the entity is no longer inside the arrival exit trigger.
        const stillInsideSameExit = (typeof this._blockedExit.exitId === 'string' && overlappingExitId === this._blockedExit.exitId)
            || (overlappingExitIndex != null && overlappingExitIndex === this._blockedExit.exitIndex);
        if (!stillInsideSameExit) {
            this._blockedExit = null;
        }
    }

    _isBlockedExit(entity, levelId, exitIndex, exitId = null) {
        if (!this._blockedExit) return false;
        const sameExit = (typeof exitId === 'string' && this._blockedExit.exitId === exitId)
            || this._blockedExit.exitIndex === exitIndex;
        return this._blockedExit.entityId === entity?.id &&
            this._blockedExit.levelId === levelId &&
            sameExit;
    }

    _getApproachDirection(controlledEntity, currentLevel, exitIndex, exitId = null, exitBounds = null) {
        const transform = controlledEntity?.getComponent('transform');
        if (!transform) return null;

        let bounds = exitBounds;
        if (!bounds) {
            const exit = (typeof exitId === 'string'
                ? currentLevel?.exits?.find((candidate) => candidate.id === exitId)
                : null) ?? currentLevel?.exits?.find((candidate) => candidate.exitIndex === exitIndex);
            if (exit) {
                bounds = {
                    x: exit.x * TILE_SIZE + TILE_SIZE / 2,
                    y: exit.y * TILE_SIZE + TILE_SIZE / 2,
                    width: TILE_SIZE,
                    height: TILE_SIZE,
                };
            }
        }
        if (!bounds) return null;

        return getExitApproachDirection({
            currentX: transform.position.x,
            currentY: transform.position.y,
            previousX: transform.previousPosition?.x,
            previousY: transform.previousPosition?.y,
            exitX: bounds.x,
            exitY: bounds.y,
            exitWidth: bounds.width,
            exitHeight: bounds.height,
        });
    }

    getEntityNetworkKey(entity) {
        if (!entity?.id) return null;
        if (entity.id === this.scene.player?.id) {
            return `player:${networkManager.sessionId ?? 'local'}`;
        }
        return `world:${entity.id}`;
    }
}
