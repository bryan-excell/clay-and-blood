import {
    TILE_EXIT,
    TILE_FLOOR,
    TILE_SHALLOW_WATER,
    TILE_TALL_GRASS,
    TILE_VOID,
    TILE_WALL,
} from '../../../packages/shared/src/index.js';

export const TILE_TO_CHAR = Object.freeze({
    [TILE_FLOOR]: '.',
    [TILE_WALL]: '#',
    [TILE_EXIT]: 'E',
    [TILE_VOID]: '^',
    [TILE_TALL_GRASS]: ',',
    [TILE_SHALLOW_WATER]: '~',
});

export function makeCharGrid(width, height, fill = '^') {
    return Array.from({ length: height }, () => Array.from({ length: width }, () => fill));
}

export function serializeCharGrid(grid) {
    return grid.map((row) => row.join('')).join('\n');
}

export function stageToAscii(stage, options = {}) {
    const markerByExitId = options.markerByExitId ?? {};
    const grid = stage.tiles.map((row) => row.map((tile) => TILE_TO_CHAR[tile] ?? '?'));
    for (const exit of stage.exits ?? []) {
        grid[exit.y][exit.x] = markerByExitId[exit.id] ?? 'E';
    }
    if (options.showArrivals !== false) {
        for (const exit of stage.exits ?? []) {
            const arrival = exit.arrival;
            if (!arrival) continue;
            const marker = (markerByExitId[exit.id] ?? '@').toLowerCase();
            if (grid[arrival.y]?.[arrival.x]) grid[arrival.y][arrival.x] = marker;
        }
    }
    return serializeCharGrid(grid);
}

export function printStageSummary(stage) {
    const lines = [
        `${stage.id} (${stage.width}x${stage.height})`,
        `zone: ${stage.zoneId}`,
        `exits: ${(stage.exits ?? []).map((exit) => `${exit.id}@${exit.x},${exit.y}`).join(', ')}`,
    ];
    return lines.join('\n');
}
