import assert from 'node:assert/strict';
import {
    TILE_FLOOR,
    TILE_WALL,
    getAllAuthoredStageDefinitions,
    getAllZoneDefinitions,
    validateStageDefinition,
    validateWorldDefinitions,
} from '../src/index.js';

function testCurrentWorldDefinitionsValidate() {
    const issues = validateWorldDefinitions({
        stages: getAllAuthoredStageDefinitions(),
        zones: getAllZoneDefinitions(),
    });
    assert.deepEqual(issues, []);
}

function testStageValidationCatchesBlockedArrival() {
    const stage = {
        id: 'test-stage',
        zoneId: 'test-zone',
        width: 3,
        height: 3,
        tiles: [
            [TILE_WALL, TILE_FLOOR, TILE_WALL],
            [TILE_WALL, TILE_WALL, TILE_WALL],
            [TILE_WALL, TILE_FLOOR, TILE_WALL],
        ],
        exits: [
            { id: 'north-door', x: 1, y: 0, exitIndex: 0, side: 'north', arrival: { x: 1, y: 1 } },
        ],
        connectionsByExitId: {},
    };

    const issues = validateStageDefinition(stage);
    assert.ok(issues.some((issue) => issue.code === 'exit.arrival.blocked'));
}

function testWorldValidationCatchesBrokenConnection() {
    const stage = {
        id: 'test-a',
        zoneId: 'test-zone',
        width: 3,
        height: 3,
        tiles: [
            [TILE_WALL, TILE_FLOOR, TILE_WALL],
            [TILE_WALL, TILE_FLOOR, TILE_WALL],
            [TILE_WALL, TILE_FLOOR, TILE_WALL],
        ],
        exits: [
            { id: 'north-door', x: 1, y: 0, exitIndex: 0, side: 'north', arrival: { x: 1, y: 1 } },
        ],
        connectionsByExitId: {
            'north-door': { levelId: 'missing-stage', exitId: 'south-door', exitIndex: 0 },
        },
    };

    const issues = validateWorldDefinitions({
        stages: [stage],
        zones: [{ id: 'test-zone', stageIds: ['test-a'] }],
    });
    assert.ok(issues.some((issue) => issue.code === 'connection.target_stage.missing'));
}

function run() {
    testCurrentWorldDefinitionsValidate();
    testStageValidationCatchesBlockedArrival();
    testWorldValidationCatchesBrokenConnection();
    console.log('shared world validation tests passed');
}

run();
