import assert from 'node:assert/strict';
import {
    formatProceduralStageId,
    getAllAuthoredStageDefinitions,
    getAllZoneDefinitions,
    getExitDestination,
    getStageData,
    getStageDefinition,
    getZoneDefinition,
    getZoneIdFromStageId,
} from '../src/index.js';

function testAuthoredStagesHaveValidZones() {
    const zones = new Set(getAllZoneDefinitions().map((zone) => zone.id));
    for (const stage of getAllAuthoredStageDefinitions()) {
        assert.ok(stage.zoneId, `${stage.id} should declare a zoneId`);
        assert.ok(zones.has(stage.zoneId), `${stage.id} should reference a known zone`);
    }
}

function testZoneMembershipResolvesFromAuthoredStages() {
    assert.equal(getZoneIdFromStageId('town-square'), 'millhaven');
    assert.equal(getStageDefinition('inn').zoneId, 'millhaven');
    assert.equal(getZoneDefinition('millhaven').displayName, 'Millhaven');
}

function testProceduralStageIdsCarryZone() {
    const stageId = formatProceduralStageId('western-wilds', 'proc-test');
    assert.equal(stageId, 'western-wilds::proc-test');
    assert.equal(getZoneIdFromStageId(stageId), 'western-wilds');
    assert.equal(getStageDefinition(stageId).zoneId, 'western-wilds');
}

function testDynamicExitDestinationIsZoneAware() {
    const destination = getExitDestination('west-gate', 0);
    assert.match(destination.toLevelId, /^western-wilds::proc-[0-9a-f]{6}$/);
    assert.equal(getStageDefinition(destination.toLevelId).zoneId, 'western-wilds');
}

function testProceduralStagesKeepSolidBoundary() {
    const { grid } = getStageData('western-wilds::proc-boundary-test');
    const h = grid.length;
    const w = grid[0].length;
    for (let x = 0; x < w; x++) {
        assert.equal(grid[0][x], 1);
        assert.equal(grid[h - 1][x], 1);
    }
    for (let y = 0; y < h; y++) {
        assert.equal(grid[y][0], 1);
        assert.equal(grid[y][w - 1], 1);
    }
}

function run() {
    testAuthoredStagesHaveValidZones();
    testZoneMembershipResolvesFromAuthoredStages();
    testProceduralStageIdsCarryZone();
    testDynamicExitDestinationIsZoneAware();
    testProceduralStagesKeepSolidBoundary();
    console.log('shared zone tests passed');
}

run();
