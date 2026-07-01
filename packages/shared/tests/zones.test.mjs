import assert from 'node:assert/strict';
import {
    formatProceduralStageId,
    getAllAuthoredStageDefinitions,
    getAllZoneDefinitions,
    getExitById,
    getExitDestination,
    getRollingHillsEntryStageId,
    getStageData,
    getStageDefinition,
    getTheGrottoEntryStageId,
    getTheMeadowsEntryStageId,
    getTheMistyPathEntryStageId,
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
    assert.equal(getZoneIdFromStageId('town-square'), 'lunavik');
    assert.equal(getStageDefinition('inn').zoneId, 'lunavik');
    assert.equal(getZoneDefinition('lunavik').displayName, 'Lunavik');
}

function testProceduralStageIdsCarryZone() {
    const stageId = formatProceduralStageId('western-wilds', 'proc-test');
    assert.equal(stageId, 'western-wilds::proc-test');
    assert.equal(getZoneIdFromStageId(stageId), 'western-wilds');
    assert.equal(getStageDefinition(stageId).zoneId, 'western-wilds');
}

function testDynamicExitDestinationIsZoneAware() {
    const destination = getExitDestination('western-wilds::proc-source', 0);
    assert.match(destination.toLevelId, /^western-wilds::proc-[0-9a-f]{6}$/);
    assert.equal(getStageDefinition(destination.toLevelId).zoneId, 'western-wilds');
}

function testGreatNorthernRoadRouteChain() {
    const zone = getZoneDefinition('great-northern-road');
    assert.ok(zone, 'expected Great Northern Road zone');
    assert.equal(zone.stageIds.length, 16);

    const caravanIndex = zone.stageIds.indexOf('great-northern-road::merchant-caravan');
    assert.ok(caravanIndex >= 6 && caravanIndex <= 9, 'merchant caravan should be inserted around road stages 6-9');
    const caravan = getStageDefinition('great-northern-road::merchant-caravan');
    assert.equal(caravan.tags.includes('static'), true, 'merchant caravan should be a static landmark stage');

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

function parseMeadowCoord(stageId) {
    if (stageId === 'the-meadows::a-clearing') return { y: 2, x: 2 };
    const match = /^the-meadows::meadow-r(\d+)c(\d+)$/.exec(stageId);
    return match ? { y: Number(match[1]) - 1, x: Number(match[2]) - 1 } : null;
}

function testTheMeadowsGridTopology() {
    const zone = getZoneDefinition('the-meadows');
    assert.ok(zone, 'expected The Meadows zone');
    assert.equal(zone.displayName, 'The Meadows');
    assert.equal(zone.stageIds.length, 23);
    assert.equal(zone.hubStageId, getTheMeadowsEntryStageId());
    assert.ok(zone.stageIds.includes('the-meadows::a-clearing'));

    const clearing = getStageDefinition('the-meadows::a-clearing');
    assert.equal(clearing.displayName, 'A Clearing');
    assert.equal(clearing.tags.includes('static'), true, 'A Clearing should be a static landmark stage');
    assert.ok(clearing.width < 40 && clearing.height < 30, 'A Clearing should be smaller than generated meadow stages');

    const townEast = resolveExitTransition('town-square', 3, 'east-road');
    assert.equal(townEast.toLevelId, getTheMeadowsEntryStageId());
    assert.equal(townEast.toExitId, 'west-path');

    const entryWest = resolveExitTransition(getTheMeadowsEntryStageId(), 3, 'west-path');
    assert.equal(entryWest.toLevelId, 'town-square');
    assert.equal(entryWest.toExitId, 'east-road');

    const stageIds = new Set(zone.stageIds);
    const idForCoord = (x, y) => (x === 2 && y === 2 ? 'the-meadows::a-clearing' : `the-meadows::meadow-r${y + 1}c${x + 1}`);
    for (const stageId of zone.stageIds) {
        const coord = parseMeadowCoord(stageId);
        assert.ok(coord, `${stageId} should encode a meadow grid coordinate`);
        const stage = getStageDefinition(stageId);
        assert.equal(stage.zoneId, 'the-meadows');

        for (const [exitId, dx, dy] of [
            ['east-path', 1, 0],
            ['south-path', 0, 1],
        ]) {
            const targetStageId = idForCoord(coord.x + dx, coord.y + dy);
            if (!stageIds.has(targetStageId)) continue;
            const exit = stage.exits.find((candidate) => candidate.id === exitId);
            assert.ok(exit, `${stageId} should connect to ${targetStageId}`);
            const transition = resolveExitTransition(stageId, exit.exitIndex, exit.id);
            assert.equal(transition.toLevelId, targetStageId);
        }
    }
}

function testTheGrottoTopology() {
    const zone = getZoneDefinition('the-grotto');
    assert.ok(zone, 'expected The Grotto zone');
    assert.equal(zone.displayName, 'The Grotto');
    assert.equal(zone.stageIds.length, 10);
    assert.equal(zone.hubStageId, getTheGrottoEntryStageId());

    const clearingToGrotto = resolveExitTransition('the-meadows::a-clearing', 4, 'grotto-mouth');
    assert.equal(clearingToGrotto.toLevelId, getTheGrottoEntryStageId());
    assert.equal(clearingToGrotto.toExitId, 'meadow-light');

    const grottoToClearing = resolveExitTransition(getTheGrottoEntryStageId(), 0, 'meadow-light');
    assert.equal(grottoToClearing.toLevelId, 'the-meadows::a-clearing');
    assert.equal(grottoToClearing.toExitId, 'grotto-mouth');

    for (const stageId of zone.stageIds) {
        const stage = getStageDefinition(stageId);
        assert.equal(stage.zoneId, 'the-grotto');
        assert.ok(stage.width <= 27 && stage.height <= 19, `${stageId} should stay compact`);
        assert.ok(stage.exits.length >= 2 && stage.exits.length <= 3, `${stageId} should have 2 or 3 exits`);

        for (const [exitId, connection] of Object.entries(stage.connectionsByExitId)) {
            const exit = stage.exits.find((candidate) => candidate.id === exitId);
            assert.ok(exit, `${stageId} should have exit ${exitId}`);
            if (connection.levelId === 'the-meadows::a-clearing') continue;
            assert.ok(zone.stageIds.includes(connection.levelId), `${stageId}:${exitId} should stay in the grotto graph`);
            const target = getStageDefinition(connection.levelId);
            const returnConnection = target.connectionsByExitId?.[connection.exitId];
            assert.equal(returnConnection?.levelId, stageId, `${stageId}:${exitId} should be reciprocated`);
        }
    }
}

function testTheMistyPathTopology() {
    const zone = getZoneDefinition('the-misty-path');
    assert.ok(zone, 'expected The Misty Path zone');
    assert.equal(zone.displayName, 'The Misty Path');
    assert.equal(zone.stageIds.length, 14);
    assert.equal(zone.hubStageId, getTheMistyPathEntryStageId());

    const townSouth = resolveExitTransition('town-square', 1, 'south-road');
    assert.equal(townSouth.toLevelId, getTheMistyPathEntryStageId());
    assert.equal(townSouth.toExitId, 'lunavik-road');

    const pathNorth = resolveExitTransition(getTheMistyPathEntryStageId(), 0, 'lunavik-road');
    assert.equal(pathNorth.toLevelId, 'town-square');
    assert.equal(pathNorth.toExitId, 'south-road');

    let fourExitStages = 0;
    for (const stageId of zone.stageIds) {
        const stage = getStageDefinition(stageId);
        assert.equal(stage.zoneId, 'the-misty-path');
        assert.ok(stage.width >= 25 && stage.width <= 49, `${stageId} should use varied misty path widths`);
        assert.ok(stage.height >= 17 && stage.height <= 33, `${stageId} should use varied misty path heights`);
        assert.ok(stage.exits.length >= 2 && stage.exits.length <= 4, `${stageId} should have 2-4 exits`);
        if (stage.exits.length === 4) fourExitStages++;

        for (const [exitId, connection] of Object.entries(stage.connectionsByExitId)) {
            const exit = stage.exits.find((candidate) => candidate.id === exitId);
            assert.ok(exit, `${stageId} should have exit ${exitId}`);
            if (connection.levelId === 'town-square') continue;
            assert.ok(zone.stageIds.includes(connection.levelId), `${stageId}:${exitId} should stay in the misty path graph`);
            const target = getStageDefinition(connection.levelId);
            const returnConnection = target.connectionsByExitId?.[connection.exitId];
            assert.equal(returnConnection?.levelId, stageId, `${stageId}:${exitId} should be reciprocated`);
        }
    }
    assert.ok(fourExitStages >= 2, 'The Misty Path should have meaningful branching touch points');
}

function testRollingHillsBraidedTopology() {
    const zone = getZoneDefinition('rolling-hills');
    assert.ok(zone, 'expected Rolling Hills zone');
    assert.equal(zone.displayName, 'Rolling Hills');
    assert.equal(zone.stageIds.length, 20);
    assert.equal(zone.hubStageId, getRollingHillsEntryStageId());

    const westGate = resolveExitTransition('west-gate', 0, 'west-road');
    assert.equal(westGate.toLevelId, getRollingHillsEntryStageId());
    assert.equal(westGate.toExitId, 'lunavik-road');

    const entryEast = resolveExitTransition(getRollingHillsEntryStageId(), 1, 'lunavik-road');
    assert.equal(entryEast.toLevelId, 'west-gate');
    assert.equal(entryEast.toExitId, 'west-road');
    assert.ok(
        getStageDefinition(getRollingHillsEntryStageId()).generationConfig.gridX >
            getStageDefinition(zone.stageIds.at(-1)).generationConfig.gridX,
        'Rolling Hills preview should place Lunavik on the east/right end and the west end to the left'
    );

    let splitStages = 0;
    let joinStages = 0;
    for (const stageId of zone.stageIds) {
        const stage = getStageDefinition(stageId);
        assert.equal(stage.zoneId, 'rolling-hills');
        assert.ok(stage.width >= 36 && stage.width <= 84, `${stageId} should use varied long widths`);
        assert.ok(stage.height >= 13 && stage.height <= 29, `${stageId} should use varied hill heights`);
        const expectedMinimumExits = stageId === zone.stageIds.at(-1) ? 1 : 2;
        assert.ok(stage.exits.length >= expectedMinimumExits && stage.exits.length <= 4, `${stageId} should have ${expectedMinimumExits}-4 exits`);

        const outbound = Object.entries(stage.connectionsByExitId)
            .filter(([, connection]) => connection.levelId !== 'west-gate');
        if (outbound.length >= 3) splitStages++;

        const inbound = zone.stageIds.filter((otherId) => {
            if (otherId === stageId) return false;
            const other = getStageDefinition(otherId);
            return Object.values(other.connectionsByExitId).some((connection) => connection.levelId === stageId);
        });
        if (inbound.length >= 3) joinStages++;

        for (const [exitId, connection] of Object.entries(stage.connectionsByExitId)) {
            const exit = stage.exits.find((candidate) => candidate.id === exitId);
            assert.ok(exit, `${stageId} should have exit ${exitId}`);
            if (connection.levelId === 'west-gate') continue;
            assert.ok(zone.stageIds.includes(connection.levelId), `${stageId}:${exitId} should stay in the rolling hills graph`);
            const target = getStageDefinition(connection.levelId);
            const returnConnection = target.connectionsByExitId?.[connection.exitId];
            assert.equal(returnConnection?.levelId, stageId, `${stageId}:${exitId} should be reciprocated`);
        }
    }

    assert.ok(splitStages >= 2, 'Rolling Hills should split in multiple places');
    assert.ok(joinStages >= 1, 'Rolling Hills should rejoin into shared stages');
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
    testTheMeadowsGridTopology();
    testTheGrottoTopology();
    testTheMistyPathTopology();
    testRollingHillsBraidedTopology();
    testProceduralStagesKeepSolidBoundary();
    console.log('shared zone tests passed');
}

run();
