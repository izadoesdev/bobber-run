// Render whole pieces of music offline in the browser and write them as WAV files to listen to, with their levels.
// Run: bun run build && bunx vite preview --port 4961, then
//   node scripts/probes/musicwav.mjs http://localhost:4961/ <outdir> <seed>:day|night ...
import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';
const [url, dir, ...specs] = process.argv.slice(2);
const b = await chromium.launch(); const p = await b.newPage();
await p.route(/databuddy\.cc/, r => r.abort());
await p.goto(url + '?offline'); await p.waitForFunction(() => window.BR?.AUDIO, null, { timeout: 60000 });
for (const spec of specs) {
  const [seed, night] = spec.split(':');
  const r = await p.evaluate(async ([seed, night]) => {
    const { piece } = await window.BR.AUDIO.renderMusicOffline(seed, night, 1);
    const { left, right } = await window.BR.AUDIO.renderMusicOffline(seed, night, Math.ceil(piece.length));
    let peak = 0, sum = 0; for (let i = 0; i < left.length; i++) { const v = Math.max(Math.abs(left[i]), Math.abs(right[i])); peak = Math.max(peak, v); sum += left[i] * left[i]; }
    const pcm = new Int16Array(left.length * 2); for (let i = 0; i < left.length; i++) { pcm[2 * i] = Math.max(-1, Math.min(1, left[i])) * 32767; pcm[2 * i + 1] = Math.max(-1, Math.min(1, right[i])) * 32767; }
    const u = new Uint8Array(pcm.buffer); let bin = ''; for (let i = 0; i < u.length; i += 0x8000) bin += String.fromCharCode(...u.subarray(i, i + 0x8000));
    return { style: piece.style, key: piece.key, bpm: piece.bpm, secs: piece.length, notes: piece.events.filter(e => e.kind === 'piano').length, peak, rms: Math.sqrt(sum / left.length), pcm: btoa(bin) };
  }, [Number(seed), night === 'night']);
  const data = Buffer.from(r.pcm, 'base64'), h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(2, 22);
  h.writeUInt32LE(44100, 24); h.writeUInt32LE(44100 * 4, 28); h.writeUInt16LE(4, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40);
  const file = `${dir}/${r.style.toLowerCase()}-${seed}${night === 'night' ? '-night' : ''}.wav`;
  writeFileSync(file, Buffer.concat([h, data]));
  console.log(`${file}: ${r.style}, key ${r.key}, ${r.bpm} bpm, ${r.secs.toFixed(0)} s, ${r.notes} piano notes, peak ${(20 * Math.log10(r.peak)).toFixed(1)} dBFS, rms ${(20 * Math.log10(r.rms)).toFixed(1)} dBFS`);
}
await b.close();
