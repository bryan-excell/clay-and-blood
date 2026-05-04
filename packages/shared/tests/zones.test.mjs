import assert from 'node:assert/strict';
import {
    formatProceduralStageId,
    getAllAuthoredStageDefinitions,
    getAllZoneDefinitions,
    getExitById,
    getExitDestination,
    getStageData,
    getStageDefinition,
    getZoneDefinition,
    getZoneIdFromStageId,
    resolveExitTransition,
} from '../src/index.js';

function testAuthoredStagesHaveValidZones() {
    const zones = new Set(getAllZoneDefinitions().map((zone) => zone.id));
    for (const stage of getAllAuthoredStageDefinitions()) {
        assert.ok(stage.zoneId, `${stage.id} should declare a zoneId`);
        assert.ok(zones.has(stage.zoneId), `${stage.id} should reference a known zone`);
    }
}

function testZoneStageIdsResolveToAuthoredStages() {
    const stages = new Set(getAllAuthoredStageDefinitions().map((stage) => stage.id));
    for (const zone of getAllZoneDefinitions()) {
        for (const stageId of zone.stageIds) {
            assert.ok(stages.has(stageId), `${zone.id} references missing stage ${stageId}`);
            assert.equal(getStageDefinition(stageId).zoneId, zone.id, `${stageId} should belong to ${zone.id}`);
        }
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

function testGreatNorthernRoadRouteChain() {
    const zone = getZoneDefinition('great-northern-road');
    assert.ok(zone, 'expected Great Northern Road zone');
    assert.equal(zone.stageIds.length, 15);

    const townNorth = resolveExitTransition('town-square', 0, 'north-road');
    assert.equal(townNorth.toLevelId, 'northern-gate');
    assert.equal(townNorth.toExitId, 'south-road');

    const gateNorth = resolveExitTransition('northern-gate', 1, 'north-road');
    assert.equal(gateNorth.toLevelId, zone.stageIds[0]);
    assert.equal(gateNorth.toExitId, 'south-road');

    for (let i = 0; i < zone.stageIds.length - 1; i++) {
        const current = zone.stageIds[i];
        const next = zone.stageIds[i + 1];
        const currentForward = getStageDefinition(current).exits.find((exit) => exit.connectionRole === 'forward');
        const nextBack = getStageDefinition(next).exits.find((exit) => exit.connectionRole === 'back');
        assert.ok(currentForward, `${current} should have a forward exit`);
        assert.ok(nextBack, `${next} should have a back exit`);

        const forward = resolveExitTransition(current, currentForward.exitIndex, currentForward.id);
        assert.equal(forward.toLevelId, next);
        assert.equal(forward.toExitId, nextBack.id);

        const back = resolveExitTransition(next, nextBack.exitIndex, nextBack.id);
        assert.equal(back.toLevelId, current);
        assert.equal(back.toExitId, currentForward.id);
    }

    const firstBack = resolveExitTransition(zone.stageIds[0], 0, 'south-road');
    assert.equal(firstBack.toLevelId, 'northern-gate');
    assert.equal(firstBack.toExitId, 'north-road');

    assert.equal(getExitById(zone.stageIds.at(-1), 'north-road'), null, 'final road stage should not leak to dynamic wilds');
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
    testZoneStageIdsResolveToAuthoredStages();
    testZoneMembershipResolvesFromAuthoredStages();
    testProceduralStageIdsCarryZone();
    testDynamicExitDestinationIsZoneAware();
    testGreatNorthernRoadRouteChain();
    testProceduralStagesKeepSolidBoundary();
    console.log('shared zone tests passed');
}

run();
