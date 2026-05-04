#!/usr/bin/env node
import { validateStageDefinition } from '../../packages/shared/src/index.js';
import { generatePathFirstRoadStage } from './lib/generators/pathFirstRoad.mjs';
import { printStageSummary } from './lib/asciiMap.mjs';
import { createRng, intRange } from './lib/rng.mjs';

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

function parseArgs(argv) {
    const args = {};
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (!arg.startsWith('--')) continue;
        const key = arg.slice(2);
        const next = argv[i + 1];
        if (!next || next.startsWith('--')) {
            args[key] = true;
            continue;
        }
        args[key] = next;
        i++;
    }
    return args;
}

function numberArg(args, key, fallback) {
    if (args[key] === undefined) return fallback;
    const value = Number(args[key]);
    if (!Number.isFinite(value)) throw new Error(`--${key} must be a number`);
    return value;
}

function padStageNumber(index) {
    return String(index + 1).padStart(2, '0');
}

function printUsage() {
    console.log([
        'Usage: npm run world:generate-zone -- --zone great-northern-road --seed gnr-v2 --count 15',
        '',
        'Options:',
        '  --zone <zone-id>',
        '  --seed <seed>',
        '  --count <stage-count>',
        '  --min-width <tiles>',
        '  --max-width <tiles>',
        '  --min-height <tiles>',
        '  --max-height <tiles>',
    ].join('\n'));
}

function main() {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
        printUsage();
        return;
    }

    const zoneId = args.zone ?? 'great-northern-road';
    const seed = args.seed ?? zoneId;
    const count = numberArg(args, 'count', 15);
    const minWidth = numberArg(args, 'min-width', 15);
    const maxWidth = numberArg(args, 'max-width', 72);
    const minHeight = numberArg(args, 'min-height', 15);
    const maxHeight = numberArg(args, 'max-height', 42);
    const rng = createRng(seed);
    let backSide = 'south';
    let totalIssues = 0;

    for (let i = 0; i < count; i++) {
        const stageNumber = padStageNumber(i);
        const forwardSide = GREAT_NORTHERN_ROAD_FORWARD_PATTERN[i % GREAT_NORTHERN_ROAD_FORWARD_PATTERN.length];
        const width = intRange(rng, minWidth, maxWidth);
        const height = intRange(rng, minHeight, maxHeight);
        const stageSeed = `${seed}:${stageNumber}:${backSide}-${forwardSide}`;
        const { stage, ascii } = generatePathFirstRoadStage({
            id: `${zoneId}::road-${stageNumber}`,
            displayName: `Great Northern Road ${stageNumber}`,
            zoneId,
            seed: stageSeed,
            width,
            height,
            backSide,
            forwardSide,
            wander: 0.22 + rng() * 0.34,
            pathRadius: intRange(rng, 1, 3),
            clearingsMin: 1,
            clearingsMax: intRange(rng, 2, 5),
            tallGrassChance: 0.03 + rng() * 0.08,
            waterChance: rng() < 0.18 ? 0.012 : 0,
        });
        const issues = validateStageDefinition(stage);
        totalIssues += issues.length;

        console.log(`// ${'-'.repeat(72)}`);
        console.log(`// ${printStageSummary(stage).replace(/\n/g, '\n// ')}`);
        console.log(`// validation: ${issues.length === 0 ? 'ok' : `${issues.length} issue(s)`}`);
        for (const issue of issues) {
            console.log(`// - ${issue.code}: ${issue.message}`);
        }
        console.log(`const road${stageNumber} = \``);
        console.log(ascii);
        console.log('`;');
        console.log('');

        backSide = OPPOSITE_SIDE[forwardSide];
    }

    if (totalIssues > 0) process.exitCode = 1;
}

main();
