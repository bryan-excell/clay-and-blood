import { eventBus } from "../core/EventBus.js";
import { PhaserObjectComponent } from "../components/PhaserObjectComponent.js";

/**
 * Entity class
 * A container for components with improved dependency handling
 */
export class Entity {
    constructor(scene, id) {
        // Generate a unique ID (critical for network identification)
        this.id = id || `entity_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
        this.scene = scene;
        this.components = new Map();
        this.type = 'entity'; // Base type, can be overridden by prefabs

        // Register with game state
        eventBus.emit('entity:created', { entity: this });
    }

    /**
     * Add a component to this entity with dependency checking
     * @param {Component} component - The component to add
     * @returns {Entity} - Returns this for chaining
     */
    addComponent(component) {
        // Prevent multiple PhaserObjectComponents
        if (component instanceof PhaserObjectComponent) {
            for (const [type, existingComponent] of this.components.entries()) {
                if (existingComponent instanceof PhaserObjectComponent) {
                    console.error(`Entity ${this.id} already has a PhaserObjectComponent (${existingComponent.type}). Cannot add another (${component.type}).`);
                    return this;
                }
            }
        }

        component.entity = this;

        // Check if component initialization succeeded
        if (!component.onAttach()) {
            console.warn(`Failed to attach component ${component.type} to entity ${this.id} due to unmet dependencies.`);
            component.entity = null;
            return this;
        }

        this.components.set(component.type, component);
        return this;
    }

    /**
     * Get a component by type
     * @param {string} type - Component type
     * @returns {Component|undefined} - The component or undefined
     */
    getComponent(type) {
        return this.components.get(type);
    }

    /**
     * Find a component that is an instance of the given base class
     * @param {Function} baseClass - The component class to check for
     * @returns {Component|null} - The first matching component or null
     */
    getComponentOfType(baseClass) {
        for (const component of this.components.values()) {
            if (component instanceof baseClass) {
                return component;
            }
        }
        return null;
    }

    /**
     * Check if entity has a component
     * @param {string} type - Component type
     * @returns {boolean} - True if entity has component
     */
    hasComponent(type) {
        return this.components.has(type);
    }

    /**
     * Remove a component
     * @param {string} type - Component type
     * @returns {Entity} - Returns this for chaining
     */
    removeComponent(type) {
        const component = this.components.get(type);
        if (component) {
            component.onDetach();
            this.components.delete(type);
        }
        return this;
    }

    /**
     * Update all components
     * @param {number} deltaTime - Time since last update in ms
     */
    update(deltaTime) {
        for (const component of this.components.values()) {
            if (component.update) {
                component.update(deltaTime);
            }
        }
    }

    /**
     * Get a network serializable state for this entity
     * @returns {object} Network-ready state object
     */
    getNetworkState() {
        const state = {
            id: this.id,
            type: this.type,
            components: {}
        };

        // Collect serializable data from components
        for (const [type, component] of this.components.entries()) {
            if (component.getNetworkState) {
                state.components[type] = component.getNetworkState();
            }
        }

        return state;
    }

    /**
     * Apply a network state update
     * @param {object} state - Network state to apply
     */
    applyNetworkState(state) {
        if (state.components) {
            for (const [type, componentState] of Object.entries(state.components)) {
                const component = this.getComponent(type);
                if (component && component.applyNetworkState) {
                    component.applyNetworkState(componentState);
                }
            }
        }
    }

    /**
     * Destroy this entity and all its components
     */
    destroy() {
        // Clean up all components
        for (const component of this.components.values()) {
            component.onDetach();
        }

        this.components.clear();
        eventBus.emit('entity:destroyed', { entityId: this.id });
    }
}