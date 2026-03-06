import { TransformComponent } from '../../../components/TransformComponent.js';
import { RectangleComponent } from '../../../components/RectangleComponent.js';
import { TILE_SIZE } from '../../../config.js';

/**
 * Grass Floor - Walkable environmental tile
 * Used for outdoor areas, forests, and nature-themed sections
 */
export function createFloorGrass(scene, config = {}) {
    const {
        x = 0,
        y = 0,
        width = TILE_SIZE,
        height = TILE_SIZE,
        color = 0x1a2e12, // Deep shadowed forest floor
    } = config;

    // Create entity with a consistent naming pattern
    const floorEntity = scene.entityFactory.createEntity();
    floorEntity.type = 'floor_grass'; // Tag type for filtering

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