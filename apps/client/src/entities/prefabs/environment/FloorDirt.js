import { TransformComponent } from '../../../components/TransformComponent.js';
import { RectangleComponent } from '../../../components/RectangleComponent.js';
import { TILE_SIZE } from '../../../config.js';

/**
 * Dirt Floor - Walkable environmental tile
 * Basic floor type typically used for indoor areas, dungeons, and caves
 */
export function createFloorDirt(scene, config = {}) {
    const {
        x = 0,
        y = 0,
        width = TILE_SIZE,
        height = TILE_SIZE,
        color = 0x2a1808, // Dark muddy earth
    } = config;

    // Create entity with a consistent naming pattern
    const floorEntity = scene.entityFactory.createEntity();
    floorEntity.type = 'floor_dirt'; // Tag type for filtering

    // Add components in dependency order:
    
    // 1. Transform component (foundation)
    floorEntity.addComponent(new TransformComponent(x, y));

    // 2. Visual representation
    // Note: No physics component because floors are walkable
    // Rendering order ensures floors appear below other entities
    const rectComponent = new RectangleComponent(width, height, color);
    floorEntity.addComponent(rectComponent);
    
    // Set depth to ensure floors render below other entities
    if (rectComponent.gameObject) {
        rectComponent.setDepth(-10);
    }

    return floorEntity;
}