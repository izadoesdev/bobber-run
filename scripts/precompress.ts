// After `vite build`: write .br (Brotli, quality 11) and .gz copies of the text assets, so Caddy serves them
// precompressed (Caddyfile: file_server precompressed) instead of compressing on the fly at a lower level.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { brotliCompressSync, gzipSync, constants } from 'node:zlib';

const DIST = 'dist', TEXT = /\.(js|css|html|svg|json|txt|webmanifest)$/;
let before = 0, after = 0;
function walk(dir: string): void {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { walk(p); continue; }
    if (!TEXT.test(name)) continue;
    const raw = readFileSync(p);
    const br = brotliCompressSync(raw, { params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: raw.length } });
    const gz = gzipSync(raw, { level: 9 });
    if (br.length < raw.length) writeFileSync(p + '.br', br);
    if (gz.length < raw.length) writeFileSync(p + '.gz', gz);
    before += raw.length; after += Math.min(br.length, raw.length);
  }
}
walk(DIST);
console.log(`precompressed: ${(before / 1024).toFixed(0)} kB of text -> ${(after / 1024).toFixed(0)} kB brotli`);
