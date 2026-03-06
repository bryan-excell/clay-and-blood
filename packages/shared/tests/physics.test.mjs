import assert from 'node:assert/strict';
import {
    TILE_SIZE,
    TILE_WALL,
    TILE_VOID,
    PLAYER_RADIUS,
    stepPlayerKinematics,
} from '../src/index.js';

function makeGrid(w, h, fill = 0) {
    return Array.from({ length: h }, () => Array.from({ length: w }, () => fill));
}

function addBorderWalls(grid) {
    const h = grid.length;
    const w = grid[0].length;
    for (let x = 0; x < w; x++) {
        grid[0][x] = TILE_WALL;
        grid[h - 1][x] = TILE_WALL;
    }
    for (let y = 0; y < h; y++) {
        grid[y][0] = TILE_WALL;
        grid[y][w - 1] = TILE_WALL;
    }
}

function testHighSpeedNoTunnelThroughWall() {
    const grid = makeGrid(12, 12, 0);
    addBorderWalls(grid);
    for (let y = 1; y < 11; y++) grid[y][6] = TILE_WALL; // vertical wall

    const wallLeft = 6 * TILE_SIZE;
    const state = {
        x: wallLeft - PLAYER_RADIUS - 80,
        y: 5.5 * TILE_SIZE,
        dashVx: 3000, // intentionally high
        dashVy: 0,
        dashTimeLeftMs: 50,
    };

    const out = stepPlayerKinematics(state, {}, 50, grid);
    assert.ok(
        out.x <= wallLeft - PLAYER_RADIUS + 0.01,
        `tunneled through wall: x=${out.x}, limit=${wallLeft - PLAYER_RADIUS}`
    );
}

function testCornerDoesNotPassIntoSolidQuadrant() {
    const grid = makeGrid(12, 12, 0);
    addBorderWalls(grid);
    // L-corner at tile (6,6)
    for (let y = 6; y < 11; y++) grid[y][6] = TILE_WALL;
    for (let x = 6; x < 11; x++) grid[6][x] = TILE_WALL;

    const cornerX = 6 * TILE_SIZE;
    const cornerY = 6 * TILE_SIZE;
    const state = {
        x: cornerX - PLAYER_RADIUS - 40,
        y: cornerY - PLAYER_RADIUS - 40,
        dashVx: 2200,
        dashVy: 2200,
        dashTimeLeftMs: 50,
    };

    const out = stepPlayerKinematics(state, {}, 50, grid);
    // Should not end up inside the blocked lower-right quadrant beyond both boundaries.
    assert.ok(
        !(out.x > cornerX - PLAYER_RADIUS + 0.01 && out.y > cornerY - PLAYER_RADIUS + 0.01),
        `passed into corner solid region: x=${out.x}, y=${out.y}`
    );
}

function testVoidTilesAreSolid() {
    const grid = makeGrid(12, 12, 0);
    addBorderWalls(grid);
    for (let y = 1; y < 11; y++) grid[y][6] = TILE_VOID; // void barrier

    const voidLeft = 6 * TILE_SIZE;
    const state = {
        x: voidLeft - PLAYER_RADIUS - 70,
        y: 4.5 * TILE_SIZE,
        dashVx: 2600,
        dashVy: 0,
        dashTimeLeftMs: 50,
    };

    const out = stepPlayerKinematics(state, {}, 50, grid);
    assert.ok(
        out.x <= voidLeft - PLAYER_RADIUS + 0.01,
        `passed through void tile barrier: x=${out.x}`
    );
}

function testNoObstacleMovement() {
    const grid = makeGrid(12, 12, 0);
    addBorderWalls(grid);
    const state = { x: 3 * TILE_SIZE, y: 3 * TILE_SIZE, dashVx: 0, dashVy: 0, dashTimeLeftMs: 0 };

    const out = stepPlayerKinematics(state, { right: true }, 50, grid);
    assert.ok(out.x > state.x, 'expected free movement to advance x');
    assert.equal(out.y, state.y, 'expected no vertical drift on pure horizontal movement');
}

function run() {
    testHighSpeedNoTunnelThroughWall();
    testCornerDoesNotPassIntoSolidQuadrant();
    testVoidTilesAreSolid();
    testNoObstacleMovement();
    console.log('shared physics tests passed');
}

run();

