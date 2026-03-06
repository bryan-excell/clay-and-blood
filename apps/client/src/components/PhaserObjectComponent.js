import { Component } from './Component.js';

/**
 * Base class for components that own a Phaser game object
 * Each entity should have at most one PhaserObjectComponent
 * 
 * IMPORTANT: This component is for VISUAL REPRESENTATION ONLY
 * It should not handle physics or collision detection
 * Position coordinates refer to the CENTER of the visual representation
 */
export class PhaserObjectComponent extends Component {
    /**
     * Create a new PhaserObjectComponent
     * @param {string} type - Component type identifier (default: 'phaserObject')
     */
    constructor(type = 'phaserObject') {
        super(type);
        this.gameObject = null;
        this.depth = 0;
        this.visible = true;
        this._skipNextPositionUpdate = false; // Used for coordination with physics

        // All PhaserObjectComponents depend on transform data
        this.requireComponent('transform');
    }

    /**
     * Create the Phaser game object
     * Abstract method to be implemented by subclasses
     * @returns {Phaser.GameObjects.GameObject} The created game object
     */
    createGameObject() {
        throw new Error('PhaserObjectComponent subclasses must implement createGameObject()');
    }

    /**
     * When attached to an entity, create the game object
     * @returns {boolean} True if successfully attached
     */
    onAttach() {
        // Check dependencies first
        if (!super.onAttach()) return false;

        try {
            // Create the Phaser game object
            this.gameObject = this.createGameObject();

            if (!this.gameObject) {
                console.error(`Failed to create game object for entity ${this.entity.id}`);
                return false;
            }

            // Store a reference to the entity on the game object for easy access
            this.gameObject.entity = this.entity;

            // Set initial properties
            this.setVisible(this.visible);
            this.setDepth(this.depth);

            return true;
        } catch (error) {
            console.error(`Error creating game object for entity ${this.entity.id}:`, error);
            return false;
        }
    }

    /**
     * Clean up the game object when the component is detached
     */
    onDetach() {
        if (this.gameObject) {
            // Ensure we only destroy the visual component, not any physics attachments
            // This is important: we're only responsible for the visual representation
            if (this.gameObject.body) {
                console.warn(`Game object for entity ${this.entity.id} still has a physics body when visual component is being detached. This suggests incorrect component lifecycle management.`);
                // We'll let the physics component handle its own cleanup
            }
            
            this.gameObject.destroy();
            this.gameObject = null;
        }
    }

    /**
     * Update the visual game object from transform data
     * @param {number} deltaTime - Time in ms since last update
     */
    update(deltaTime) {
        if (!this.gameObject) return;

        const transform = this.entity.getComponent('transform');
        if (transform) {
            this.updateFromTransform(transform);
        }
    }

    /**
     * Update the game object from transform data
     * VISUAL POSITION ONLY - does not affect physics
     * @param {TransformComponent} transform - The transform component
     */
    updateFromTransform(transform) {
        if (!this.gameObject) return;

        // Skip position update if physics has just handled positioning
        if (this._skipNextPositionUpdate) {
            this._skipNextPositionUpdate = false;
        } else {
            // Position is relative to the CENTER of the visual object
            this.gameObject.setPosition(transform.position.x, transform.position.y);
        }

        // Always update rotation and scale
        this.gameObject.setRotation(transform.rotation);

        // Scale might not be supported by all game objects
        if (typeof this.gameObject.setScale === 'function') {
            this.gameObject.setScale(transform.scale.x, transform.scale.y);
        }
    }

    /**
     * Set the visibility of the game object
     * @param {boolean} visible - Whether the object should be visible
     * @returns {PhaserObjectComponent} - Returns this for chaining
     */
    setVisible(visible) {
        this.visible = visible;
        if (this.gameObject && typeof this.gameObject.setVisible === 'function') {
            this.gameObject.setVisible(visible);
        }
        return this;
    }

    /**
     * Set the render depth of the game object
     * @param {number} depth - Render depth
     * @returns {PhaserObjectComponent} - Returns this for chaining
     */
    setDepth(depth) {
        this.depth = depth;
        if (this.gameObject && typeof this.gameObject.setDepth === 'function') {
            this.gameObject.setDepth(depth);
        }
        return this;
    }

    /**
     * Get network serializable state
     * @returns {object} Serializable state
     */
    getNetworkState() {
        return {
            visible: this.visible,
            depth: this.depth
        };
    }

    /**
     * Apply network state update
     * @param {object} state - State to apply
     */
    applyNetworkState(state) {
        if (state.visible !== undefined) {
            this.setVisible(state.visible);
        }
        if (state.depth !== undefined) {
            this.setDepth(state.depth);
        }
    }
}