import { eventBus } from "../core/EventBus.js";
import { EntityFactory } from "./EntityFactory.js";
import * as Prefabs from "./prefabs/index.js";

/**
 * Manages all entities in the game
 */
export class EntityManager {
    constructor(scene) {
        this.scene = scene;
        this.entities = {};
        this.entityTypes = new Map();

        // Create an entity factory
        this.factory = new EntityFactory(scene);

        // Register prefabs with the factory
        this.registerDefaultPrefabs();

        // Make factory available on the scene
        scene.entityFactory = this.factory;

        // Listen for entity events
        eventBus.on('entity:created', this.registerEntity.bind(this));
        eventBus.on('entity:destroyed', this.unregisterEntity.bind(this));
    }

    /**
     * Register default prefabs
     */
    registerDefaultPrefabs() {
        for (const [name, prefab] of Object.entries(Prefabs)) {
            // Convert from camelCase to kebab-case
            const prefabName = name
                .replace(/^create/, '')
                .replace(/([a-z])([A-Z])/g, '$1-$2')
                .toLowerCase();

            this.factory.registerPrefab(prefabName, prefab);
        }
    }

    /**
     * Register a new entity
     * @param {object} data - Entity data
     */
    registerEntity(data) {
        const { entity } = data;
        this.entities[entity.id] = entity;
    }

    /**
     * Unregister an entity
     * @param {object} data - Entity data
     */
    unregisterEntity(data) {
        const { entityId } = data;

        if (this.entities[entityId]) {
            delete this.entities[entityId];
        }
    }

    /**
     * Update all entities
     * @param {number} deltaTime - Time since last update in ms
     */
    update(deltaTime) {
        Object.values(this.entities).forEach(entity => {
            entity.update(deltaTime);
        });
    }

    /**
     * Update only specific component types across all entities.
     * Components are updated at most once per call, in the given type order.
     * @param {number} deltaTime - Time since last update in ms
     * @param {string[]} componentTypes - Ordered list of component type ids
     * @param {Set<object>} [updatedComponents] - Optional set to track already-updated components
     */
    updateComponents(deltaTime, componentTypes, updatedComponents = null) {
        const tracked = updatedComponents ?? new Set();
        const entities = Object.values(this.entities);

        for (const type of componentTypes) {
            for (const entity of entities) {
                const component = entity.getComponent(type);
                if (!component || tracked.has(component) || !component.update) continue;
                component.update(deltaTime);
                tracked.add(component);
            }
        }

        return tracked;
    }

    /**
     * Update components that have not yet been updated in the current frame.
     * @param {number} deltaTime - Time since last update in ms
     * @param {Set<object>} updatedComponents - Components already processed this frame
     */
    updateRemainingComponents(deltaTime, updatedComponents) {
        const tracked = updatedComponents ?? new Set();
        const entities = Object.values(this.entities);

        for (const entity of entities) {
            for (const component of entity.components.values()) {
                if (!component.update || tracked.has(component)) continue;
                component.update(deltaTime);
                tracked.add(component);
            }
        }

        return tracked;
    }

    /**
     * Get entity by ID
     * @param {string} id - Entity ID
     * @returns {Entity} The entity if found
     */
    getEntityById(id) {
        return this.entities[id];
    }

    /**
     * Get all entities with a specific component
     * @param {string} componentType - Component type
     * @returns {Array} Entities with the component
     */
    getEntitiesWithComponent(componentType) {
        return Object.values(this.entities).filter(entity =>
            entity.hasComponent(componentType)
        );
    }

    /**
     * Get all entities in a radius
     * @param {number} x - Center X
     * @param {number} y - Center Y
     * @param {number} radius - Search radius
     * @returns {Array} Entities within radius
     */
    getEntitiesInRadius(x, y, radius) {
        const radiusSquared = radius * radius;

        return Object.values(this.entities).filter(entity => {
            const transform = entity.getComponent('transform');
            if (!transform) return false;

            const dx = transform.position.x - x;
            const dy = transform.position.y - y;
            return (dx * dx + dy * dy) <= radiusSquared;
        });
    }

    /**
     * Get all entities of a specific type
     * @param {string} type - Entity type
     * @returns {Array} Entities of the specified type
     */
    getEntitiesByType(type) {
        return Object.values(this.entities).filter(entity => 
            entity.type === type
        );
    }
}
