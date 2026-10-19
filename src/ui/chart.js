// Chart drawing for the minimap and the full sea chart (crisp canvas, real font labels).
import { G, schoolActive, sonarLvl, logged } from '../game.js';
import { SPECIES } from '../econ.js';
import { poisNear, schoolsNear, LAIR } from '../world.js';
import { mapTile, MT, MTP } from '../maptiles.js';

const COL = { port: '#f0cf6a', light: '#efe9dc', wreck: '#dcb074', dim: '#8a949c', ink: '#1b2a33', red: '#c0493a', green: '#8fd48a' };
// draw a chart centred on (cx, cy); `wpp` = world units per canvas pixel
export function drawChart(ctx, w, h, cx, cy, wpp, opt = {}) {
  const t0 = performance.now(), budget = opt.budget ?? 6, dpr = opt.dpr || 1;
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#4f7389'; ctx.fillRect(0, 0, w, h);
  const wx0 = cx - w / 2 * wpp, wy0 = cy - h / 2 * wpp, tpx = MT / wpp;
  for (let ty = Math.floor(wy0 / MT); ty <= Math.floor((wy0 + h * wpp) / MT); ty++) for (let tx = Math.floor(wx0 / MT); tx <= Math.floor((wx0 + w * wpp) / MT); tx++) {
    const c = mapTile(tx, ty, performance.now() - t0 < budget);
    if (c) ctx.drawImage(c, Math.floor((tx * MT - wx0) / wpp), Math.floor((ty * MT - wy0) / wpp), Math.ceil(tpx) + 1, Math.ceil(tpx) + 1);
  }
  const S = (x, y) => [(x - wx0) / wpp, (y - wy0) / wpp], u = dpr;
  if (opt.grid) { ctx.strokeStyle = 'rgba(40,30,20,0.18)'; ctx.lineWidth = u; const step = 512; for (let gx = Math.ceil(wx0 / step) * step; gx < wx0 + w * wpp; gx += step) { const [x] = S(gx, 0); ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); } for (let gy = Math.ceil(wy0 / step) * step; gy < wy0 + h * wpp; gy += step) { const [, y] = S(0, gy); ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); } }
  const pois = poisNear(cx, cy, Math.max(w, h) * wpp * 0.6);
  const sq = (x, y, r, fill) => { ctx.fillStyle = COL.ink; ctx.fillRect(x - r - u, y - r - u, (r + u) * 2, (r + u) * 2); ctx.fillStyle = fill; ctx.fillRect(x - r, y - r, r * 2, r * 2); };
  const s3 = 3 * u;
  const son = opt.sonar ?? sonarLvl();
  if (son >= 1) for (const s of schoolsNear(cx, cy, Math.min(260, Math.max(w, h) * wpp * 0.6))) {
    if (!schoolActive(s) || s.boss) continue; const [x, y] = S(s.x, s.y);
    // shape as well as colour: a filled dot you can catch, a hollow ring your rod can't handle yet
    const weak = SPECIES[s.sp].rod > G.up.rod;
    ctx.beginPath(); ctx.arc(x, y, 2.2 * u, 0, 7); ctx.strokeStyle = COL.ink; ctx.lineWidth = u * 0.8;
    if (weak) { ctx.lineWidth = 2.2 * u; ctx.stroke(); ctx.strokeStyle = son >= 2 ? SPECIES[s.sp].c[1] : '#b4d0d8'; ctx.lineWidth = 1.1 * u; ctx.stroke(); }
    else { ctx.fillStyle = son >= 2 ? SPECIES[s.sp].c[1] : '#b4d0d8'; ctx.fill(); ctx.stroke(); }
  }
  for (const p of pois) {
    const [x, y] = S(p.x, p.y), found = G.found.has(p.id);
    if (!found && !(opt.sextant >= 2)) { sq(x, y, 1.5 * u, COL.dim); continue; }
    if (p.type === 'port') sq(x, y, s3, found ? COL.port : COL.dim);
    else if (p.type === 'light') { ctx.fillStyle = COL.ink; ctx.fillRect(x - 2 * u, y - 4 * u, 4 * u, 8 * u); ctx.fillStyle = found ? COL.light : COL.dim; ctx.fillRect(x - u, y - 3 * u, 2 * u, 6 * u); ctx.fillStyle = COL.red; ctx.fillRect(x - u, y - u, 2 * u, 2 * u); }
    else if (p.type === 'wreck') { ctx.strokeStyle = G.salvaged.has(p.id) ? '#7a5530' : COL.wreck; ctx.lineWidth = 1.6 * u; ctx.beginPath(); ctx.moveTo(x - s3, y - s3); ctx.lineTo(x + s3, y + s3); ctx.moveTo(x + s3, y - s3); ctx.lineTo(x - s3, y + s3); ctx.stroke(); }
  }
  for (const m of G.maps) { const [x, y] = S(m.x, m.y); ctx.strokeStyle = COL.red; ctx.lineWidth = 2.2 * u; ctx.beginPath(); ctx.moveTo(x - 4 * u, y - 4 * u); ctx.lineTo(x + 4 * u, y + 4 * u); ctx.moveTo(x + 4 * u, y - 4 * u); ctx.lineTo(x - 4 * u, y + 4 * u); ctx.stroke(); }
  if (logged() >= 10 || G.log.oldone) { const [x, y] = S(LAIR.x, LAIR.y); ctx.fillStyle = Math.floor(G.t * 2) % 2 ? COL.red : '#efe9dc'; ctx.beginPath(); ctx.arc(x, y, 4.5 * u, 0, 7); ctx.fill(); ctx.fillStyle = COL.ink; ctx.fillRect(x - 2 * u, y - u, 1.4 * u, 1.4 * u); ctx.fillRect(x + 0.6 * u, y - u, 1.4 * u, 1.4 * u); }
  if (G.frenzy) { const [x, y] = S(G.frenzy.s.x, G.frenzy.s.y); star(ctx, x, y, 5 * u, Math.floor(G.t * 4) % 2 ? '#f0cf6a' : '#fff6d6'); }
  if (son >= 3) for (const p of pois) if (p.school && schoolActive(p.school) && SPECIES[p.school.sp].legend) { const [x, y] = S(p.school.x, p.school.y); star(ctx, x, y, 4 * u, '#f0cf6a'); }
  if (opt.labels) {
    ctx.font = `600 ${Math.round(12 * u)}px Pixelify, monospace`; ctx.textBaseline = 'middle';
    for (const p of pois) {
      const found = G.found.has(p.id); if ((!found && !(opt.sextant >= 2)) || p.type === 'wreck') continue;
      const [x, y] = S(p.x, p.y), s = found ? (p.type === 'port' ? p.name : p.name.replace(' Light', '')) : '?';
      ctx.lineWidth = 3 * u; ctx.strokeStyle = 'rgba(27,42,51,0.85)'; ctx.strokeText(s, x + 6 * u, y); ctx.fillStyle = p.type === 'port' ? COL.port : COL.light; ctx.fillText(s, x + 6 * u, y);
    }
    for (const c of G.active) { const q = pois.find(p => p.id === c.to); if (q) { const [x, y] = S(q.x, q.y); ctx.fillStyle = COL.green; ctx.fillText('!', x - 2 * u, y - 9 * u); } }
  }
  // the boat
  const b = G.boat, [bx, by] = S(b.x, b.y), a = b.a;
  ctx.save(); ctx.translate(bx, by); ctx.rotate(a); ctx.beginPath(); ctx.moveTo(6 * u, 0); ctx.lineTo(-4 * u, -3.5 * u); ctx.lineTo(-2 * u, 0); ctx.lineTo(-4 * u, 3.5 * u); ctx.closePath();
  ctx.fillStyle = '#fff6d6'; ctx.fill(); ctx.lineWidth = 1.2 * u; ctx.strokeStyle = COL.ink; ctx.stroke(); ctx.restore();
  return S;
}
export function star(ctx, x, y, r, col) { ctx.fillStyle = col; ctx.beginPath(); for (let i = 0; i < 10; i++) { const a = i / 10 * Math.PI * 2 - Math.PI / 2, rr = i % 2 ? r * 0.45 : r; ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); } ctx.closePath(); ctx.fill(); }
export function compassRose(ctx, x, y, r, ink = 'rgba(58,42,28,0.75)') {
  ctx.save(); ctx.translate(x, y); ctx.strokeStyle = ink; ctx.fillStyle = ink; ctx.lineWidth = Math.max(1, r / 30);
  ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.stroke(); ctx.beginPath(); ctx.arc(0, 0, r * 0.82, 0, 7); ctx.stroke();
  for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2, L = i % 2 ? r * 0.55 : r * 0.95; ctx.beginPath(); ctx.moveTo(Math.cos(a - 0.12) * r * 0.12, Math.sin(a - 0.12) * r * 0.12); ctx.lineTo(Math.cos(a) * L, Math.sin(a) * L); ctx.lineTo(Math.cos(a + 0.12) * r * 0.12, Math.sin(a + 0.12) * r * 0.12); ctx.closePath(); i === 6 ? (ctx.fillStyle = '#a0402e', ctx.fill(), ctx.fillStyle = ink) : ctx.fill(); }
  ctx.font = `${Math.round(r * 0.32)}px Jersey, monospace`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('N', 0, -r * 1.2);
  ctx.restore();
}
// nearest uncharted landmark, for the sextant
export function nearestUncharted() {
  const b = G.boat; let best = null, bd = 1e9;
  for (const p of poisNear(b.x, b.y, 2600)) if (!G.found.has(p.id)) { const d = Math.hypot(p.x - b.x, p.y - b.y); if (d < bd) { bd = d; best = p; } }
  return best ? { p: best, d: bd } : null;
}
