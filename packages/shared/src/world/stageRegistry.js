import { createAuthoredStageDefinition } from './authoredStage.js';
import { buildGreatNorthernRoadStages } from './generators/greatNorthernRoad.js';
import {
    buildRollingHillsStages,
    getRollingHillsEntryStageId,
} from './generators/rollingHills.js';
import { buildTheGrottoStages } from './generators/theGrotto.js';
import {
    buildTheMeadowsStages,
    getTheMeadowsEntryStageId,
} from './generators/theMeadows.js';
import {
    buildTheMistyPathStages,
    getTheMistyPathEntryStageId,
} from './generators/theMistyPath.js';
import {
    getDefaultZoneId,
    getZoneDefinition,
    getZoneIdFromStageId,
} from './zoneRegistry.js';

function cloneExit(exit) {
    return {
        ...exit,
        arrival: exit?.arrival ? { ...exit.arrival } : undefined,
    };
}

function cloneConnection(connection) {
    if (!connection || typeof connection !== 'object') return null;
    return {
        ...connection,
        arrivalDirection: typeof connection.arrivalDirection === 'string' ? connection.arrivalDirection : null,
    };
}

function cloneTerrainFeature(feature) {
    if (!feature || typeof feature !== 'object') return null;
    return {
        ...feature,
        cells: Array.isArray(feature.cells)
            ? feature.cells
                .filter((cell) => Number.isFinite(cell?.x) && Number.isFinite(cell?.y))
                .map((cell) => ({ x: cell.x, y: cell.y }))
            : undefined,
        rect: feature.rect && typeof feature.rect === 'object'
            ? {
                x: feature.rect.x,
                y: feature.rect.y,
                width: feature.rect.width,
                height: feature.rect.height,
            }
            : null,
        tags: Array.isArray(feature.tags) ? [...feature.tags] : [],
    };
}

function fnv1a32(input) {
    let hash = 0x811c9dc5;
    for (let i = 0; i < input.length; i++) {
        hash ^= input.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash >>> 0;
}

function formatUuidFromWords(a, b, c, d) {
    const p1 = a.toString(16).padStart(8, '0');
    const p2 = ((b >>> 16) & 0xffff).toString(16).padStart(4, '0');
    const rawP3 = (b & 0xffff);
    const p3 = (((rawP3 & 0x0fff) | 0x5000) >>> 0).toString(16).padStart(4, '0');
    const rawP4 = ((c >>> 16) & 0xffff);
    const p4 = (((rawP4 & 0x3fff) | 0x8000) >>> 0).toString(16).padStart(4, '0');
    const p5 = ((((c & 0xffff) << 16) | (d >>> 16)) >>> 0).toString(16).padStart(8, '0') +
        (d & 0xffff).toString(16).padStart(4, '0');
    return `${p1}-${p2}-${p3}-${p4}-${p5}`;
}

export function generateStageUuid(stageId) {
    const normalized = typeof stageId === 'string' && stageId.length > 0 ? stageId : 'unknown-stage';
    return formatUuidFromWords(
        fnv1a32(`stage:${normalized}:a`),
        fnv1a32(`stage:${normalized}:b`),
        fnv1a32(`stage:${normalized}:c`),
        fnv1a32(`stage:${normalized}:d`)
    );
}

function cloneStageDefinition(definition) {
    if (!definition) return null;
    return {
        ...definition,
        stageUuid: typeof definition.stageUuid === 'string'
            ? definition.stageUuid
            : generateStageUuid(definition.id ?? definition.stageSlug ?? 'unknown-stage'),
        stageSlug: definition.stageSlug ?? definition.id ?? null,
        zoneId: definition.zoneId ?? null,
        tags: Array.isArray(definition.tags) ? [...definition.tags] : [],
        tiles: Array.isArray(definition.tiles) ? definition.tiles.map((row) => [...row]) : undefined,
        exits: Array.isArray(definition.exits) ? definition.exits.map(cloneExit) : undefined,
        terrainFeatures: Array.isArray(definition.terrainFeatures)
            ? definition.terrainFeatures.map(cloneTerrainFeature).filter(Boolean)
            : [],
        spawnPoint: definition.spawnPoint ? { ...definition.spawnPoint } : null,
        connectionsByExitId: definition.connectionsByExitId
            ? Object.fromEntries(
                Object.entries(definition.connectionsByExitId)
                    .map(([exitId, connection]) => [exitId, cloneConnection(connection)])
            )
            : {},
        generationConfig: definition.generationConfig ? { ...definition.generationConfig } : undefined,
    };
}

const NORTHERN_GATE_STAGE = createAuthoredStageDefinition({
    id: 'northern-gate',
    stageSlug: 'northern-gate',
    displayName: 'Northern Gate',
    zoneId: 'lunavik',
    tags: Object.freeze(['outdoor', 'gatehouse', 'town']),
    floorTile: 'floor_dirt',
    map: `
###############B###############
#.............................#
#.............................#
#.........####...####.........#
#.........#.........#.........#
#.........#.........#.........#
#.............................#
#.............................#
###############A###############
`,
    exitMarkers: Object.freeze({
        A: Object.freeze({ id: 'south-road', exitIndex: 0, connectionRole: 'back', arrival: Object.freeze({ x: 15, y: 7, facing: 'north' }) }),
        B: Object.freeze({ id: 'north-road', exitIndex: 1, connectionRole: 'forward', arrival: Object.freeze({ x: 15, y: 1, facing: 'south' }) }),
    }),
    spawnPoint: Object.freeze({ x: 15, y: 4 }),
    connectionsByExitId: Object.freeze({
        'south-road': Object.freeze({ levelId: 'town-square', exitId: 'north-road', exitIndex: 0, arrivalDirection: 'south' }),
        'north-road': Object.freeze({ levelId: 'great-northern-road::road-01', exitId: 'south-road', exitIndex: 0, arrivalDirection: 'north' }),
    }),
});

const AUTHORED_STAGE_DEFINITIONS = {
    'town-square': createAuthoredStageDefinition({
        id: 'town-square',
        stageSlug: 'town-square',
        stageUuid: '8e9d3f30-9793-4f6e-99a4-c5ef3e8c6c95',
        displayName: 'Town Square',
        zoneId: 'lunavik',
        tags: Object.freeze(['outdoor', 'hub', 'town']),
        floorTile: 'floor_dirt',
        map: `
####################A###################
#......................................#
#......................................#
#...#######..................#######...#
#...#.....#..................#.....#...#
#...#.....#..................#.....#...#
#...#.....#..................#.....#...#
#...#.....#..................#.....#...#
#...#.....#..................#.....#...#
#...###E###..................###F###...#
#......................................#
#......................................#
#......................................#
#......................................#
#......................................#
#......................................#
#......................................#
#......................................#
#......................................#
#......................................#
C......................................D
#......................................#
#......................................#
#......................................#
#......................................#
#......................................#
#......................................#
#......................................#
#....~~~~~....................,,,,,,...#
#...~~~~~~~..................,,,,,,,,..#
#...~~~~~~~..................,,,,,,,,..#
#..~~~~~~~~.................,,,,,,,,,..#
#..~~~~~~~..................,,,,,,,,,..#
#...~~~~~~...................,,,,,,,,..#
#....~~~~.....................,,,,,,...#
#......................................#
#......................................#
#......................................#
#......................................#
####################B###################
`,
        exitMarkers: Object.freeze({
            A: Object.freeze({ id: 'north-road', exitIndex: 0, arrival: Object.freeze({ x: 20, y: 1, facing: 'south' }) }),
            B: Object.freeze({ id: 'south-road', exitIndex: 1, arrival: Object.freeze({ x: 20, y: 38, facing: 'north' }) }),
            C: Object.freeze({ id: 'west-gate', exitIndex: 2, arrival: Object.freeze({ x: 1, y: 20, facing: 'east' }) }),
            D: Object.freeze({ id: 'east-road', exitIndex: 3, arrival: Object.freeze({ x: 38, y: 20, facing: 'west' }) }),
            E: Object.freeze({ id: 'inn-door', exitIndex: 4, arrival: Object.freeze({ x: 7, y: 10, facing: 'south' }) }),
            F: Object.freeze({ id: 'shop-door', exitIndex: 5, arrival: Object.freeze({ x: 32, y: 10, facing: 'south' }) }),
        }),
        spawnPoint: Object.freeze({ x: 20, y: 20 }),
        connectionsByExitId: Object.freeze({
            'north-road': Object.freeze({ levelId: 'northern-gate', exitId: 'south-road', exitIndex: 0, arrivalDirection: 'north' }),
            'south-road': Object.freeze({ levelId: getTheMistyPathEntryStageId(), exitId: 'lunavik-road', exitIndex: 0, arrivalDirection: 'south' }),
            'west-gate': Object.freeze({ levelId: 'west-gate', exitId: 'east-road', exitIndex: 1, arrivalDirection: 'west' }),
            'east-road': Object.freeze({ levelId: getTheMeadowsEntryStageId(), exitId: 'west-path', exitIndex: 3, arrivalDirection: 'east' }),
            'inn-door': Object.freeze({ levelId: 'inn', exitId: 'front-door', exitIndex: 0, arrivalDirection: 'north' }),
            'shop-door': Object.freeze({ levelId: 'shop-1', exitId: 'front-door', exitIndex: 0, arrivalDirection: 'north' }),
        }),
    }),
    'west-gate': createAuthoredStageDefinition({
        id: 'west-gate',
        stageSlug: 'west-gate',
        stageUuid: '454d9e2f-4639-4b46-b5a2-1be820f21dfe',
        displayName: 'West Gate',
        zoneId: 'lunavik',
        tags: Object.freeze(['outdoor', 'gatehouse']),
        floorTile: 'floor_dirt',
        map: `
####################
#..................#
#..................#
#..................#
A..................B
#..................#
#..................#
#..................#
####################
`,
        exitMarkers: Object.freeze({
            A: Object.freeze({ id: 'west-road', exitIndex: 0, arrival: Object.freeze({ x: 1, y: 4, facing: 'east' }) }),
            B: Object.freeze({ id: 'east-road', exitIndex: 1, arrival: Object.freeze({ x: 18, y: 4, facing: 'west' }) }),
        }),
        spawnPoint: Object.freeze({ x: 10, y: 4 }),
        connectionsByExitId: Object.freeze({
            'west-road': Object.freeze({ levelId: getRollingHillsEntryStageId(), exitId: 'lunavik-road', exitIndex: 1, arrivalDirection: 'west' }),
            'east-road': Object.freeze({ levelId: 'town-square', exitId: 'west-gate', exitIndex: 2, arrivalDirection: 'east' }),
        }),
    }),
    inn: createAuthoredStageDefinition({
        id: 'inn',
        stageSlug: 'inn',
        stageUuid: '8b385533-3fc4-4d45-8c4d-1c800f984f45',
        displayName: 'The Inn',
        zoneId: 'lunavik',
        tags: Object.freeze(['interior', 'town']),
        floorTile: 'floor_dirt',
        map: `
########^^^^^^^^
#......#^^^^^^^^
#......#^^^^^^^^
#......#^^^^^^^^
#......#^^^^^^^^
#......#^^^^^^^^
#......#########
#..............#
#..............#
#..............#
#..............#
#####A##########
`,
        exitMarkers: Object.freeze({
            A: Object.freeze({ id: 'front-door', exitIndex: 0, arrival: Object.freeze({ x: 5, y: 10, facing: 'north' }) }),
        }),
        spawnPoint: Object.freeze({ x: 3, y: 9 }),
        connectionsByExitId: Object.freeze({
            'front-door': Object.freeze({ levelId: 'town-square', exitId: 'inn-door', exitIndex: 4, arrivalDirection: 'south' }),
        }),
    }),
    'shop-1': createAuthoredStageDefinition({
        id: 'shop-1',
        stageSlug: 'shop-1',
        stageUuid: 'bb87d99a-7de5-4a3f-a409-e27baac84176',
        displayName: 'The Shop',
        zoneId: 'lunavik',
        tags: Object.freeze(['interior', 'merchant']),
        floorTile: 'floor_dirt',
        map: `
############
#..........#
#.###.####.#
#..........#
#..........#
#..........#
#..........#
#..........#
#..........#
######A#####
`,
        exitMarkers: Object.freeze({
            A: Object.freeze({ id: 'front-door', exitIndex: 0, arrival: Object.freeze({ x: 6, y: 8, facing: 'north' }) }),
        }),
        spawnPoint: Object.freeze({ x: 6, y: 8 }),
        connectionsByExitId: Object.freeze({
            'front-door': Object.freeze({ levelId: 'town-square', exitId: 'shop-door', exitIndex: 5, arrivalDirection: 'south' }),
        }),
    }),
    'northern-gate': NORTHERN_GATE_STAGE,
    ...Object.fromEntries(buildGreatNorthernRoadStages().map((stage) => [stage.id, stage])),
    ...Object.fromEntries(buildTheMeadowsStages().map((stage) => [stage.id, stage])),
    ...Object.fromEntries(buildTheGrottoStages().map((stage) => [stage.id, stage])),
    ...Object.fromEntries(buildTheMistyPathStages().map((stage) => [stage.id, stage])),
    ...Object.fromEntries(buildRollingHillsStages().map((stage) => [stage.id, stage])),
};

const registry = new Map(
    Object.entries(AUTHORED_STAGE_DEFINITIONS).map(([stageId, definition]) => [stageId, cloneStageDefinition(definition)])
);

export const DEFAULT_STAGE_DEFINITION = Object.freeze({
    kind: 'procedural',
    width: 20,
    height: 20,
    floorTile: 'floor_dirt',
    generator: 'cave',
    generationConfig: Object.freeze({ generator: 'cave' }),
    zoneId: 'western-wilds',
    tags: Object.freeze(['procedural', 'wilds']),
    terrainFeatures: Object.freeze([]),
});

export function getStageDefinition(stageId) {
    const stage = registry.get(stageId);
    if (stage) return cloneStageDefinition(stage);
    const zoneId = getZoneIdFromStageId(stageId) ?? getDefaultZoneId();
    const zone = getZoneDefinition(zoneId);
    const defaultStage = zone?.defaultStage ?? DEFAULT_STAGE_DEFINITION;
    const clonedDefaultStage = cloneStageDefinition(defaultStage);
    return {
        ...clonedDefaultStage,
        id: stageId,
        stageSlug: stageId,
        stageUuid: generateStageUuid(stageId),
        displayName: zone?.displayName ?? 'The Wilds',
        zoneId,
    };
}

export function registerStageDefinition(stageId, definition) {
    if (typeof stageId !== 'string' || !definition || typeof definition !== 'object') return;
    registry.set(stageId, {
        id: stageId,
        ...cloneStageDefinition(definition),
    });
}

export function getAllAuthoredStageDefinitions() {
    return [...registry.values()].map(cloneStageDefinition);
}

export function getLevelDisplayName(stageId) {
    return getStageDefinition(stageId)?.displayName ?? 'The Wilds';
}

export function getExitById(stageId, exitId) {
    const definition = getStageDefinition(stageId);
    if (!Array.isArray(definition?.exits)) return null;
    return definition.exits.find((exit) => exit.id === exitId) ?? null;
}

export function getExitByIndex(stageId, exitIndex) {
    const definition = getStageDefinition(stageId);
    if (!Array.isArray(definition?.exits)) return null;
    return definition.exits.find((exit) => exit.exitIndex === exitIndex) ?? null;
}
