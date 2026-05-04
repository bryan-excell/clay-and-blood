import assert from 'node:assert/strict';
import {
    TILE_EXIT,
    TILE_FLOOR,
    TILE_SHALLOW_WATER,
    TILE_TALL_GRASS,
    TILE_VOID,
    TILE_WALL,
    getAllAuthoredStageDefinitions,
    getStageData,
    isWalkableTile,
    parseTileMap,
    resolveExitSpawnPosition,
} from '../src/index.js';

const EXPECTED_STAGE_SUMMARIES = Object.freeze({
    'town-square': Object.freeze({
        width: 40,
        height: 40,
        spawnPoint: Object.freeze({ x: 20, y: 20 }),
        exits: Object.freeze([
            Object.freeze({ id: 'north-road', x: 20, y: 0, exitIndex: 0, side: 'north', arrival: Object.freeze({ x: 20, y: 1, facing: 'south' }) }),
            Object.freeze({ id: 'south-road', x: 20, y: 39, exitIndex: 1, side: 'south', arrival: Object.freeze({ x: 20, y: 38, facing: 'north' }) }),
            Object.freeze({ id: 'west-gate', x: 0, y: 20, exitIndex: 2, side: 'west', arrival: Object.freeze({ x: 1, y: 20, facing: 'east' }) }),
            Object.freeze({ id: 'east-road', x: 39, y: 20, exitIndex: 3, side: 'east', arrival: Object.freeze({ x: 38, y: 20, facing: 'west' }) }),
            Object.freeze({ id: 'inn-door', x: 7, y: 9, exitIndex: 4, side: 'interior', arrival: Object.freeze({ x: 7, y: 10, facing: 'south' }) }),
            Object.freeze({ id: 'shop-door', x: 32, y: 9, exitIndex: 5, side: 'interior', arrival: Object.freeze({ x: 32, y: 10, facing: 'south' }) }),
        ]),
        tileCounts: Object.freeze({
            [TILE_FLOOR]: 1298,
            [TILE_WALL]: 198,
            [TILE_EXIT]: 6,
            [TILE_TALL_GRASS]: 54,
            [TILE_SHALLOW_WATER]: 44,
        }),
    }),
    'west-gate': Object.freeze({
        width: 20,
        height: 9,
        spawnPoint: Object.freeze({ x: 10, y: 4 }),
        exits: Object.freeze([
            Object.freeze({ id: 'west-road', x: 0, y: 4, exitIndex: 0, side: 'west', arrival: Object.freeze({ x: 1, y: 4, facing: 'east' }) }),
            Object.freeze({ id: 'east-road', x: 19, y: 4, exitIndex: 1, side: 'east', arrival: Object.freeze({ x: 18, y: 4, facing: 'west' }) }),
        ]),
        tileCounts: Object.freeze({
            [TILE_FLOOR]: 126,
            [TILE_WALL]: 52,
            [TILE_EXIT]: 2,
        }),
    }),
    inn: Object.freeze({
        width: 16,
        height: 12,
        spawnPoint: Object.freeze({ x: 3, y: 9 }),
        exits: Object.freeze([
            Object.freeze({ id: 'front-door', x: 5, y: 11, exitIndex: 0, side: 'south', arrival: Object.freeze({ x: 5, y: 10, facing: 'north' }) }),
        ]),
        tileCounts: Object.freeze({
            [TILE_FLOOR]: 92,
            [TILE_WALL]: 51,
            [TILE_EXIT]: 1,
            [TILE_VOID]: 48,
        }),
    }),
    'shop-1': Object.freeze({
        width: 12,
        height: 10,
        spawnPoint: Object.freeze({ x: 6, y: 8 }),
        exits: Object.freeze([
            Object.freeze({ id: 'front-door', x: 6, y: 9, exitIndex: 0, side: 'south', arrival: Object.freeze({ x: 6, y: 8, facing: 'north' }) }),
        ]),
        tileCounts: Object.freeze({
            [TILE_FLOOR]: 73,
            [TILE_WALL]: 46,
            [TILE_EXIT]: 1,
        }),
    }),
});

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

function testAuthoredStageSummaries() {
    const stages = Object.fromEntries(getAllAuthoredStageDefinitions().map((stage) => [stage.id, stage]));
    for (const [stageId, expected] of Object.entries(EXPECTED_STAGE_SUMMARIES)) {
        const stage = stages[stageId];
        assert.ok(stage, `missing stage ${stageId}`);
        assert.equal(stage.width, expected.width, `${stageId} width changed`);
        assert.equal(stage.height, expected.height, `${stageId} height changed`);
        assert.deepEqual(stage.spawnPoint, expected.spawnPoint, `${stageId} spawn changed`);
        assert.deepEqual(stage.exits, expected.exits, `${stageId} exits changed`);
        assert.deepEqual(countTiles(stage), expected.tileCounts, `${stageId} tile counts changed`);
    }
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
    testAuthoredStageSummaries();
    testAuthoredExitArrivalsAreSafe();
    console.log('shared authored stage tests passed');
}

run();
