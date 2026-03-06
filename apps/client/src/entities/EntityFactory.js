import { Entity } from './Entity.js';
import { createExit } from './prefabs/exit.js';
import { createPlayer } from './prefabs/player.js';
import { createWallStone, createFloorDirt, createFloorGrass } from './prefabs/environment/index.js';

/**
 * Factory for creating game entities
 */
export class EntityFactory {
    constructor(scene) {
        this.scene = scene;
        this.prefabs = {};

        // Register the built-in prefabs
        this.registerDefaultPrefabs();
    }

    /**
     * Register default prefabs
     */
    registerDefaultPrefabs() {
        // Character prefabs
        this.registerPrefab('player', createPlayer);
        
        // Interactive object prefabs
        this.registerPrefab('exit', createExit);
        
        // Environment prefabs
        this.registerPrefab('wall_stone', createWallStone);
        this.registerPrefab('floor_dirt', createFloorDirt);
        this.registerPrefab('floor_grass', createFloorGrass);

        // Log prefabs for debugging
        console.log("Registered prefabs:", Object.keys(this.prefabs));
    }

    /**
     * Create a basic entity
     * @param {string} id - Optional entity ID
     * @returns {Entity} - New entity
     */
    createEntity(id = null) {
        return new Entity(this.scene, id);
    }

    /**
     * Create an entity from a prefab
     * @param {string} prefabName - Name of the prefab
     * @param {object} config - Configuration override
     * @returns {Entity} - The created entity
     */
    createFromPrefab(prefabName, config = {}) {
        if (!this.prefabs[prefabName]) {
            console.error(`Prefab "${prefabName}" not found`);
            console.error("Available prefabs:", Object.keys(this.prefabs));
            return null;
        }

        return this.prefabs[prefabName](this.scene, config);
    }

    /**
     * Register a prefab
     * @param {string} name - Prefab name
     * @param {function} factoryFn - Factory function
     */
    registerPrefab(name, factoryFn) {
        this.prefabs[name] = factoryFn;
    }
}