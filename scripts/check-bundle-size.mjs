import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

// Baseline on main: entry 172,692 bytes; all JS 789,073 bytes.
// These limits leave roughly 10% headroom while catching accidental eager
// imports and large additions anywhere in the statically deployed bundle.
const ENTRY_GZIP_LIMIT = 190_000;
const TOTAL_GZIP_LIMIT = 870_000;
const DIST = resolve('dist');

const files = (await readdir(resolve(DIST, 'assets')))
  .filter((file) => /\.m?js$/.test(file))
  .sort();
if (files.length === 0) throw new Error('No JavaScript chunks found in dist/assets; run npm run build first.');

const indexHtml = await readFile(resolve(DIST, 'index.html'), 'utf8');
const entryMatch = indexHtml.match(/<script[^>]+src="([^"]+\.js)"/);
if (!entryMatch) throw new Error('Could not identify the entry JavaScript chunk in dist/index.html.');
const entryName = entryMatch[1].replace(/^\.\/assets\//, '');

const sizes = await Promise.all(
  files.map(async (file) => ({
    file,
    gzipBytes: gzipSync(await readFile(resolve(DIST, 'assets', file))).length,
  })),
);
const entry = sizes.find(({ file }) => file === entryName);
if (!entry) throw new Error(`Entry chunk ${entryName} was not found in dist/assets.`);
const total = sizes.reduce((sum, chunk) => sum + chunk.gzipBytes, 0);

const format = (bytes) => `${(bytes / 1024).toFixed(1)} KiB`;
console.log('Production JavaScript gzip sizes:');
for (const chunk of [...sizes].sort((a, b) => b.gzipBytes - a.gzipBytes)) {
  console.log(`  ${format(chunk.gzipBytes).padStart(10)}  ${chunk.file}`);
}
console.log(`Entry: ${format(entry.gzipBytes)} / ${format(ENTRY_GZIP_LIMIT)}`);
console.log(`Total: ${format(total)} / ${format(TOTAL_GZIP_LIMIT)}`);

const failures = [];
if (entry.gzipBytes > ENTRY_GZIP_LIMIT) {
  failures.push(`entry chunk is ${format(entry.gzipBytes)} (limit ${format(ENTRY_GZIP_LIMIT)})`);
}
if (total > TOTAL_GZIP_LIMIT) {
  failures.push(`all JavaScript is ${format(total)} (limit ${format(TOTAL_GZIP_LIMIT)})`);
}
if (failures.length > 0) {
  throw new Error(`Bundle-size budget exceeded: ${failures.join('; ')}.`);
}
