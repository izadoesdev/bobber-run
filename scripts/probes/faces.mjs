// A sheet of every story character's portrait (and a few random ones), three frames each.
// Run: node scripts/probes/faces.mjs http://localhost:5173 /tmp/boatlab/faces.png
import { chromium } from '@playwright/test';
const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 1400, height: 1500 }, deviceScaleFactor: 1 })).newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto(process.argv[2] + '?offline'); await p.waitForTimeout(2500);
await p.evaluate(async () => {
  const { lookFor, faceFrames } = await import('/src/ui/faces.tsx');
  const { PACKS } = await import('/src/content/packs/index.ts');
  const { PEOPLE } = await import('/src/story.ts');
  const ppl = [...Object.entries(PEOPLE).map(([id, v]) => ({ ...v, key: id })), ...PACKS.flatMap(pk => pk.characters.map(c => ({ name: c.name, role: c.role, key: c.name + '|' + c.role })))];
  const d = document.createElement('div'); d.id = 'sheet';
  d.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#2a1f17;display:flex;flex-wrap:wrap;gap:6px;padding:8px;overflow:auto;font:11px monospace;color:#f4ead2';
  for (const q of ppl) {
    const L = lookFor(q.name, q.role, q.key), f = faceFrames(L, q.key + 'v2');
    const c = document.createElement('div'); c.style.cssText = `width:150px;text-align:center;background:hsl(${L.hue} 35% 38%);border-radius:8px;padding:4px`;
    c.innerHTML = `<img src="${f[0]}" style="width:120px;image-rendering:pixelated"><div>${q.name}</div><div style="opacity:.7;height:2.4em;overflow:hidden">${q.role}</div>`;
    d.append(c);
  }
  document.body.append(d);
});
await p.waitForTimeout(500);
await p.screenshot({ path: process.argv[3] || '/tmp/boatlab/faces.png' });
console.log(JSON.stringify(errs));
await b.close();
