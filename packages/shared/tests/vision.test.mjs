import assert from 'node:assert/strict';
import {
    TILE_FLOOR,
    TILE_TALL_GRASS,
    TILE_WALL,
    TILE_SIZE,
    canObserverDetectTarget,
    computeVisibilityPolygon,
    createVisionContext,
    createVisionContextFromProfile,
    hasLineOfSight,
    resolveVisionProfileForKind,
} from '../src/index.js';

function makeGrid(w, h, fill = TILE_FLOOR) {
    return Array.from({ length: h }, () => Array.from({ length: w }, () => fill));
}

function testWallBlocksLineOfSight() {
    const grid = makeGrid(8, 5);
    grid[2][3] = TILE_WALL;
    const visible = hasLineOfSight(
        grid,
        1.5 * TILE_SIZE,
        2.5 * TILE_SIZE,
        5.5 * TILE_SIZE,
        2.5 * TILE_SIZE,
        createVisionContext({ sightRadius: 999 })
    );
    assert.equal(visible, false, 'wall should block line of sight');
}

function testConcealmentBlocksFromOutside() {
    const grid = makeGrid(8, 5);
    grid[2][3] = TILE_TALL_GRASS;
    const result = canObserverDetectTarget(
        grid,
        { x: 1.5 * TILE_SIZE, y: 2.5 * TILE_SIZE },
        { x: 5.5 * TILE_SIZE, y: 2.5 * TILE_SIZE },
        createVisionContext({ sightRadius: 999 })
    );
    assert.equal(result.visible, false, 'outside observer should not see through tall grass');
    assert.equal(result.blockedBy, 'concealment');
}

function testConcealmentDoesNotBlockFromInside() {
    const grid = makeGrid(8, 5);
    grid[2][3] = TILE_TALL_GRASS;
    const visible = hasLineOfSight(
        grid,
        3.5 * TILE_SIZE,
        2.5 * TILE_SIZE,
        5.5 * TILE_SIZE,
        2.5 * TILE_SIZE,
        createVisionContext({ sightRadius: 999 })
    );
    assert.equal(visible, true, 'observer inside grass should see out');
}

function testRangeLimitsDetection() {
    const grid = makeGrid(10, 5);
    const result = canObserverDetectTarget(
        grid,
        { x: 1.5 * TILE_SIZE, y: 2.5 * TILE_SIZE },
        { x: 6.5 * TILE_SIZE, y: 2.5 * TILE_SIZE },
        createVisionContext({ sightRadius: TILE_SIZE * 3 })
    );
    assert.equal(result.visible, false, 'targets beyond sight radius should not be visible');
    assert.equal(result.blockedBy, 'range');
}

function testVisibilityPolygonStopsAtConcealment() {
    const grid = makeGrid(8, 5);
    grid[2][3] = TILE_TALL_GRASS;
    const { polygon } = computeVisibilityPolygon(
        grid,
        1.5 * TILE_SIZE,
        2.5 * TILE_SIZE,
        createVisionContext({ sightRadius: TILE_SIZE * 6, rayCount: 4 })
    );
    assert.ok(polygon[0].x < 4 * TILE_SIZE, `expected eastward ray to stop at grass edge, got ${polygon[0].x}`);
}

function testVisionProfileHelpers() {
    const zombieProfile = resolveVisionProfileForKind('zombie');
    assert.equal(zombieProfile.sightRadius, 140);

    const context = createVisionContextFromProfile(zombieProfile, {
        sightRadiusMultiplier: 1.5,
        extraSightRadius: 10,
    });
    assert.equal(context.effectiveSightRadius, 220);
}

function run() {
    testWallBlocksLineOfSight();
    testConcealmentBlocksFromOutside();
    testConcealmentDoesNotBlockFromInside();
    testRangeLimitsDetection();
    testVisibilityPolygonStopsAtConcealment();
    testVisionProfileHelpers();
    console.log('shared vision tests passed');
}

run();
