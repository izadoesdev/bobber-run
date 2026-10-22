import { chromium } from '@playwright/test';
const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 1300, height: 500 } })).newPage();
await p.goto(process.argv[2] + '?offline'); await p.waitForTimeout(2500);
await p.evaluate(async () => {
  const { lookOf, faceFrames } = await import('/src/ui/faces.tsx');
  const { PEOPLE } = await import('/src/story.ts');
  const d = document.createElement('div'); d.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#2a1f17;display:flex;gap:10px;padding:10px';
  for (const [id, q] of Object.entries(PEOPLE)) { const [L, key] = lookOf(q.name, q.role, id); for (const u of faceFrames(L, key)) { const i = new Image(); i.src = u; i.style.cssText = 'width:80px;height:80px;align-self:flex-start;image-rendering:pixelated;background:#456'; d.append(i); } }
  document.body.append(d);
});
await p.waitForTimeout(400); await p.screenshot({ path: '/tmp/boatlab/cast.png' }); await b.close();
