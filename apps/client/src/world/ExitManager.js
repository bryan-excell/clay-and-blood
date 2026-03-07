import { PLAYER_RADIUS, COLOR_PLAYER } from "../config.js";
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
import { resolveExitTransition, resolveExitSpawnPosition } from '@clay-and-blood/shared';

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
        this._blockedExit = null; // { entityId, levelId, exitIndex } until entity leaves this exit
    }

    /**
     * Handle locally-controlled entity interaction with an exit.
     * @param {Entity} controlledEntity
     * @param {number} exitIndex
     */
    handleExit(controlledEntity, exitIndex) {
        if (!this.canTransition) return;
        if (!this.canEntityUseExits(controlledEntity)) return;
        const now = performance.now();
        if (now < this._cooldownUntilMs) return;

        const currentLevelId = gameState.currentLevelId;
        if (this._isBlockedExit(controlledEntity, currentLevelId, exitIndex)) return;

        this.canTransition = false;
        console.log(`Entity ${controlledEntity?.id} using exit ${exitIndex}`);

        const currentLevel = gameState.levels[currentLevelId];

        if (!currentLevel) {
            console.error("Current level not found in game state");
            this.canTransition = true;
            return;
        }

        let targetLevelId;
        let targetExitIndex;
        let entryDirection = null;

        if (!currentLevel.exitConnections || !currentLevel.exitConnections[exitIndex]) {
            const resolved = resolveExitTransition(currentLevelId, exitIndex);
            targetLevelId = resolved.toLevelId;
            targetExitIndex = resolved.toExitIndex;
            entryDirection = resolved.entryDirection ?? null;

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
            entryDirection = connection.entryDirection ?? null;
        }

        const targetLevel = this.scene.levelManager.getLevel(targetLevelId);
        const targetExit = targetLevel?.exits?.find((e) => e.exitIndex === targetExitIndex);
        if (!targetExit) {
            console.error(`Exit ${targetExitIndex} not found in target level ${targetLevelId}`);
            this.canTransition = true;
            return;
        }

        this.scene.levelManager.setupLevel(targetLevelId);

        const finalPos = this.positionEntityAtExit(
            controlledEntity,
            targetLevel,
            targetExitIndex,
            entryDirection
        );

        if (finalPos) {
            networkManager.sendLevelChange(targetLevelId, finalPos.x, finalPos.y, {
                entityKey: this.getEntityNetworkKey(controlledEntity),
                fromLevelId: currentLevelId,
                fromExitIndex: exitIndex,
                toExitIndex: targetExitIndex,
                entryDirection,
            });
        }

        this.scene.setupCollisions();
        this._cooldownUntilMs = performance.now() + 500;
        this._blockedExit = {
            entityId: controlledEntity?.id ?? null,
            levelId: targetLevelId,
            exitIndex: targetExitIndex,
        };
        this.canTransition = true;
    }

    /**
     * Position an entity near the destination exit tile using deterministic rules.
     * @param {Entity} entity
     * @param {object} targetLevel
     * @param {number} exitIndex
     * @param {'north'|'east'|'south'|'west'|null} entryDirection
     * @returns {{x:number,y:number}|null}
     */
    positionEntityAtExit(entity, targetLevel, exitIndex, entryDirection = null) {
        const targetExit = targetLevel.exits.find((e) => e.exitIndex === exitIndex);
        if (!targetExit) {
            console.error(`Exit ${exitIndex} not found in target level`);
            return null;
        }

        const spawn = resolveExitSpawnPosition({
            toLevelId: targetLevel.id,
            toExitIndex: targetExit.exitIndex,
            entryDirection,
        });
        if (!spawn) return null;

        const safeX = spawn.x;
        const safeY = spawn.y;

        const transform = entity.getComponent('transform');
        if (transform) {
            transform.setPosition(safeX, safeY);
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

        return { x: safeX, y: safeY };
    }

    canEntityUseExits(entity) {
        if (!entity) return false;
        const traversal = entity.getComponent('exitTraversal');
        return !!traversal?.canUseExits;
    }

    updateDebounceState(entity, overlappingExitIndex, levelId) {
        if (!this._blockedExit) return;
        if (!entity?.id || this._blockedExit.entityId !== entity.id) return;
        if (this._blockedExit.levelId !== levelId) {
            this._blockedExit = null;
            return;
        }

        // Rearm once the entity is no longer inside the arrival exit trigger.
        if (overlappingExitIndex == null || overlappingExitIndex !== this._blockedExit.exitIndex) {
            this._blockedExit = null;
        }
    }

    _isBlockedExit(entity, levelId, exitIndex) {
        if (!this._blockedExit) return false;
        return this._blockedExit.entityId === entity?.id &&
            this._blockedExit.levelId === levelId &&
            this._blockedExit.exitIndex === exitIndex;
    }

    getEntityNetworkKey(entity) {
        if (!entity?.id) return null;
        if (entity.id === this.scene.player?.id) {
            return `player:${networkManager.sessionId ?? 'local'}`;
        }
        return `world:${entity.id}`;
    }
}
