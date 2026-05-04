import { createAuthoredStageDefinition } from '../authoredStage.js';
import { TILE_FLOOR } from '../tileRegistry.js';
import { compileRouteChain } from '../topology.js';
import { generatePathFirstRoadStage } from './pathFirstRoad.js';
import { createRng, intRange } from './rng.js';

export const GREAT_NORTHERN_ROAD_ZONE_ID = 'great-northern-road';
export const DEFAULT_WORLD_SEED = 'gnr-map-01';
export const MERCHANT_CARAVAN_STAGE_ID = `${GREAT_NORTHERN_ROAD_ZONE_ID}::merchant-caravan`;

const OPPOSITE_SIDE = Object.freeze({
    north: 'south',
    east: 'west',
    south: 'north',
    west: 'east',
});

const GREAT_NORTHERN_ROAD_FORWARD_PATTERN = Object.freeze([
    'north',
    'north',
    'east',
    'north',
    'north',
    'west',
    'north',
    'north',
    'north',
    'east',
    'north',
    'west',
    'north',
    'north',
    'north',
]);

function padStageNumber(index) {
    return String(index + 1).padStart(2, '0');
}

function getExitByRole(stage, role) {
    return stage.exits.find((exit) => exit.connectionRole === role) ?? null;
}

function withExitConnection(stage, exit, connection) {
    return Object.freeze({
        ...stage,
        connectionsByExitId: Object.freeze({
            ...(stage.connectionsByExitId ?? {}),
            [exit.id]: Object.freeze(connection),
        }),
    });
}

function withoutForwardExit(stage) {
    const forwardExit = getExitByRole(stage, 'forward');
    if (!forwardExit) return stage;

    const tiles = stage.tiles.map((row) => [...row]);
    tiles[forwardExit.y][forwardExit.x] = TILE_FLOOR;
    const connectionsByExitId = { ...(stage.connectionsByExitId ?? {}) };
    delete connectionsByExitId[forwardExit.id];

    return Object.freeze({
        ...stage,
        tiles: Object.freeze(tiles.map((row) => Object.freeze(row))),
        exits: Object.freeze(stage.exits.filter((exit) => exit.id !== forwardExit.id)),
        connectionsByExitId: Object.freeze(connectionsByExitId),
    });
}

function createMerchantCaravanStage() {
    return createAuthoredStageDefinition({
        id: MERCHANT_CARAVAN_STAGE_ID,
        stageSlug: MERCHANT_CARAVAN_STAGE_ID,
        displayName: 'The Merchant Caravan',
        zoneId: GREAT_NORTHERN_ROAD_ZONE_ID,
        tags: Object.freeze(['outdoor', 'road', 'landmark', 'merchant', 'static']),
        floorTile: 'floor_dirt',
        map: `
^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
^^^^^^^^^^^^^^^B^^^^^^^^^^^^^^^^^^^
^^^^^^^^^^^^.......^^^^^^^^^^^^^^^^
^^^^^^^^^^...........^^^^^^^^^^^^^^
^^^^^^^^...............^^^^^^^^^^^^
^^^^^^^....###...###....^^^^^^^^^^^
^^^^^^.....###...###.....^^^^^^^^^^
^^^^^......###...###......^^^^^^^^^
^^^^........................^^^^^^^
^^^........,,,,,,,,,........^^^^^^^
^^^........,,,,,,,,,........^^^^^^^
^^^^........................^^^^^^^
^^^^^......................^^^^^^^^
^^^^^^.........@..........^^^^^^^^^
^^^^^^^^.....@@@@@......^^^^^^^^^^^
^^^^^^^^^^.....@......^^^^^^^^^^^^^
^^^^^^^^^^^^.......^^^^^^^^^^^^^^^^
^^^^^^^^^^^^^^^^A^^^^^^^^^^^^^^^^^^
^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
`,
        exitMarkers: Object.freeze({
            A: Object.freeze({ id: 'south-road', exitIndex: 0, connectionRole: 'back', arrival: Object.freeze({ x: 16, y: 16, facing: 'north' }) }),
            B: Object.freeze({ id: 'north-road', exitIndex: 1, connectionRole: 'forward', arrival: Object.freeze({ x: 15, y: 2, facing: 'south' }) }),
        }),
        tileCharMap: Object.freeze({
            '@': TILE_FLOOR,
        }),
        spawnPoint: Object.freeze({ x: 16, y: 16 }),
    });
}

function getMerchantCaravanInsertAfter(worldSeed) {
    const rng = createRng(`${worldSeed}:${GREAT_NORTHERN_ROAD_ZONE_ID}:merchant-caravan`);
    return intRange(rng, 6, 9);
}

export function buildGreatNorthernRoadStages(options = {}) {
    const worldSeed = options.worldSeed ?? DEFAULT_WORLD_SEED;
    const rng = createRng(worldSeed);
    const stages = [];
    let backSide = 'south';

    for (let index = 0; index < 15; index++) {
        const stageNumber = padStageNumber(index);
        const forwardSide = GREAT_NORTHERN_ROAD_FORWARD_PATTERN[index];
        const width = intRange(rng, 15, 72);
        const height = intRange(rng, 15, 42);
        const stageSeed = `${worldSeed}:${stageNumber}:${backSide}-${forwardSide}`;
        const pathRadius = intRange(rng, 1, 3);
        const { stage, ascii } = generatePathFirstRoadStage({
            id: `${GREAT_NORTHERN_ROAD_ZONE_ID}::road-${stageNumber}`,
            displayName: `Great Northern Road ${stageNumber}`,
            zoneId: GREAT_NORTHERN_ROAD_ZONE_ID,
            seed: stageSeed,
            width,
            height,
            backSide,
            forwardSide,
            wander: 0.22 + rng() * 0.34,
            pathRadius,
            clearingsMin: 1,
            clearingsMax: intRange(rng, 2, 5),
            tallGrassChance: 0.03 + rng() * 0.08,
            waterChance: rng() < 0.18 ? 0.012 : 0,
        });
        stages.push({
            stage,
            ascii,
            kind: 'generated',
            backSide,
            forwardSide,
            pathRadius,
            seed: stageSeed,
        });
        backSide = OPPOSITE_SIDE[forwardSide];
    }

    const insertAfter = getMerchantCaravanInsertAfter(worldSeed);
    const merchantStage = createMerchantCaravanStage();
    stages.splice(insertAfter, 0, {
        stage: merchantStage,
        ascii: null,
        kind: 'static-landmark',
        landmarkId: 'merchant-caravan',
        backSide: 'south',
        forwardSide: 'north',
        seed: `${worldSeed}:merchant-caravan`,
    });

    const compiled = compileRouteChain(stages.map((entry) => entry.stage));
    const firstBackExit = getExitByRole(compiled[0], 'back');
    compiled[0] = withExitConnection(compiled[0], firstBackExit, {
        levelId: 'northern-gate',
        exitId: 'north-road',
        exitIndex: 1,
        arrivalDirection: 'south',
    });
    compiled[compiled.length - 1] = withoutForwardExit(compiled[compiled.length - 1]);

    return compiled;
}

export function buildGreatNorthernRoadStageEntries(options = {}) {
    const worldSeed = options.worldSeed ?? DEFAULT_WORLD_SEED;
    const metadataByStageId = new Map();
    const rng = createRng(worldSeed);
    let backSide = 'south';

    for (let index = 0; index < 15; index++) {
        const stageNumber = padStageNumber(index);
        const forwardSide = GREAT_NORTHERN_ROAD_FORWARD_PATTERN[index];
        const width = intRange(rng, 15, 72);
        const height = intRange(rng, 15, 42);
        const stageSeed = `${worldSeed}:${stageNumber}:${backSide}-${forwardSide}`;
        const pathRadius = intRange(rng, 1, 3);
        metadataByStageId.set(`${GREAT_NORTHERN_ROAD_ZONE_ID}::road-${stageNumber}`, {
            kind: 'generated',
            backSide,
            forwardSide,
            pathRadius,
            seed: stageSeed,
        });
        // Keep metadata RNG consumption in lockstep with buildGreatNorthernRoadStages.
        rng();
        intRange(rng, 2, 5);
        rng();
        rng();
        backSide = OPPOSITE_SIDE[forwardSide];
    }
    metadataByStageId.set(MERCHANT_CARAVAN_STAGE_ID, {
        kind: 'static-landmark',
        landmarkId: 'merchant-caravan',
        backSide: 'south',
        forwardSide: 'north',
        seed: `${worldSeed}:merchant-caravan`,
    });

    const compiled = buildGreatNorthernRoadStages(options);
    return compiled.map((stage) => ({
        stage,
        ...(metadataByStageId.get(stage.id) ?? { kind: 'generated' }),
    }));
}

export function getGreatNorthernRoadStageIds(options = {}) {
    return buildGreatNorthernRoadStages(options).map((stage) => stage.id);
}
