import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

/**
 * Bundle budgets, split by what a visitor actually downloads.
 *
 * The previous version of this check summed every `.js` file in dist/assets.
 * That number is dominated by chunks almost nobody fetches — pdf.js, its
 * worker, and mammoth together are ~71% of it, and they load only when
 * someone imports a PDF or DOCX spec. Budgeting the sum meant ordinary
 * features kept colliding with a limit that had nothing to do with their
 * cost, and the limit kept getting raised in response. So it measures four
 * things now, and the headline one is the initial download:
 *
 * - `initial`  — the entry plus its statically imported chunks, i.e. the
 *                bytes every visitor pays before anything renders. This is
 *                the budget that matters, and it is also the one that catches
 *                the mistake this check exists for: a lazy route accidentally
 *                pulled into the eager graph.
 * - `route`    — lazily loaded chunks. Budgeting the *largest single* one
 *                catches a page ballooning without penalising the app for
 *                having many pages.
 * - `optional` — pdf.js and mammoth, fetched only for a PDF/DOCX import.
 *                Reported, never mixed into the headline number.
 * - `deployed` — everything, as a loose backstop against a heavy dependency
 *                landing somewhere unexpected.
 *
 * Which chunks are `initial` is not guessed: dist/index.html names the entry
 * script and lists its static imports as `modulepreload` links, so the split
 * comes from the build itself and stays correct as chunking changes.
 *
 * Baseline (gzip): initial 157,378 B; largest route 18,555 B; deployed
 * 876,751 B. Every run prints these as exact bytes, so re-baselining after a
 * deliberate change is a matter of copying the line it printed.
 */
const INITIAL_GZIP_LIMIT = 173_000;
const LARGEST_ROUTE_GZIP_LIMIT = 24_000;
const DEPLOYED_GZIP_LIMIT = 964_000;

/** Chunks fetched only on-demand for background tasks or PDF/DOCX spec imports. */
const OPTIONAL_CHUNK = /^(?:pdf|mammoth|captureWorker)/;

const DIST = resolve('dist');

const files = (await readdir(resolve(DIST, 'assets')))
  .filter((file) => /\.m?js$/.test(file))
  .sort();
if (files.length === 0) {
  throw new Error('No JavaScript chunks found in dist/assets; run npm run build first.');
}

// The entry script and every chunk the build says it statically imports.
const indexHtml = await readFile(resolve(DIST, 'index.html'), 'utf8');
const entryMatch = indexHtml.match(/<script[^>]+src="([^"]+\.m?js)"/);
if (!entryMatch) {
  throw new Error('Could not identify the entry JavaScript chunk in dist/index.html.');
}
const assetName = (href) => href.replace(/^\.?\/?assets\//, '');
const preloaded = [...indexHtml.matchAll(/<link[^>]+rel="modulepreload"[^>]+href="([^"]+)"/g)].map(
  (match) => assetName(match[1]),
);
const initialNames = new Set([assetName(entryMatch[1]), ...preloaded]);

for (const name of initialNames) {
  if (!files.includes(name)) {
    throw new Error(`dist/index.html references ${name}, which is not in dist/assets.`);
  }
}

const chunks = await Promise.all(
  files.map(async (file) => ({
    file,
    gzipBytes: gzipSync(await readFile(resolve(DIST, 'assets', file))).length,
    kind: initialNames.has(file) ? 'initial' : OPTIONAL_CHUNK.test(file) ? 'optional' : 'route',
  })),
);

const sum = (list) => list.reduce((total, chunk) => total + chunk.gzipBytes, 0);
const of = (kind) => chunks.filter((chunk) => chunk.kind === kind);

const initial = sum(of('initial'));
const optional = sum(of('optional'));
const deployed = sum(chunks);
const largestRoute = of('route').sort((a, b) => b.gzipBytes - a.gzipBytes)[0] ?? {
  file: '(none)',
  gzipBytes: 0,
};

const format = (bytes) => `${(bytes / 1024).toFixed(1)} KiB`;
const budget = (used, limit) => `${format(used).padStart(9)} / ${format(limit).padStart(9)}`;

console.log('Production JavaScript gzip sizes:');
for (const chunk of [...chunks].sort((a, b) => b.gzipBytes - a.gzipBytes)) {
  console.log(`  ${format(chunk.gzipBytes).padStart(10)}  ${chunk.file}  (${chunk.kind})`);
}
console.log();
console.log(
  `Initial download    ${budget(initial, INITIAL_GZIP_LIMIT)}  (entry + ${preloaded.length} preloaded)`,
);
console.log(
  `Largest route chunk ${budget(largestRoute.gzipBytes, LARGEST_ROUTE_GZIP_LIMIT)}  (${largestRoute.file})`,
);
console.log(
  `Optional imports    ${format(optional).padStart(9)}              (only for PDF/DOCX spec import)`,
);
console.log(`Deployed total      ${budget(deployed, DEPLOYED_GZIP_LIMIT)}`);
console.log();
console.log(
  `Exact gzip bytes: initial ${initial}; largest route ${largestRoute.gzipBytes}; deployed ${deployed}.`,
);

const failures = [];
if (initial > INITIAL_GZIP_LIMIT) {
  failures.push(
    `the initial download is ${format(initial)} (limit ${format(INITIAL_GZIP_LIMIT)}) — check whether a lazy route was pulled into the eager graph`,
  );
}
if (largestRoute.gzipBytes > LARGEST_ROUTE_GZIP_LIMIT) {
  failures.push(
    `${largestRoute.file} is ${format(largestRoute.gzipBytes)} (limit ${format(LARGEST_ROUTE_GZIP_LIMIT)})`,
  );
}
if (deployed > DEPLOYED_GZIP_LIMIT) {
  failures.push(`all JavaScript is ${format(deployed)} (limit ${format(DEPLOYED_GZIP_LIMIT)})`);
}
if (failures.length > 0) {
  throw new Error(`Bundle-size budget exceeded: ${failures.join('; ')}.`);
}
