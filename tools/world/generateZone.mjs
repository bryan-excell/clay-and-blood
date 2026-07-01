#!/usr/bin/env node
import {
    buildGreatNorthernRoadStageEntries,
    buildRollingHillsStageEntries,
    buildTheGrottoStageEntries,
    buildTheMeadowsStageEntries,
    buildTheMistyPathStageEntries,
    validateStageDefinition,
} from '../../packages/shared/src/index.js';
import { printStageSummary } from './lib/asciiMap.mjs';
import { stageToAscii } from './lib/asciiMap.mjs';

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

function printUsage() {
    console.log([
        'Usage: npm run world:generate-zone -- --zone the-meadows --seed meadows-map-01',
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
    let totalIssues = 0;

    const builders = {
        'great-northern-road': buildGreatNorthernRoadStageEntries,
        'the-meadows': buildTheMeadowsStageEntries,
        'the-grotto': buildTheGrottoStageEntries,
        'the-misty-path': buildTheMistyPathStageEntries,
        'rolling-hills': buildRollingHillsStageEntries,
    };
    const buildEntries = builders[zoneId];
    if (!buildEntries) throw new Error(`Unknown zone "${zoneId}"`);
    const entries = buildEntries({ worldSeed: seed });

    for (const [index, entry] of entries.entries()) {
        const { stage } = entry;
        const ascii = stageToAscii(stage, { showArrivals: false });
        const issues = validateStageDefinition(stage);
        totalIssues += issues.length;

        console.log(`// ${'-'.repeat(72)}`);
        console.log(`// ${printStageSummary(stage).replace(/\n/g, '\n// ')}`);
        console.log(`// kind: ${entry.kind}`);
        console.log(`// validation: ${issues.length === 0 ? 'ok' : `${issues.length} issue(s)`}`);
        for (const issue of issues) {
            console.log(`// - ${issue.code}: ${issue.message}`);
        }
        console.log(`const stage${String(index + 1).padStart(2, '0')} = \``);
        console.log(ascii);
        console.log('`;');
        console.log('');
    }

    if (totalIssues > 0) process.exitCode = 1;
}

main();
