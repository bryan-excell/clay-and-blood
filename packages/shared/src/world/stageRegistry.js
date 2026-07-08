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

const AUTHORED_STAGE_DEFINITIONS = {
    nativity: createAuthoredStageDefinition({
        id: 'nativity',
        stageSlug: 'nativity',
        displayName: 'Nativity',
        zoneId: 'lunavik',
        tags: Object.freeze(['indoor', 'origin', 'town']),
        floorTile: 'floor_dirt',
        map: [
            '^^^^^##########^^^^^',
            '^^^###........###^^^',
            '^^##............##^^',
            '^##..............##^',
            '##................##',
            '#..................#',
            '#..................A',
            '#..................#',
            '##................##',
            '^##..............##^',
            '^^##............##^^',
            '^^^###........###^^^',
            '^^^^^##########^^^^^',
            '^^^^^^^^^^^^^^^^^^^^',
        ].join('\n'),
        exitMarkers: Object.freeze({
            A: Object.freeze({ id: 'lunavik-west', exitIndex: 0, arrival: Object.freeze({ x: 18, y: 6, facing: 'west' }) }),
        }),
        spawnPoint: Object.freeze({ x: 10, y: 8 }),
        connectionsByExitId: Object.freeze({
            'lunavik-west': Object.freeze({ levelId: 'lunavik-west', exitId: 'nativity', exitIndex: 1, arrivalDirection: 'south' }),
        }),
    }),
    'lunavik-west': createAuthoredStageDefinition({
        id: 'lunavik-west',
        stageSlug: 'lunavik-west',
        displayName: 'Lunavik West',
        zoneId: 'lunavik',
        tags: Object.freeze(['outdoor', 'passage', 'town']),
        floorTile: 'floor_dirt',
        map: [
            '^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^',
            '^^^^^^^^^^###########^^^^^^^^^^^',
            '^^^^^^^###...B.....###^^^^^^^^^^',
            '^^^^###...............###^^^^^^^',
            '^^###....................###^^^^',
            '^##.........................##^^',
            '##...........................##^',
            '#.............................##',
            '#..............................#',
            'A..............................D',
            '#..............................#',
            '##.............................#',
            '^##.........................###^',
            '^^###.....................###^^^',
            '^^^^###...............#####^^^^^',
            '^^^^^^#######..C..####^^^^^^^^^^',
            '^^^^^^^^^^^^^^###^^^^^^^^^^^^^^^',
            '^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^',
        ].join('\n'),
        exitMarkers: Object.freeze({
            A: Object.freeze({ id: 'west-road', exitIndex: 0, arrival: Object.freeze({ x: 1, y: 9, facing: 'east' }) }),
            B: Object.freeze({ id: 'nativity', exitIndex: 1, arrival: Object.freeze({ x: 13, y: 3, facing: 'south' }) }),
            C: Object.freeze({ id: 'construct-of-ego', exitIndex: 2, arrival: Object.freeze({ x: 15, y: 14, facing: 'north' }) }),
            D: Object.freeze({ id: 'coalescence', exitIndex: 3, arrival: Object.freeze({ x: 30, y: 9, facing: 'west' }) }),
        }),
        spawnPoint: Object.freeze({ x: 16, y: 9 }),
        connectionsByExitId: Object.freeze({
            'west-road': Object.freeze({ levelId: getRollingHillsEntryStageId(), exitId: 'lunavik-road', exitIndex: 1, arrivalDirection: 'west' }),
            nativity: Object.freeze({ levelId: 'nativity', exitId: 'lunavik-west', exitIndex: 0, arrivalDirection: 'west' }),
            'construct-of-ego': Object.freeze({ levelId: 'construct-of-ego', exitId: 'lunavik-west', exitIndex: 0, arrivalDirection: 'east' }),
            coalescence: Object.freeze({ levelId: 'coalescence-of-lunavik', exitId: 'lunavik-west', exitIndex: 0, arrivalDirection: 'east' }),
        }),
    }),
    'construct-of-ego': createAuthoredStageDefinition({
        id: 'construct-of-ego',
        stageSlug: 'construct-of-ego',
        displayName: 'Construct of Ego',
        zoneId: 'lunavik',
        tags: Object.freeze(['indoor', 'ritual', 'town']),
        floorTile: 'floor_dirt',
        map: [
            '^^^^^^^^########^^^^^^^^',
            '^^^^^###......###^^^^^^^',
            '^^^###..........###^^^^^',
            '^^##..............##^^^^',
            '^##................##^^^',
            '##..................##^^',
            'A......................B',
            '#......................#',
            '#......................#',
            '##...................###',
            '^##.................##^^',
            '^^###.............###^^^',
            '^^^^###.........###^^^^^',
            '^^^^^^###########^^^^^^^',
            '^^^^^^^^^^^^^^^^^^^^^^^^',
            '^^^^^^^^^^^^^^^^^^^^^^^^',
        ].join('\n'),
        exitMarkers: Object.freeze({
            A: Object.freeze({ id: 'lunavik-west', exitIndex: 0, arrival: Object.freeze({ x: 1, y: 6, facing: 'east' }) }),
            B: Object.freeze({ id: 'coalescence', exitIndex: 1, arrival: Object.freeze({ x: 22, y: 6, facing: 'west' }) }),
        }),
        spawnPoint: Object.freeze({ x: 11, y: 7 }),
        connectionsByExitId: Object.freeze({
            'lunavik-west': Object.freeze({ levelId: 'lunavik-west', exitId: 'construct-of-ego', exitIndex: 2, arrivalDirection: 'north' }),
            coalescence: Object.freeze({ levelId: 'coalescence-of-lunavik', exitId: 'construct-of-ego', exitIndex: 1, arrivalDirection: 'east' }),
        }),
    }),
    'coalescence-of-lunavik': createAuthoredStageDefinition({
        id: 'coalescence-of-lunavik',
        stageSlug: 'coalescence-of-lunavik',
        displayName: 'Coalescence of Lunavik',
        zoneId: 'lunavik',
        tags: Object.freeze(['outdoor', 'hub', 'ritual', 'town']),
        floorTile: 'floor_dirt',
        map: [
            '^^^^^^^^^^A^^^^^^^B^^^^^^^^^',
            '^^^^^^####.#######.####^^^^^',
            '^^^^###...............###^^^',
            '^^###...................###^',
            '^##.......................##',
            '##........................##',
            '#..........................#',
            '#..........................C',
            '#..........................#',
            '#..........................#',
            '#..........................#',
            '##........................##',
            '^##......................##^',
            'F..........................#',
            '#..........................D',
            '#..........................#',
            '#..........................#',
            '##........................##',
            '^##......................##^',
            'G..........................#',
            '#..........................#',
            '#..........................#',
            '##........................##',
            '^##......................##^',
            '^^###..................###^^',
            '^^^^###..............###^^^^',
            '^^^^^^#####..E..#####^^^^^^^',
            '^^^^^^^^^^^^^###^^^^^^^^^^^^',
        ].join('\n'),
        exitMarkers: Object.freeze({
            F: Object.freeze({ id: 'lunavik-west', exitIndex: 0, arrival: Object.freeze({ x: 1, y: 13, facing: 'east' }) }),
            G: Object.freeze({ id: 'construct-of-ego', exitIndex: 1, arrival: Object.freeze({ x: 1, y: 19, facing: 'east' }) }),
            A: Object.freeze({ id: 'lunavik-north', exitIndex: 2, arrival: Object.freeze({ x: 10, y: 2, facing: 'south' }) }),
            B: Object.freeze({ id: 'extrinsic-phylacteries', exitIndex: 3, arrival: Object.freeze({ x: 18, y: 2, facing: 'south' }) }),
            C: Object.freeze({ id: 'proliferation-of-talent', exitIndex: 4, arrival: Object.freeze({ x: 26, y: 7, facing: 'west' }) }),
            D: Object.freeze({ id: 'lunavik-east', exitIndex: 5, arrival: Object.freeze({ x: 26, y: 14, facing: 'west' }) }),
            E: Object.freeze({ id: 'convexity-of-lunavik', exitIndex: 6, arrival: Object.freeze({ x: 13, y: 25, facing: 'north' }) }),
        }),
        spawnPoint: Object.freeze({ x: 14, y: 14 }),
        connectionsByExitId: Object.freeze({
            'lunavik-west': Object.freeze({ levelId: 'lunavik-west', exitId: 'coalescence', exitIndex: 3, arrivalDirection: 'west' }),
            'construct-of-ego': Object.freeze({ levelId: 'construct-of-ego', exitId: 'coalescence', exitIndex: 1, arrivalDirection: 'west' }),
            'lunavik-north': Object.freeze({ levelId: 'lunavik-north', exitId: 'coalescence', exitIndex: 0, arrivalDirection: 'north' }),
            'extrinsic-phylacteries': Object.freeze({ levelId: 'extrinsic-phylacteries', exitId: 'coalescence', exitIndex: 0, arrivalDirection: 'north' }),
            'proliferation-of-talent': Object.freeze({ levelId: 'proliferation-of-talent', exitId: 'coalescence', exitIndex: 1, arrivalDirection: 'north' }),
            'lunavik-east': Object.freeze({ levelId: 'lunavik-east', exitId: 'coalescence', exitIndex: 0, arrivalDirection: 'west' }),
            'convexity-of-lunavik': Object.freeze({ levelId: 'convexity-of-lunavik', exitId: 'coalescence', exitIndex: 0, arrivalDirection: 'north' }),
        }),
    }),
    'lunavik-north': createAuthoredStageDefinition({
        id: 'lunavik-north',
        stageSlug: 'lunavik-north',
        displayName: 'Lunavik North',
        zoneId: 'lunavik',
        tags: Object.freeze(['outdoor', 'passage', 'town']),
        floorTile: 'floor_dirt',
        map: [
            '^^^^^^^^A^^^^^^^^^^^',
            '^^^^####.#####^^^^^^',
            '^^^###.........###^^',
            '^^##............##^^',
            '^##..............##^',
            '^#................#^',
            '##................##',
            '#..................#',
            '#..................#',
            '##................##',
            '^##..............##^',
            '^^##............##^^',
            '^^##............##^^',
            '^##..............##^',
            '##................##',
            '#..................#',
            '#..................#',
            '##................##',
            '^##..............##^',
            '^^##............##^^',
            '^^^###........###^^^',
            '^^^^####....####^^^^',
            '^^^^^^###..###^^^^^^',
            '^^^^^^^^^B^^^^^^^^^^',
        ].join('\n'),
        exitMarkers: Object.freeze({
            B: Object.freeze({ id: 'coalescence', exitIndex: 0, arrival: Object.freeze({ x: 9, y: 22, facing: 'north' }) }),
            A: Object.freeze({ id: 'north-road', exitIndex: 1, arrival: Object.freeze({ x: 8, y: 2, facing: 'south' }) }),
        }),
        spawnPoint: Object.freeze({ x: 9, y: 12 }),
        connectionsByExitId: Object.freeze({
            coalescence: Object.freeze({ levelId: 'coalescence-of-lunavik', exitId: 'lunavik-north', exitIndex: 2, arrivalDirection: 'south' }),
            'north-road': Object.freeze({ levelId: 'great-northern-road::road-01', exitId: 'south-road', exitIndex: 0, arrivalDirection: 'north' }),
        }),
    }),
    'extrinsic-phylacteries': createAuthoredStageDefinition({
        id: 'extrinsic-phylacteries',
        stageSlug: 'extrinsic-phylacteries',
        displayName: 'Extrinsic Phylacteries',
        zoneId: 'lunavik',
        tags: Object.freeze(['indoor', 'ritual', 'town']),
        floorTile: 'floor_dirt',
        map: [
            '^^^^^^######################^^^^^^',
            '^^^####....................####^^^',
            '^^##..........................##^^',
            '^##............................##^',
            '##..............................##',
            '#................................#',
            '#................................#',
            '#................................B',
            '#................................#',
            '##..............................##',
            '^##............................##^',
            '^^##..........................##^^',
            '^^^####....................####^^^',
            '^^^^^^#####............#####^^^^^^',
            '^^^^^^^^###....A....###^^^^^^^^^^^',
            '^^^^^^^^^^^^########^^^^^^^^^^^^^^',
        ].join('\n'),
        exitMarkers: Object.freeze({
            A: Object.freeze({ id: 'coalescence', exitIndex: 0, arrival: Object.freeze({ x: 15, y: 13, facing: 'north' }) }),
            B: Object.freeze({ id: 'proliferation-of-talent', exitIndex: 1, arrival: Object.freeze({ x: 32, y: 7, facing: 'west' }) }),
        }),
        spawnPoint: Object.freeze({ x: 16, y: 7 }),
        connectionsByExitId: Object.freeze({
            coalescence: Object.freeze({ levelId: 'coalescence-of-lunavik', exitId: 'extrinsic-phylacteries', exitIndex: 3, arrivalDirection: 'south' }),
            'proliferation-of-talent': Object.freeze({ levelId: 'proliferation-of-talent', exitId: 'extrinsic-phylacteries', exitIndex: 0, arrivalDirection: 'east' }),
        }),
    }),
    'proliferation-of-talent': createAuthoredStageDefinition({
        id: 'proliferation-of-talent',
        stageSlug: 'proliferation-of-talent',
        displayName: 'Proliferation of Talent',
        zoneId: 'lunavik',
        tags: Object.freeze(['indoor', 'ritual', 'town']),
        floorTile: 'floor_dirt',
        map: [
            '^^^^^###########^^^^^^^^',
            '^^^###.........###^^^^^^',
            '^^##.............##^^^^^',
            '^##...............##^^^^',
            '##.................##^^^',
            '#...................##^^',
            '#.....................##',
            'A......................#',
            '#......................#',
            '#......................#',
            '##...................##^',
            '^##.................##^^',
            '^^##...............##^^^',
            '^^^###...........###^^^^',
            '^^^^###.........###^^^^^',
            '^^^^^^####...####^^^^^^^',
            '^^^^^^^^##.B.##^^^^^^^^^',
            '^^^^^^^^^^###^^^^^^^^^^^',
        ].join('\n'),
        exitMarkers: Object.freeze({
            A: Object.freeze({ id: 'extrinsic-phylacteries', exitIndex: 0, arrival: Object.freeze({ x: 1, y: 7, facing: 'east' }) }),
            B: Object.freeze({ id: 'coalescence', exitIndex: 1, arrival: Object.freeze({ x: 11, y: 15, facing: 'north' }) }),
        }),
        spawnPoint: Object.freeze({ x: 11, y: 8 }),
        connectionsByExitId: Object.freeze({
            'extrinsic-phylacteries': Object.freeze({ levelId: 'extrinsic-phylacteries', exitId: 'proliferation-of-talent', exitIndex: 1, arrivalDirection: 'west' }),
            coalescence: Object.freeze({ levelId: 'coalescence-of-lunavik', exitId: 'proliferation-of-talent', exitIndex: 4, arrivalDirection: 'west' }),
        }),
    }),
    'lunavik-east': createAuthoredStageDefinition({
        id: 'lunavik-east',
        stageSlug: 'lunavik-east',
        displayName: 'Lunavik East',
        zoneId: 'lunavik',
        tags: Object.freeze(['outdoor', 'passage', 'town']),
        floorTile: 'floor_dirt',
        map: [
            '^^^^^^####################^^^^^^',
            '^^^####..................####^^^',
            '^^##........................##^^',
            '^##..........................##^',
            '##............................##',
            '#..............................#',
            'A..............................B',
            '#..............................#',
            '##............................##',
            '^##..........................##^',
            '^^##........................##^^',
            '^^^####..................####^^^',
            '^^^^^^####################^^^^^^',
            '^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^',
        ].join('\n'),
        exitMarkers: Object.freeze({
            A: Object.freeze({ id: 'coalescence', exitIndex: 0, arrival: Object.freeze({ x: 1, y: 6, facing: 'east' }) }),
            B: Object.freeze({ id: 'east-road', exitIndex: 1, arrival: Object.freeze({ x: 30, y: 6, facing: 'west' }) }),
        }),
        spawnPoint: Object.freeze({ x: 16, y: 6 }),
        connectionsByExitId: Object.freeze({
            coalescence: Object.freeze({ levelId: 'coalescence-of-lunavik', exitId: 'lunavik-east', exitIndex: 5, arrivalDirection: 'east' }),
            'east-road': Object.freeze({ levelId: getTheMeadowsEntryStageId(), exitId: 'west-path', exitIndex: 3, arrivalDirection: 'east' }),
        }),
    }),
    'convexity-of-lunavik': createAuthoredStageDefinition({
        id: 'convexity-of-lunavik',
        stageSlug: 'convexity-of-lunavik',
        displayName: 'Convexity of Lunavik',
        zoneId: 'lunavik',
        tags: Object.freeze(['outdoor', 'ritual', 'town']),
        floorTile: 'floor_dirt',
        map: [
            '^^^^^^^^^^A^^^^^^^^^^^^^',
            '^^^^^^####.####^^^^^^^^^',
            '^^^^###.........###^^^^^',
            '^^###.............###^^^',
            '^##.................##^^',
            '##...................##^',
            '#......................#',
            '#......................#',
            '##....................##',
            '^##..................##^',
            '^##..................##^',
            '##....................##',
            '#......................#',
            '##....................##',
            '^##..................##^',
            '^^###..............###^^',
            '^^^^####....B...####^^^^',
            '^^^^^^^^^^^^###^^^^^^^^^',
        ].join('\n'),
        exitMarkers: Object.freeze({
            A: Object.freeze({ id: 'coalescence', exitIndex: 0, arrival: Object.freeze({ x: 10, y: 2, facing: 'south' }) }),
            B: Object.freeze({ id: 'lunavik-south', exitIndex: 1, arrival: Object.freeze({ x: 12, y: 15, facing: 'north' }) }),
        }),
        spawnPoint: Object.freeze({ x: 12, y: 8 }),
        connectionsByExitId: Object.freeze({
            coalescence: Object.freeze({ levelId: 'coalescence-of-lunavik', exitId: 'convexity-of-lunavik', exitIndex: 6, arrivalDirection: 'south' }),
            'lunavik-south': Object.freeze({ levelId: 'lunavik-south', exitId: 'convexity-of-lunavik', exitIndex: 0, arrivalDirection: 'south' }),
        }),
    }),
    'lunavik-south': createAuthoredStageDefinition({
        id: 'lunavik-south',
        stageSlug: 'lunavik-south',
        displayName: 'Lunavik South',
        zoneId: 'lunavik',
        tags: Object.freeze(['outdoor', 'passage', 'town']),
        floorTile: 'floor_dirt',
        map: [
            '^^^^^^^^A^^^^^^^^^',
            '^^^^####.#####^^^^',
            '^^^###.......###^^',
            '^^##..........##^^',
            '^##............##^',
            '##..............##',
            '#................#',
            '#................#',
            '##..............##',
            '^##............##^',
            '^^##..........##^^',
            '^^##..........##^^',
            '^##............##^',
            '##..............##',
            '#................#',
            '#................#',
            '##..............##',
            '^##............##^',
            '^^##..........##^^',
            '^^^###......###^^^',
            '^^^^####..####^^^^',
            '^^^^^^##..##^^^^^^',
            '^^^^^^^^#.#^^^^^^^',
            '^^^^^^^^^B^^^^^^^^',
        ].join('\n'),
        exitMarkers: Object.freeze({
            A: Object.freeze({ id: 'convexity-of-lunavik', exitIndex: 0, arrival: Object.freeze({ x: 8, y: 2, facing: 'south' }) }),
            B: Object.freeze({ id: 'south-road', exitIndex: 1, arrival: Object.freeze({ x: 9, y: 22, facing: 'north' }) }),
        }),
        spawnPoint: Object.freeze({ x: 9, y: 12 }),
        connectionsByExitId: Object.freeze({
            'convexity-of-lunavik': Object.freeze({ levelId: 'convexity-of-lunavik', exitId: 'lunavik-south', exitIndex: 1, arrivalDirection: 'north' }),
            'south-road': Object.freeze({ levelId: getTheMistyPathEntryStageId(), exitId: 'lunavik-road', exitIndex: 0, arrivalDirection: 'south' }),
        }),
    }),
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
