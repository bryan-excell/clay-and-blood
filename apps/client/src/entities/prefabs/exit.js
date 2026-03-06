import { TransformComponent } from '../../components/TransformComponent.js';
import { RectangleComponent } from '../../components/RectangleComponent.js';
import { PhysicsCapability } from '../../components/PhysicsCapability.js';
import { TILE_SIZE, COLOR_EXIT } from '../../config.js';
import { Component } from '../../components/Component.js';

/**
 * Component specific to exits for handling interactions
 */
class ExitComponent extends Component {
    /**
     * Create a new exit component
     * @param {number} exitIndex - The index of this exit in the stage
     */
    constructor(exitIndex) {
        super('exit');
        this.exitIndex = exitIndex;
    }

    /**
     * Get serializable state
     * @returns {object} Serializable state
     */
    getNetworkState() {
        return {
            exitIndex: this.exitIndex
        };
    }
}

/**
 * Creates an exit entity with the updated component architecture
 * @param {Phaser.Scene} scene - The scene this entity belongs to
 * @param {object} config - Configuration options
 * @returns {Entity} The created exit entity
 */
export function createExit(scene, config = {}) {
    const {
        x = 0,
        y = 0,
        width = TILE_SIZE,
        height = TILE_SIZE,
        color = COLOR_EXIT,
        exitIndex = 0
    } = config;

    const exit = scene.entityFactory.createEntity(`exit_${exitIndex}`);
    exit.type = 'exit'; // Mark as exit type for easier filtering

    // Add components in dependency order:

    // 1. First add the transform (foundation for other components)
    exit.addComponent(new TransformComponent(x, y));

    // 2. Add the visual representation (creates the Phaser game object)
    // Ethereal blue portal with glowing edge
    exit.addComponent(new RectangleComponent(width, height, color, 0.75, 0x88bbff, 3));

    // 3. Add physics capability with static body type
    // Important: The physics body will match the rectangle shape
    exit.addComponent(new PhysicsCapability('static'));

    // 4. Add exit-specific logic
    exit.addComponent(new ExitComponent(exitIndex));

    return exit;
}