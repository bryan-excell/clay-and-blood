#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    buildGreatNorthernRoadStageEntries,
    buildTheGrottoStageEntries,
    buildTheMeadowsStageEntries,
    validateStageDefinition,
} from '../../packages/shared/src/index.js';
import { stageToAscii } from './lib/asciiMap.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUTPUT_DIR = resolve(__dirname, 'out');

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

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function tileClassForChar(char) {
    switch (char) {
        case '.': return 'tile-floor';
        case '#': return 'tile-wall';
        case '^': return 'tile-void';
        case ',': return 'tile-grass';
        case '~': return 'tile-water';
        case 'A':
        case 'B':
        case 'E':
            return 'tile-exit-marker';
        default:
            return 'tile-unknown';
    }
}

function buildZoneCandidates(args) {
    const zoneId = args.zone ?? 'great-northern-road';
    const seed = args.seed ?? zoneId;
    const builders = {
        'great-northern-road': buildGreatNorthernRoadStageEntries,
        'the-meadows': buildTheMeadowsStageEntries,
        'the-grotto': buildTheGrottoStageEntries,
    };
    const buildEntries = builders[zoneId];
    if (!buildEntries) throw new Error(`Unknown zone "${zoneId}"`);
    const entries = buildEntries({ worldSeed: seed });
    const candidates = entries.map((entry) => ({
        ...entry,
        ascii: stageToAscii(entry.stage, { showArrivals: false }),
        issues: validateStageDefinition(entry.stage),
    }));

    return { zoneId, seed, candidates };
}

function getExitByRole(candidate, role) {
    return candidate.stage.exits.find((exit) => exit.connectionRole === role) ?? null;
}

function vectorForSide(side) {
    switch (side) {
        case 'north': return { dx: 0, dy: -1 };
        case 'east': return { dx: 1, dy: 0 };
        case 'south': return { dx: 0, dy: 1 };
        case 'west': return { dx: -1, dy: 0 };
        default: return { dx: 0, dy: 0 };
    }
}

function placeNextStage(currentPlacement, currentCandidate, nextCandidate) {
    const forwardExit = getExitByRole(currentCandidate, 'forward');
    const backExit = getExitByRole(nextCandidate, 'back');
    const vector = vectorForSide(currentCandidate.forwardSide);
    const targetExitX = currentPlacement.x + forwardExit.x + vector.dx;
    const targetExitY = currentPlacement.y + forwardExit.y + vector.dy;
    return {
        x: targetExitX - backExit.x,
        y: targetExitY - backExit.y,
    };
}

function buildRouteLayout(candidates) {
    if (candidates.every((candidate) => Number.isInteger(candidate.gridX) && Number.isInteger(candidate.gridY))) {
        return buildGridLayout(candidates);
    }

    const placements = [];
    let minX = 0;
    let minY = 0;
    let maxX = 0;
    let maxY = 0;

    for (let i = 0; i < candidates.length; i++) {
        const placement = i === 0
            ? { x: 0, y: 0 }
            : placeNextStage(placements[i - 1], candidates[i - 1], candidates[i]);
        placements.push(placement);
        minX = Math.min(minX, placement.x);
        minY = Math.min(minY, placement.y);
        maxX = Math.max(maxX, placement.x + candidates[i].stage.width);
        maxY = Math.max(maxY, placement.y + candidates[i].stage.height);
    }

    return {
        placements: placements.map((placement) => ({
            x: placement.x - minX,
            y: placement.y - minY,
        })),
        width: maxX - minX,
        height: maxY - minY,
    };
}

function buildGridLayout(candidates) {
    const gap = 4;
    const columnWidths = new Map();
    const rowHeights = new Map();
    for (const candidate of candidates) {
        columnWidths.set(candidate.gridX, Math.max(columnWidths.get(candidate.gridX) ?? 0, candidate.stage.width));
        rowHeights.set(candidate.gridY, Math.max(rowHeights.get(candidate.gridY) ?? 0, candidate.stage.height));
    }

    const columns = [...columnWidths.keys()].sort((a, b) => a - b);
    const rows = [...rowHeights.keys()].sort((a, b) => a - b);
    const xByColumn = new Map();
    const yByRow = new Map();
    let x = 0;
    let y = 0;
    for (const column of columns) {
        xByColumn.set(column, x);
        x += columnWidths.get(column) + gap;
    }
    for (const row of rows) {
        yByRow.set(row, y);
        y += rowHeights.get(row) + gap;
    }

    return {
        placements: candidates.map((candidate) => ({
            x: xByColumn.get(candidate.gridX),
            y: yByRow.get(candidate.gridY),
        })),
        width: Math.max(0, x - gap),
        height: Math.max(0, y - gap),
    };
}

function renderMap(candidate, options = {}) {
    const rows = candidate.ascii.split('\n');
    const exitByPosition = new Map();
    const arrivalByPosition = new Map();
    for (const exit of candidate.stage.exits) {
        exitByPosition.set(`${exit.x},${exit.y}`, exit.id);
        if (exit.arrival) arrivalByPosition.set(`${exit.arrival.x},${exit.arrival.y}`, exit.id);
    }

    const cells = [];
    for (let y = 0; y < rows.length; y++) {
        for (let x = 0; x < rows[y].length; x++) {
            const key = `${x},${y}`;
            const exitId = exitByPosition.get(key);
            const arrivalId = arrivalByPosition.get(key);
            const char = rows[y][x];
            const classes = ['cell', tileClassForChar(char)];
            let label = '';
            if (exitId) {
                classes.push('exit');
                label = 'E';
            } else if (arrivalId) {
                classes.push('arrival');
                label = '@';
            }
            cells.push(`<span class="${classes.join(' ')}" title="${x},${y} ${escapeHtml(exitId ?? arrivalId ?? '')}">${label}</span>`);
        }
    }

    const className = options.className ? `map ${options.className}` : 'map';
    return `<div class="${className}" style="grid-template-columns: repeat(${candidate.stage.width}, var(--tile));">${cells.join('')}</div>`;
}

function renderRouteViewer(candidates) {
    const layout = buildRouteLayout(candidates);
    const routeTilePx = 7;
    const stages = candidates.map((candidate, index) => {
        const placement = layout.placements[index];
        return `
            <section class="route-stage ${escapeHtml(candidate.kind)}" style="left: ${placement.x * routeTilePx}px; top: ${placement.y * routeTilePx}px;">
                <div class="route-label">${index + 1}</div>
                ${renderMap(candidate, { className: 'route-map' })}
            </section>
        `;
    }).join('\n');

    return `
        <section class="route-viewer">
            <div class="route-toolbar">
                <h2>Route Layout</h2>
                <p>${layout.width}x${layout.height} stitched tiles</p>
            </div>
            <div class="route-scroll">
                <div class="route-canvas" style="width: ${layout.width * routeTilePx}px; height: ${layout.height * routeTilePx}px;">
                    ${stages}
                </div>
            </div>
        </section>
    `;
}

function renderHtml({ zoneId, seed, candidates }) {
    const totalIssues = candidates.reduce((sum, candidate) => sum + candidate.issues.length, 0);
    const cards = candidates.map((candidate) => {
        const stage = candidate.stage;
        const issueText = candidate.issues.length === 0
            ? '<span class="ok">valid</span>'
            : `<span class="bad">${candidate.issues.length} issue(s)</span>`;
        const exits = stage.exits
            .map((exit) => `${exit.id} ${exit.side} (${exit.x},${exit.y}) -> (${exit.arrival?.x},${exit.arrival?.y})`)
            .join('<br>');
        return `
            <article class="stage ${escapeHtml(candidate.kind)}">
                <header>
                    <div>
                        <h2>${escapeHtml(stage.id)}</h2>
                        <p>${escapeHtml(candidate.kind)} &middot; ${stage.width}x${stage.height}${Number.isInteger(candidate.gridX) ? ` &middot; grid ${candidate.gridX + 1},${candidate.gridY + 1}` : ` &middot; ${escapeHtml(candidate.backSide)} to ${escapeHtml(candidate.forwardSide)}`}${candidate.pathRadius ? ` &middot; radius ${candidate.pathRadius}` : ''}</p>
                    </div>
                    <strong>${issueText}</strong>
                </header>
                ${renderMap(candidate)}
                <details>
                    <summary>Details</summary>
                    <p>${exits}</p>
                    <pre>${escapeHtml(candidate.ascii)}</pre>
                </details>
            </article>
        `;
    }).join('\n');

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(zoneId)} preview</title>
<style>
    :root {
        --tile: 10px;
        color: #e7e2d5;
        background: #171717;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    body {
        margin: 0;
        padding: 24px;
        background: #171717;
    }
    main {
        max-width: 1480px;
        margin: 0 auto;
    }
    h1, h2, p {
        margin: 0;
    }
    .top {
        display: flex;
        align-items: end;
        justify-content: space-between;
        gap: 16px;
        margin-bottom: 20px;
    }
    .top p, .stage p {
        color: #afa791;
        font-size: 13px;
        line-height: 1.4;
    }
    .grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(330px, 1fr));
        gap: 16px;
    }
    .route-viewer {
        border: 1px solid #3a3831;
        border-radius: 8px;
        background: #20201d;
        margin-bottom: 20px;
        padding: 12px;
    }
    .route-toolbar {
        display: flex;
        align-items: end;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 12px;
    }
    .route-toolbar h2 {
        font-size: 16px;
    }
    .route-scroll {
        overflow: auto;
        max-height: 78vh;
        border: 1px solid #38372f;
        background:
            linear-gradient(#2a2822 1px, transparent 1px),
            linear-gradient(90deg, #2a2822 1px, transparent 1px),
            #151512;
        background-size: 70px 70px;
    }
    .route-canvas {
        position: relative;
        min-width: 100%;
        min-height: 420px;
    }
    .route-stage {
        position: absolute;
        outline: 1px solid rgba(226, 188, 92, 0.7);
        background: rgba(22, 21, 17, 0.78);
        box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.5);
    }
    .route-stage.static-landmark {
        outline-color: rgba(104, 202, 166, 0.95);
    }
    .route-label {
        position: absolute;
        z-index: 2;
        top: 2px;
        left: 2px;
        width: 16px;
        height: 16px;
        border-radius: 999px;
        background: #d6a23e;
        color: #161511;
        font-size: 10px;
        line-height: 16px;
        text-align: center;
        font-weight: 800;
    }
    .route-map {
        --tile: 7px;
        border: 0;
    }
    .stage {
        border: 1px solid #3a3831;
        border-radius: 8px;
        background: #20201d;
        padding: 12px;
        overflow-x: auto;
    }
    .stage.static-landmark {
        border-color: #559b80;
    }
    .stage header {
        display: flex;
        align-items: start;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 12px;
    }
    .stage h2 {
        font-size: 14px;
        font-weight: 650;
    }
    .ok {
        color: #8fd694;
    }
    .bad {
        color: #ff9a7a;
    }
    .map {
        display: grid;
        width: max-content;
        border: 1px solid #38372f;
        background: #11110f;
    }
    .cell {
        position: relative;
        width: var(--tile);
        height: var(--tile);
        box-sizing: border-box;
        border: 1px solid rgba(0, 0, 0, 0.14);
        font-size: 8px;
        line-height: var(--tile);
        text-align: center;
        color: #151515;
        font-weight: 800;
    }
    .tile-void {
        background: #25231d;
        box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.025);
    }
    .tile-floor {
        background: #8a7854;
        box-shadow: inset 0 0 0 1px rgba(228, 210, 160, 0.1);
    }
    .tile-grass {
        background: #667942;
        box-shadow: inset 0 0 0 1px rgba(202, 225, 143, 0.12);
    }
    .tile-water {
        background: #3e8792;
        box-shadow: inset 0 0 0 1px rgba(160, 224, 232, 0.18);
    }
    .tile-wall {
        background: #4a4841;
        box-shadow: inset 0 0 0 1px rgba(218, 206, 172, 0.07);
    }
    .tile-exit-marker {
        background: #c58e34;
    }
    .tile-unknown {
        background: #bc5a5a;
    }
    .exit {
        background: #e2ac3e;
        border-color: rgba(28, 22, 12, 0.4);
    }
    .arrival {
        background: #f0dfaa;
        border-color: rgba(34, 27, 12, 0.35);
    }
    details {
        margin-top: 10px;
        color: #bdb49c;
        font-size: 12px;
    }
    pre {
        overflow-x: auto;
        color: #d6cfbd;
        background: #151512;
        padding: 8px;
        border-radius: 6px;
    }
</style>
</head>
<body>
<main>
    <section class="top">
        <div>
            <h1>${escapeHtml(zoneId)}</h1>
            <p>seed: ${escapeHtml(seed)} &middot; stages: ${candidates.length} &middot; validation: ${totalIssues === 0 ? 'ok' : `${totalIssues} issue(s)`}</p>
        </div>
    </section>
    ${renderRouteViewer(candidates)}
    <section class="grid">
        ${cards}
    </section>
</main>
</body>
</html>`;
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const preview = buildZoneCandidates(args);
    const output = resolve(args.output ?? resolve(DEFAULT_OUTPUT_DIR, `${preview.zoneId}-preview.html`));
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, renderHtml(preview), 'utf8');
    console.log(output);
}

main();
