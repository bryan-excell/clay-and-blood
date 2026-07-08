import assert from 'node:assert/strict';
import {
    TILE_EXIT,
    TILE_FLOOR,
    TILE_SHALLOW_WATER,
    TILE_TALL_GRASS,
    getAllAuthoredStageDefinitions,
    getStageData,
    isWalkableTile,
    parseTileMap,
    resolveExitSpawnPosition,
} from '../src/index.js';

const EXPECTED_LUNAVIK_STAGE_SUMMARIES = Object.freeze({
    nativity: Object.freeze({
        width: 20,
        height: 14,
        spawnPoint: Object.freeze({ x: 10, y: 8 }),
        exitIds: Object.freeze(['lunavik-west']),
    }),
    'lunavik-west': Object.freeze({
        width: 32,
        height: 18,
        spawnPoint: Object.freeze({ x: 16, y: 9 }),
        exitIds: Object.freeze(['west-road', 'nativity', 'construct-of-ego', 'coalescence']),
    }),
    'construct-of-ego': Object.freeze({
        width: 24,
        height: 16,
        spawnPoint: Object.freeze({ x: 11, y: 7 }),
        exitIds: Object.freeze(['lunavik-west', 'coalescence']),
    }),
    'coalescence-of-lunavik': Object.freeze({
        width: 28,
        height: 28,
        spawnPoint: Object.freeze({ x: 14, y: 14 }),
        exitIds: Object.freeze([
            'lunavik-west',
            'construct-of-ego',
            'lunavik-north',
            'extrinsic-phylacteries',
            'proliferation-of-talent',
            'lunavik-east',
            'convexity-of-lunavik',
        ]),
    }),
    'lunavik-north': Object.freeze({
        width: 20,
        height: 24,
        spawnPoint: Object.freeze({ x: 9, y: 12 }),
        exitIds: Object.freeze(['coalescence', 'north-road']),
    }),
    'extrinsic-phylacteries': Object.freeze({
        width: 34,
        height: 16,
        spawnPoint: Object.freeze({ x: 16, y: 7 }),
        exitIds: Object.freeze(['coalescence', 'proliferation-of-talent']),
    }),
    'proliferation-of-talent': Object.freeze({
        width: 24,
        height: 18,
        spawnPoint: Object.freeze({ x: 11, y: 8 }),
        exitIds: Object.freeze(['extrinsic-phylacteries', 'coalescence']),
    }),
    'lunavik-east': Object.freeze({
        width: 32,
        height: 14,
        spawnPoint: Object.freeze({ x: 16, y: 6 }),
        exitIds: Object.freeze(['coalescence', 'east-road']),
    }),
    'convexity-of-lunavik': Object.freeze({
        width: 24,
        height: 18,
        spawnPoint: Object.freeze({ x: 12, y: 8 }),
        exitIds: Object.freeze(['coalescence', 'lunavik-south']),
    }),
    'lunavik-south': Object.freeze({
        width: 18,
        height: 24,
        spawnPoint: Object.freeze({ x: 9, y: 12 }),
        exitIds: Object.freeze(['convexity-of-lunavik', 'south-road']),
    }),
});

const REMOVED_LUNAVIK_STAGE_IDS = Object.freeze([
    'town-square',
    'west-gate',
    'inn',
    'shop-1',
    'northern-gate',
]);

function countTiles(stage) {
    const counts = {};
    for (const row of stage.tiles) {
        for (const tile of row) {
            counts[tile] = (counts[tile] ?? 0) + 1;
        }
    }
    return counts;
}

function testParserRejectsRaggedMaps() {
    assert.throws(() => parseTileMap(`
###
##
`), /row 1/);
}

function testParserExtractsExitMarkers() {
    const parsed = parseTileMap(`
##A
#.#
###
`, {
        exitMarkers: {
            A: { id: 'north-door', exitIndex: 2 },
        },
    });
    assert.equal(parsed.width, 3);
    assert.equal(parsed.height, 3);
    assert.equal(parsed.tiles[0][2], TILE_EXIT);
    assert.deepEqual(parsed.exits, [
        { id: 'north-door', exitIndex: 2, x: 2, y: 0, side: 'north' },
    ]);
}

function testLunavikStageSummaries() {
    const stages = Object.fromEntries(getAllAuthoredStageDefinitions().map((stage) => [stage.id, stage]));
    for (const removedStageId of REMOVED_LUNAVIK_STAGE_IDS) {
        assert.equal(stages[removedStageId], undefined, `${removedStageId} should be removed from Lunavik`);
    }

    for (const [stageId, expected] of Object.entries(EXPECTED_LUNAVIK_STAGE_SUMMARIES)) {
        const stage = stages[stageId];
        assert.ok(stage, `missing stage ${stageId}`);
        assert.equal(stage.width, expected.width, `${stageId} width changed`);
        assert.equal(stage.height, expected.height, `${stageId} height changed`);
        assert.deepEqual(stage.spawnPoint, expected.spawnPoint, `${stageId} spawn changed`);
        assert.deepEqual(stage.exits.map((exit) => exit.id), expected.exitIds, `${stageId} exits changed`);

        const tileCounts = countTiles(stage);
        assert.equal(tileCounts[TILE_TALL_GRASS] ?? 0, 0, `${stageId} should not have tall grass yet`);
        assert.equal(tileCounts[TILE_SHALLOW_WATER] ?? 0, 0, `${stageId} should not have water yet`);
        assert.ok((tileCounts[TILE_FLOOR] ?? 0) > 0, `${stageId} should contain walkable floor`);
        assert.equal(tileCounts[TILE_EXIT] ?? 0, expected.exitIds.length, `${stageId} should have one tile per exit`);
    }

    const coalescence = stages['coalescence-of-lunavik'];
    assert.ok(coalescence.width <= 28 && coalescence.height <= 28, 'Coalescence should be about 30% smaller than the old 40x40 town square');
}

function testAuthoredExitArrivalsAreSafe() {
    for (const stage of getAllAuthoredStageDefinitions()) {
        const { grid } = getStageData(stage.id);
        for (const exit of stage.exits) {
            assert.ok(exit.arrival, `${stage.id}:${exit.id} should declare an explicit arrival`);
            const arrivalX = exit.arrival.x;
            const arrivalY = exit.arrival.y;
            assert.ok(Number.isInteger(arrivalX), `${stage.id}:${exit.id} arrival.x should be an integer`);
            assert.ok(Number.isInteger(arrivalY), `${stage.id}:${exit.id} arrival.y should be an integer`);
            assert.notDeepEqual(
                { x: arrivalX, y: arrivalY },
                { x: exit.x, y: exit.y },
                `${stage.id}:${exit.id} arrival should not be on the exit tile`
            );
            assert.ok(grid[arrivalY]?.[arrivalX] != null, `${stage.id}:${exit.id} arrival should be in bounds`);
            assert.ok(isWalkableTile(grid[arrivalY][arrivalX]), `${stage.id}:${exit.id} arrival should be walkable`);
            const tileDistance = Math.abs(arrivalX - exit.x) + Math.abs(arrivalY - exit.y);
            assert.ok(tileDistance >= 1, `${stage.id}:${exit.id} arrival should be clear of the exit tile`);

            const spawn = resolveExitSpawnPosition({
                toLevelId: stage.id,
                toExitId: exit.id,
                arrivalDirection: 'north',
            });
            assert.equal(spawn.tileX, arrivalX, `${stage.id}:${exit.id} spawn tileX should use explicit arrival`);
            assert.equal(spawn.tileY, arrivalY, `${stage.id}:${exit.id} spawn tileY should use explicit arrival`);
            assert.equal(spawn.facing, exit.arrival.facing ?? null, `${stage.id}:${exit.id} spawn facing should be preserved`);
        }
    }
}

function run() {
    testParserRejectsRaggedMaps();
    testParserExtractsExitMarkers();
    testLunavikStageSummaries();
    testAuthoredExitArrivalsAreSafe();
    console.log('shared authored stage tests passed');
}

run();
