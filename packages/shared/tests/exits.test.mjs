import assert from 'node:assert/strict';
import {
    TILE_FLOOR,
    TILE_SIZE,
    TILE_WALL,
    getExitApproachDirection,
    getOppositeDirection,
    resolveExitSpawnPosition,
    resolveExitTransition,
    resolvePreferredExitArrivalTile,
} from '../src/index.js';

function makeGrid(w, h, fill = TILE_FLOOR) {
    return Array.from({ length: h }, () => Array.from({ length: w }, () => fill));
}

function testOppositeDirection() {
    assert.equal(getOppositeDirection('north'), 'south');
    assert.equal(getOppositeDirection('east'), 'west');
    assert.equal(getOppositeDirection('south'), 'north');
    assert.equal(getOppositeDirection('west'), 'east');
}

function testApproachDirectionTracksEnteredEdge() {
    const approachFromSouth = getExitApproachDirection({
        currentX: 5.5 * TILE_SIZE,
        currentY: 5.5 * TILE_SIZE,
        previousX: 5.5 * TILE_SIZE,
        previousY: 6.5 * TILE_SIZE,
        exitX: 5.5 * TILE_SIZE,
        exitY: 5.5 * TILE_SIZE,
        exitWidth: TILE_SIZE,
        exitHeight: TILE_SIZE,
    });
    assert.equal(approachFromSouth, 'south');

    const approachFromWest = getExitApproachDirection({
        currentX: 5.5 * TILE_SIZE,
        currentY: 5.5 * TILE_SIZE,
        previousX: 4.5 * TILE_SIZE,
        previousY: 5.5 * TILE_SIZE,
        exitX: 5.5 * TILE_SIZE,
        exitY: 5.5 * TILE_SIZE,
        exitWidth: TILE_SIZE,
        exitHeight: TILE_SIZE,
    });
    assert.equal(approachFromWest, 'west');
}

function testStaticTransitionUsesExitIdConnections() {
    const resolved = resolveExitTransition('town-square', 2, 'west-gate');
    assert.equal(resolved.toLevelId, 'west-gate');
    assert.equal(resolved.toExitId, 'east-road');
    assert.equal(resolved.arrivalDirection, 'west');
}

function testSpawnUsesOppositeOfApproachDirection() {
    const spawn = resolveExitSpawnPosition({
        toLevelId: 'inn',
        toExitId: 'front-door',
        approachDirection: 'south',
    });
    assert.ok(spawn, 'expected spawn for inn front door');
    assert.equal(spawn.arrivalDirection, 'north');
    assert.equal(spawn.tileX, 5);
    assert.equal(spawn.tileY, 10);
}

function testPreferredArrivalTileFallsBackDeterministically() {
    const grid = makeGrid(7, 7);
    grid[2][3] = TILE_WALL;
    const tile = resolvePreferredExitArrivalTile(grid, { x: 3, y: 3 }, 'north');
    assert.notDeepEqual(tile, { x: 3, y: 2 }, 'blocked preferred tile should not be chosen');
    assert.deepEqual(tile, { x: 4, y: 3 }, 'fallback should prefer clockwise adjacent tile next');
}

function run() {
    testOppositeDirection();
    testApproachDirectionTracksEnteredEdge();
    testStaticTransitionUsesExitIdConnections();
    testSpawnUsesOppositeOfApproachDirection();
    testPreferredArrivalTileFallsBackDeterministically();
    console.log('shared exit tests passed');
}

run();
