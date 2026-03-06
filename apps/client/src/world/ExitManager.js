import { TILE_SIZE, PLAYER_RADIUS, COLOR_PLAYER } from "../config.js";
import { gameState } from "../core/GameState.js";
import { CircleComponent } from "../components/CircleComponent.js";
import { PhysicsCapability } from "../components/PhysicsCapability.js";
import { KeyboardInputComponent } from "../components/KeyboardInputComponent.js";
import { TransformComponent } from "../components/TransformComponent.js";
import { findEmptyTile } from "../utils/helpers.js";
import { EntityLevelGenerator } from "./EntityLevelGenerator.js";
import { networkManager } from "../core/NetworkManager.js";
import { getExitDestination } from '@clay-and-blood/shared';

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
    }

    /**
     * Handle player interaction with an exit
     * @param {Entity} playerEntity - The player entity
     * @param {number} exitIndex - Index of the exit in the current level
     */
    handleExit(playerEntity, exitIndex) {
        if (!this.canTransition) return;

        this.canTransition = false;
        console.log(`Player using exit ${exitIndex}`);

        // Get current level
        const currentLevelId = gameState.currentLevelId;
        const currentLevel = gameState.levels[currentLevelId];

        if (!currentLevel) {
            console.error("Current level not found in game state");
            this.canTransition = true;
            return;
        }

        // Check if this exit has a connection
        if (!currentLevel.exitConnections || !currentLevel.exitConnections[exitIndex]) {
            console.log("Exit has no connection - resolving destination deterministically");

            // Resolve destination: same result on every client for the same source exit
            const { toLevelId: newLevelId, toExitIndex: newExitIndex } = getExitDestination(currentLevelId, exitIndex);
            const newLevel = this.scene.levelManager.getLevel(newLevelId);

            // Find available exits in the new level
            if (newLevel.exits && newLevel.exits.length > 0) {
                console.log(`Selected exit ${newExitIndex} in new level ${newLevelId}`);

                // Set up bidirectional connections between the levels
                this.scene.levelManager.connectLevels(
                    currentLevelId, 
                    exitIndex,
                    newLevelId,
                    newExitIndex
                );
                
                // Actually switch to the new level
                this.scene.levelManager.setupLevel(newLevelId);

                // Position player at the appropriate exit in the new level
                this.positionPlayerAtExit(playerEntity, newLevel, newExitIndex);

                // Notify server of level change with final position
                const circle1 = playerEntity.getComponent('circle');
                if (circle1 && circle1.gameObject) {
                    networkManager.sendLevelChange(newLevelId, circle1.gameObject.x, circle1.gameObject.y);
                }
            } else {
                console.error("New level has no exits - cannot connect levels");
                this.canTransition = true;
                return;
            }
        } else {
            // Get the connected level
            const connection = currentLevel.exitConnections[exitIndex];
            console.log(`Using existing connection to level ${connection.levelId}, exit ${connection.exitIndex}`);

            const targetLevelId = connection.levelId;
            const targetLevel = this.scene.levelManager.getLevel(targetLevelId);
            
            // Verify the connection exit exists in the target level
            const targetExit = targetLevel.exits.find(e => e.exitIndex === connection.exitIndex);
            if (!targetExit) {
                console.error(`Exit ${connection.exitIndex} not found in target level ${targetLevelId}`);
                this.canTransition = true;
                return;
            }

            // Switch to the connected level
            this.scene.levelManager.setupLevel(targetLevelId);

            // Position player at the correct exit
            this.positionPlayerAtExit(playerEntity, targetLevel, connection.exitIndex);

            // Notify server of level change with final position
            const circle2 = playerEntity.getComponent('circle');
            if (circle2 && circle2.gameObject) {
                networkManager.sendLevelChange(targetLevelId, circle2.gameObject.x, circle2.gameObject.y);
            }
        }

        // Update collisions after level change
        this.scene.setupCollisions();

        // Allow transitions again after a short delay
        setTimeout(() => {
            this.canTransition = true;
        }, 500);
    }
    
    /**
     * Position the player at the corresponding exit in the target level
     * @param {Entity} playerEntity - The player entity
     * @param {object} targetLevel - The target level data
     * @param {number} exitIndex - Index of the exit in the target level
     */
    positionPlayerAtExit(playerEntity, targetLevel, exitIndex) {
        // Find the target exit
        const targetExit = targetLevel.exits.find(e => e.exitIndex === exitIndex);
        
        if (!targetExit) {
            console.error(`Exit ${exitIndex} not found in target level`);
            return;
        }
        
        // Find a safe spot near the exit
        const safeSpot = this.findSafeSpotNearExit(targetLevel, targetExit);
        const safeX = safeSpot.x;
        const safeY = safeSpot.y;

        // Update the player transform position
        const transform = playerEntity.getComponent('transform');
        if (transform) {
            transform.setPosition(safeX, safeY);
        }

        // Check if the player's visual component has a valid gameObject
        const visualComponent = playerEntity.getComponent('circle');
        if (!visualComponent || !visualComponent.gameObject) {
            console.log("Recreating player components after level transition");
            
            // Completely rebuild the player entity
            // First, remove ALL components to ensure clean state
            const componentsToRemove = [...playerEntity.components.keys()];
            
            // Only keep the transform component's position data
            const position = transform ? { x: transform.position.x, y: transform.position.y } : { x: safeX, y: safeY };
            
            // Remove all components in reverse order to handle dependencies properly
            for (const componentType of componentsToRemove.reverse()) {
                playerEntity.removeComponent(componentType);
            }
            
            // Add components back in the correct order
            // 1. Transform first (with saved position)
            const newTransform = new TransformComponent(
                position.x, position.y
            );
            playerEntity.addComponent(newTransform);
            
            // 2. Circle visual component
            playerEntity.addComponent(new CircleComponent(
                PLAYER_RADIUS,
                COLOR_PLAYER
            ));
            
            // 3. Physics component
            playerEntity.addComponent(new PhysicsCapability(
                'dynamic',
                { drag: 0 }
            ));
            
            // 4. Input component
            playerEntity.addComponent(new KeyboardInputComponent());
            
            // Get the newly created visual component for camera following
            const newVisualComponent = playerEntity.getComponent('circle');
            if (newVisualComponent && newVisualComponent.gameObject) {
                this.scene.cameras.main.startFollow(newVisualComponent.gameObject);
            }
        } else if (visualComponent.gameObject && visualComponent.gameObject.body) {
            // If visual and physics are still intact, just reset the position
            visualComponent.gameObject.body.reset(safeX, safeY);
        }
    }

    /**
     * Find a safe spot near an exit
     * @param {object} level - The level data
     * @param {object} exit - The exit data
     * @returns {object} Safe position {x, y}
     */
    findSafeSpotNearExit(level, exit) {
        const safeSpots = [];

        // Check tiles in a radius around the exit
        for (let dy = -2; dy <= 2; dy++) {
            for (let dx = -2; dx <= 2; dx++) {
                if (dx === 0 && dy === 0) continue; // Skip the exit itself

                const nx = exit.x + dx;
                const ny = exit.y + dy;

                // Check bounds and if it's a floor tile
                if (nx >= 0 && nx < level.width && ny >= 0 && ny < level.height &&
                    level.grid[ny][nx] === 0) {
                    safeSpots.push({
                        x: nx * TILE_SIZE + TILE_SIZE / 2,
                        y: ny * TILE_SIZE + TILE_SIZE / 2
                    });
                }
            }
        }

        // Return a random safe spot or fallback to offset position
        if (safeSpots.length > 0) {
            return safeSpots[Math.floor(Math.random() * safeSpots.length)];
        } else {
            // Fallback: offset from exit position
            const offsetX = (Math.random() > 0.5 ? 1 : -1) * TILE_SIZE;
            const offsetY = (Math.random() > 0.5 ? 1 : -1) * TILE_SIZE;
            return {
                x: exit.x * TILE_SIZE + TILE_SIZE / 2 + offsetX,
                y: exit.y * TILE_SIZE + TILE_SIZE / 2 + offsetY
            };
        }
    }
}