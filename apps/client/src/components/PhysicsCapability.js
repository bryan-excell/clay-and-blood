import { Component } from './Component.js';
import { PhaserObjectComponent } from './PhaserObjectComponent.js';
import { CircleComponent } from './CircleComponent.js';
import { RectangleComponent } from './RectangleComponent.js';

/**
 * Adds physics capabilities to an entity
 * 
 * IMPORTANT: This component is solely responsible for:
 * 1. Physics calculations
 * 2. Collision detection and response
 * 3. Movement via physics forces/velocity
 * 
 * It must coordinate with visual components but maintain separation of concerns
 */
export class PhysicsCapability extends Component {
    /**
     * Create a new PhysicsCapability component
     * @param {string} bodyType - 'dynamic' or 'static'
     * @param {object} options - Additional physics options
     */
    constructor(bodyType = 'dynamic', options = {}) {
        super('physics');

        this.bodyType = bodyType;
        this.immovable = bodyType === 'static';
        this.velocity = { x: 0, y: 0 };
        
        // Track whether we've created a physics body
        this.hasPhysicsBody = false;

        // Store collision configuration
        this.options = {
            // Default options
            bounce: 0,
            friction: 1,
            drag: 0,
            ...options
        };

        // Define dependencies
        this.requireComponent('transform');
        // We'll check for visual components in the onAttach method
    }

    /**
     * When attached to an entity, set up physics for the existing game object
     * @returns {boolean} True if successfully attached
     */
    onAttach() {
        // First check if transform is there
        if (!this.entity.hasComponent('transform')) {
            console.error(`Component ${this.type} requires transform, but it's missing from entity ${this.entity.id}`);
            return false;
        }

        // Find a visual component (circle or rectangle)
        const visualComponent = this.findVisualComponent();
        if (!visualComponent) {
            console.error(`Component ${this.type} requires a visual component (circle/rectangle), but none found on entity ${this.entity.id}`);
            return false;
        }

        // Add physics to the existing game object
        if (!visualComponent.gameObject) {
            console.error(`Visual component has no gameObject for entity ${this.entity.id}`);
            return false;
        }

        // Remove any existing physics body to prevent duplication
        if (visualComponent.gameObject.body) {
            console.warn(`Game object for entity ${this.entity.id} already has a physics body. Removing it before adding a new one.`);
            this.entity.scene.physics.world.remove(visualComponent.gameObject.body);
            visualComponent.gameObject.body = null;
        }

        // Add physics to the existing game object
        this.entity.scene.physics.add.existing(
            visualComponent.gameObject,
            this.bodyType === 'static'
        );

        const body = visualComponent.gameObject.body;
        if (!body) {
            console.error('Failed to create physics body');
            return false;
        }

        this.hasPhysicsBody = true;

        // Configure the body shape based on the type of object component
        this.configureCollisionShape(visualComponent);

        // Set physics properties
        body.immovable = this.immovable;
        body.bounce = this.options.bounce;
        body.friction = this.options.friction;
        body.drag = this.options.drag;

        // Explicitly set the initial position to match the transform component
        const transform = this.entity.getComponent('transform');
        this.syncPositionFromTransform(transform);

        // Enable debug logging for physics issues
        console.log(`Physics body created for entity ${this.entity.id} of type ${this.entity.type}`, {
            x: body.x,
            y: body.y,
            width: body.width,
            height: body.height,
            isCircle: !!body.isCircle
        });

        return true;
    }

    /**
     * Find the first visual component on the entity (circle or rectangle)
     * @returns {Component} The visual component
     */
    findVisualComponent() {
        // Try to find circle or rectangle components
        const circle = this.entity.getComponent('circle');
        if (circle) return circle;

        const rectangle = this.entity.getComponent('rectangle');
        if (rectangle) return rectangle;

        // No visual component found
        return null;
    }

    /**
     * Configure the collision shape based on the PhaserObjectComponent type
     * CRITICAL: This ensures proper alignment between visual and physics representations
     * @param {PhaserObjectComponent} visualComponent - The visual component
     */
    configureCollisionShape(visualComponent) {
        const gameObject = visualComponent.gameObject;
        if (!gameObject || !gameObject.body) return;

        // Get the transform for position reference
        const transform = this.entity.getComponent('transform');
        if (!transform) return;

        if (visualComponent instanceof CircleComponent) {
            const radius = visualComponent.radius;
            
            // For circles, use a circle collider with the component's radius
            gameObject.body.setCircle(radius);
            
            // CRITICAL: Position the physics body correctly relative to the visual
            // No offset needed for circles because both visual and physics use center
            
            console.log(`Configured circle physics body for entity ${this.entity.id} with radius ${radius}`);
        }
        else if (visualComponent instanceof RectangleComponent) {
            const width = visualComponent.width;
            const height = visualComponent.height;

            // setSize with center=true (default) auto-calculates the offset to keep the body
            // centered on the game object. Since our Rectangle game objects use origin (0.5, 0.5),
            // no manual offset is needed — adding one would double-offset and break collision.
            gameObject.body.setSize(width, height);

            console.log(`Configured rectangle physics body for entity ${this.entity.id} with width ${width} and height ${height}`);
        }
    }

    /**
     * Sync the physics body position from the transform component
     * @param {TransformComponent} transform - The transform component
     */
    syncPositionFromTransform(transform) {
        const visualComponent = this.findVisualComponent();
        if (!visualComponent || !visualComponent.gameObject || !visualComponent.gameObject.body) return;
        
        const body = visualComponent.gameObject.body;
        
        // Reset the body position to the transform position
        // This ensures the physics body is correctly positioned at the entity's center
        body.reset(transform.position.x, transform.position.y);
    }

    /**
     * Set the velocity of the physics body
     * @param {number} x - X velocity component
     * @param {number} y - Y velocity component
     * @returns {PhysicsCapability} - Returns this for chaining
     */
    setVelocity(x, y) {
        this.velocity.x = x;
        this.velocity.y = y;

        const visualComponent = this.findVisualComponent();
        if (visualComponent && visualComponent.gameObject && visualComponent.gameObject.body) {
            visualComponent.gameObject.body.setVelocity(x, y);
        }

        return this;
    }

    /**
     * Update physics state
     * Physics is the authority for position when an entity is moving
     * @param {number} deltaTime - Time in ms since last update
     */
    update(deltaTime) {
        // Only needed for dynamic bodies
        if (this.bodyType !== 'dynamic' || !this.hasPhysicsBody) return;

        const transform = this.entity.getComponent('transform');
        const visualComponent = this.findVisualComponent();

        if (!transform || !visualComponent || !visualComponent.gameObject || !visualComponent.gameObject.body) {
            return;
        }

        const body = visualComponent.gameObject.body;

        // Only update the transform from physics if we're actually moving
        // This prevents jittering when standing still
        if (Math.abs(body.velocity.x) > 0.001 || Math.abs(body.velocity.y) > 0.001 ||
            body.position.x !== body.prev.x || body.position.y !== body.prev.y) {

            // Get the physics body's center position
            let physicsX, physicsY;

            if (body.isCircle) {
                physicsX = body.x + body.radius;
                physicsY = body.y + body.radius;
            } else {
                physicsX = body.x + body.width/2;
                physicsY = body.y + body.height/2;
            }

            // Set transform position directly (avoiding triggering unnecessary updates)
            if (Number.isFinite(physicsX) && Number.isFinite(physicsY)) {
                transform.position.x = physicsX;
                transform.position.y = physicsY;
                // Tell the visual component not to override this position
                visualComponent._skipNextPositionUpdate = true;
            } else {
                // Phaser produced a NaN/Infinite body position (degenerate collision).
                // Reset the body back to the last known-good transform position so the
                // NaN doesn't propagate into go.x/go.y and corrupt the camera.
                const safeX = transform.position.x;
                const safeY = transform.position.y;
                console.error(`[Physics] NaN body position (body.x=${body.x} body.y=${body.y} body.radius=${body.radius}) — resetting to transform (${safeX.toFixed(1)}, ${safeY.toFixed(1)})`);
                if (Number.isFinite(safeX) && Number.isFinite(safeY)) {
                    body.reset(safeX, safeY);
                }
                // Do NOT set _skipNextPositionUpdate — let circle.update() restore go.x/go.y
                // from the transform so the camera never sees the NaN.
            }
        }
    }

    /**
     * Clean up physics when component is detached
     */
    onDetach() {
        // Find the visual component and clean up its physics body
        const visualComponent = this.findVisualComponent();
        if (visualComponent && visualComponent.gameObject && visualComponent.gameObject.body) {
            // Explicitly disable the physics body before destroying
            visualComponent.gameObject.body.enable = false;
            
            // If this is Arcade Physics, we can do more cleanup
            if (this.entity.scene.physics.world.remove) {
                // Remove body from the physics world to prevent lingering collisions
                this.entity.scene.physics.world.remove(visualComponent.gameObject.body);
            }
            
            // Remove the body reference from the game object
            visualComponent.gameObject.body = null;
            
            this.hasPhysicsBody = false;
            console.log(`Physics body removed for entity ${this.entity.id} of type ${this.entity.type}`);
        }
    }

    /**
     * Get network state
     * @returns {object} Serializable state
     */
    getNetworkState() {
        return {
            velocity: { ...this.velocity },
            immovable: this.immovable
        };
    }

    /**
     * Apply network state
     * @param {object} state - State to apply
     */
    applyNetworkState(state) {
        if (state.velocity) {
            this.setVelocity(state.velocity.x, state.velocity.y);
        }
    }
}