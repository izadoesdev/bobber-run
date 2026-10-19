// DOM UI (Preact + htm). Re-rendered every frame from the live game state; Preact diffs the changes.
// Design system: wood panels frame and navigate, parchment holds documents and details,
// one focus colour, one icon style (voxel renders), sentence case for anything longer than a label.
import { h, render } from 'preact';
import { useRef, useEffect } from 'preact/hooks';
import htm from 'htm';
import { W, H, clamp } from '../config.js';
import { G, logged, portItems, portTabs, setTab, selectable, leavePort, saleValue, hasSave, currentGoal, cap, hpMax, boatDef, sonarLvl, isNight, dayNum, dayFrac, windAngle, sailEfficiency,
  schoolActive, equipment, freshness, fishValue, speedMul, priceAt, lineMax, contractSlots } from '../game.js';
import { SPECIES, BOATS, UPGRADES, PAINTS, SUPPLIES, fmtKg } from '../econ.js';
import { schoolsNear, cellPois, homePort } from '../world.js';
import { WX } from '../weather.js';
import { boatFrame, SHIPPED, NA, PLAIN } from '../models.js';
import { icon, fishIcon } from './icons.js';
import { drawChart, compassRose, nearestUncharted } from './chart.js';
import { ROWS, ACTIONS, SET, boundKey } from '../settings.js';

const html = htm.bind(h);
let root;
export function initUI(el) { root = el; }
export function drawUI() { if (root) render(html`<${App}/>`, root); }

// ---------- primitives ----------
function Canvas({ draw, cls, ...rest }) {
  const ref = useRef();
  useEffect(() => {
    const c = ref.current; if (!c) return;
    const r = c.getBoundingClientRect(), dpr = window.devicePixelRatio || 1, w = Math.max(1, Math.round(r.width * dpr)), hh = Math.max(1, Math.round(r.height * dpr));
    if (c.width !== w || c.height !== hh) { c.width = w; c.height = hh; }
    draw(c.getContext('2d'), w, hh, dpr);
  });
  return html`<canvas ref=${ref} class=${cls} ...${rest}/>`;
}
const Icon = ({ k, src, size = '', cls = '', style }) => html`<img class=${`icon ${size} ${cls}`} src=${src || icon(k)} style=${style} draggable="false" alt=""/>`;
const Fish = ({ sp, size = '', cls = '' }) => html`<${Icon} src=${fishIcon(sp)} size=${size} cls=${cls}/>`;
const Bar = ({ k, tone = '' }) => html`<div class=${'bar ' + tone}><i style=${{ width: clamp(k, 0, 1) * 100 + '%' }}/></div>`;
const Pips = ({ n, of }) => html`<div class="pips" title=${`${n} of ${of}`}>${Array.from({ length: of }, (_, i) => html`<i class=${i < n ? 'on' : ''}/>`)}</div>`;
const money = n => '$' + Math.round(n).toLocaleString('en-US');
const ARROW = { ArrowUp: 0, ArrowRight: 90, ArrowDown: 180, ArrowLeft: 270 };
const KEYN = { ' ': 'Space', Escape: 'Esc', Enter: 'Enter', Tab: 'Tab', Backspace: 'Back', PageUp: 'PgUp', PageDown: 'PgDn', Shift: 'Shift', Control: 'Ctrl', Alt: 'Alt' };
export const keyLabel = k => KEYN[k] || (k.length === 1 ? k.toUpperCase() : k);
// a keycap for a default key, showing the player's own binding, or the gamepad button when a pad is in use
function Key({ k, pad }) {
  if (G.pad && pad) return html`<span class="key pad">${pad}</span>`;
  const b = boundKey(k);
  if (b in ARROW) return html`<span class="key"><svg class="kglyph" viewBox="0 0 10 10"><path d="M5 1.5 8.8 8 1.2 8z" transform=${`rotate(${ARROW[b]} 5 5)`}/></svg></span>`;
  return html`<span class="key">${keyLabel(b)}</span>`;
}
const Hint = ({ k, k2, pad, children }) => html`<span class="hint"><${Key} k=${k} pad=${pad}/>${k2 && !(G.pad && pad) && html`<${Key} k=${k2}/>`}${children}</span>`;
// "[E] Dock at X" -> keycap + text
const PROMPT_KEYS = { SPACE: [' ', 'A'], E: ['e', 'X'] };
const keyed = s => String(s).split(/(\[[^\]]+\])/).map(p => { if (!p.startsWith('[')) return p; const [k, pad] = PROMPT_KEYS[p.slice(1, -1)] || [p.slice(1, -1).toLowerCase()]; return html`<${Key} k=${k} pad=${pad}/>`; });
function boatPreview(id, eq, speed = 6) {
  return (ctx, w, hh) => {
    ctx.clearRect(0, 0, w, hh); ctx.imageSmoothingEnabled = false;
    const f = boatFrame(id, Math.floor(G.t * speed) % NA, SHIPPED, eq), sc = Math.max(1, Math.floor(Math.min(w / f.img.width, hh / (f.img.height * 0.8)) * 0.95));
    const x = w / 2 - f.cx * sc, y = hh * 0.66 - f.cy * sc;
    ctx.globalAlpha = 0.5; ctx.drawImage(f.shadow, x + sc, y + 2 * sc, f.shadow.width * sc, f.shadow.height * sc); ctx.globalAlpha = 1;
    ctx.drawImage(f.img, x, y, f.img.width * sc, f.img.height * sc);
  };
}
const thumbs = new Map();
const boatThumb = id => { if (!thumbs.has(id)) thumbs.set(id, boatFrame(id, Math.floor(NA * 0.58), SHIPPED, PLAIN).img.toDataURL()); return thumbs.get(id); };
const SWATCH = { classic: '#d8d0bf', seafoam: '#5fa38c', crimson: '#a2342c', midnight: '#22304a', sunny: '#d9ae3e', gold: '#c49a32' };
const flashing = id => G.bought && G.bought.id === id && G.t - G.bought.t < 0.9;

// ---------- HUD ----------
const toastIds = new WeakMap(); let toastN = 0;
const TOAST_ICON = { good: 'star', bad: 'warn' };
function Toasts({ low }) {
  return html`<div class=${'toasts' + (low ? ' low' : '')} role="status" aria-live="polite">${(low ? G.toasts.slice(-2) : G.toasts).map(t => {
    if (!toastIds.has(t)) toastIds.set(t, ++toastN);
    return html`<div key=${toastIds.get(t)} class=${`toast chip ${t.kind}` + (t.t < 0.4 ? ' fade' : '')}>${TOAST_ICON[t.kind] && html`<${Icon} k=${TOAST_ICON[t.kind]} size="s"/>`}<span>${t.s}</span></div>`;
  })}</div>`;
}
function Captions() {
  return G.captions.length > 0 && html`<div class="captions">${G.captions.map(c => html`<div class="caption">[${c.s}]</div>`)}</div>`;
}
function Status() {
  const b = G.boat, cp = cap(), hm = hpMax(), k = clamp(b.hp / hm, 0, 1), bait = G.baitSel;
  return html`<div class="hud-status panel">
    <div class="row"><${Icon} k="coin"/><span class="coins">${money(G.coinsShown)}</span>${G.floaters.map((f, i) => html`<span key=${i} class=${'floater ' + f.kind}>${f.s}</span>`)}</div>
    <div class="row gap-t"><${Icon} k="hold" size="s"/><span class="caps">Hold</span><span class=${'num' + (G.hold.length >= cp ? ' bad' : '')}>${G.hold.length}/${cp}</span></div>
    <div class="slots">${Array.from({ length: cp }, (_, i) => html`<div class="slot">${G.hold[i] && html`<img src=${fishIcon(G.hold[i].sp)} alt=""/>`}</div>`)}</div>
    <div class="row gap-t"><${Icon} k="hull" size="s"/><span class="caps">Hull</span><div class="grow"><${Bar} k=${k} tone=${k > 0.5 ? '' : k > 0.25 ? 'warn' : 'bad'}/></div><span class="num">${Math.ceil(b.hp)}</span></div>
    <div class="row gap-t small">
      <${Icon} k=${bait === 'none' ? 'rod' : bait} size="s"/><span>${bait === 'none' ? 'No bait' : `${SUPPLIES[bait].name} ×${G.bait[bait] || 0}`}</span><${Key} k="b" pad="RB"/>
      <span class="grow"/><${Icon} k="chum" size="s"/>${G.bait.chum || 0}<${Key} k="c"/></div>
  </div>`;
}
function Minimap() {
  const un = G.up.sextant > 0 ? nearestUncharted() : null;
  const draw = (ctx, w, hh, dpr) => {
    const b = G.boat; drawChart(ctx, w, hh, b.x, b.y, 300 / w, { dpr, budget: 4, sonar: sonarLvl() });
    if (un) { const a = Math.atan2(un.p.y - b.y, un.p.x - b.x), r = w / 2 - 5 * dpr; ctx.save(); ctx.translate(w / 2 + Math.cos(a) * r, hh / 2 + Math.sin(a) * r); ctx.rotate(a); ctx.fillStyle = '#e07a62'; ctx.strokeStyle = '#1b2a33'; ctx.lineWidth = dpr; ctx.beginPath(); ctx.moveTo(5 * dpr, 0); ctx.lineTo(-4 * dpr, -4 * dpr); ctx.lineTo(-4 * dpr, 4 * dpr); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore(); }
  };
  let best = null, bd = 1e9; const b = G.boat;
  for (const id of G.found) { if (!id.startsWith('port:')) continue; const m = /^port:(-?\d+),(-?\d+)$/.exec(id), p = cellPois(+m[1], +m[2]).find(q => q.id === id); if (!p) continue; const d = Math.hypot(p.x - b.x, p.y - b.y); if (d < bd) { bd = d; best = p; } }
  const night = isNight(), c = dayFrac();
  const sail = boatDef().prop === 'SAIL', eff = sail ? sailEfficiency() : 0;
  const wxIcon = WX.state === 'storm' ? 'storm' : WX.state === 'rain' ? 'rain' : WX.state === 'cloudy' ? 'cloud' : night ? 'moon' : 'sun';
  const part = night ? 'Night' : c > 0.55 ? 'Dusk' : 'Day';
  return html`<div class="mini">
    <div class="ring"><${Canvas} draw=${draw}/><span class="n">N</span></div>
    <div class="chips">
      ${best && html`<div class="chip"><${Icon} k="anchor" size="s"/>${best.name}<span class="gold">${Math.round(bd / 10)} m</span></div>`}
      <div class="chip"><${Icon} k=${wxIcon} size="s"/>Day ${dayNum()}, ${part.toLowerCase()}${WX.state !== 'clear' ? `, ${WX.state}` : ''}</div>
      ${sail && html`<div class="chip"><${Icon} k="arrow" size="s" style=${{ transform: `rotate(${windAngle()}rad)` }}/>Wind <span class=${eff > 0.9 ? 'good' : eff > 0.6 ? '' : 'bad'}>${Math.round(eff * 100)}%</span></div>`}
      ${G.up.radio >= 2 && html`<div class="chip muted"><${Icon} k="radio" size="s"/>${WX.upcoming[0].toUpperCase() + WX.upcoming.slice(1)} in ${Math.floor(WX.next / 60)}:${String(Math.floor(WX.next % 60)).padStart(2, '0')}</div>`}
      ${un && html`<div class="chip"><${Icon} k="sextant" size="s"/>Uncharted <span class="gold">${Math.round(un.d / 10)} m</span></div>`}
    </div></div>`;
}
// line tension: colour plus position, tick marks, a pattern and a word, so it reads without colour
function Reel() {
  const f = G.fish, sp = SPECIES[f.s.sp], lm = lineMax(), t = clamp(f.tension / lm, 0, 1), warn = f.warn || f.jump || f.jumpWarn;
  const state = t > 0.8 ? ['Danger', 'bad'] : t > 0.55 ? ['Strain', 'warn'] : ['Safe', 'good'];
  return html`<div class=${'reel panel' + (warn ? ' alert' : '')}>
    <div class="row"><${Fish} sp=${f.s.sp}/><span class="title">${sp.name}</span><span class="grow"/>
      ${warn ? html`<span class="callout"><${Icon} k="warn" size="s"/>${f.jump || f.jumpWarn ? 'It jumps. Let go!' : 'It runs. Ease off!'}</span>` : SET.reelToggle && html`<span class="muted small">${f.reelOn ? 'Reeling' : 'Paused'}</span>`}</div>
    <div class="meter"><span class="caps">Line</span><div class=${'gauge ' + state[1]}><div class="zone" style=${{ width: (1 - 0.8 / lm) * 100 + '%' }}/><i style=${{ width: t * 100 + '%' }}/><b style=${{ left: '55%' }}/><b style=${{ left: '80%' }}/></div><span class=${'state ' + state[1]}>${state[0]}</span></div>
    <div class="meter"><span class="caps">Catch</span><div class="gauge gold"><i style=${{ width: clamp(f.prog, 0, 1) * 100 + '%' }}/></div><span class="state">${Math.round(clamp(f.prog, 0, 1) * 100)}%</span></div>
  </div>`;
}
function CatchCard() {
  const c = G.card, f = c.fish, sp = SPECIES[f.sp];
  return html`<div class="card paper">
    <${Fish} sp=${f.sp} size="xl"/>
    <div class="grow">
      <div class=${'title' + (sp.legend ? ' gold' : '')}>${sp.name}</div>
      <div class="row">${fmtKg(f.kg)}<span class="gold">${money(f.value)}</span></div>
      <div>${c.first && html`<span class="stamp bad">New species</span>`}${c.record && html`<span class="stamp good">Record</span>`}${f.trophy && html`<span class="stamp gold">Trophy</span>`}${c.perfect && html`<span class="stamp sea">Perfect</span>`}</div>
      ${c.bonus && html`<div class="small gold">${c.bonus}</div>`}
    </div></div>`;
}
function Hud() {
  const gl = currentGoal(), labels = [];
  if (G.up.spyglass >= 2) for (const s of schoolsNear(G.boat.x, G.boat.y, 120)) if (schoolActive(s) && !s.boss) {
    const x = (s.x - G.cam.x) / W * 100, y = (s.y - G.cam.y - 6) / H * 100;
    if (x > 4 && x < 96 && y > 30 && y < 92) labels.push(html`<div class=${'label-world chip' + (SPECIES[s.sp].legend ? ' gold' : '')} style=${{ left: x + '%', top: y + '%' }}>${SPECIES[s.sp].name}</div>`);
  }
  return html`<div>
    ${labels}
    <div class="hud-left"><${Status}/>
      <div class="goal chip"><${Icon} k="star" size="s"/><span>${gl.text}${gl.prog ? html` <span class="muted">${gl.prog[0]}/${gl.prog[1]}</span>` : ''}</span>${gl.reward ? html`<span class="gold">${money(gl.reward)}</span>` : ''}</div>
      ${G.active.map(c => { const n = G.hold.filter(f => f.sp === c.sp).length; return html`<div class="chip"><${Fish} sp=${c.sp} size="s"/>${c.n} ${SPECIES[c.sp].name}<span class="muted">to ${c.toName}</span><span class=${n >= c.n ? 'good' : ''}>${Math.min(n, c.n)}/${c.n}</span></div>`; })}
    </div>
    <${Minimap}/>
    ${G.card && html`<${CatchCard}/>`}
    <div class="bottom-stack">
      <${Captions}/>
      ${G.fish?.st === 'reel' && html`<${Reel}/>`}
      ${G.prompt && html`<div class=${'prompt panel' + (G.fish?.st === 'bite' || G.fish?.warn ? ' hot' : '')}>${keyed(G.prompt)}</div>`}
    </div>
    <div class="hints"><${Hint} k="Tab" pad="View">Ship<//><${Hint} k="m" pad="Y">Chart<//><${Hint} k="l" pad="LB">Log<//><${Hint} k="Escape" pad="Start">Menu<//></div>
  </div>`;
}

// ---------- port ----------
const GREET = ['The harbourmaster tips his cap.', 'Gulls squabble over the pilings.', 'The smell of tar and salt hangs in the air.', 'A fiddle plays somewhere on the quay.', 'Nets dry on every rail.', 'The fishwife sizes up your catch.'];
const hashStr = s => { let h = 7; for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) | 0; return Math.abs(h); };
let hovering = false;
// keeps the cursor row visible in scrolling lists when moved by keyboard or pad
function useScrollTo(sel) {
  const ref = useRef();
  useEffect(() => { if (sel && ref.current && !hovering) ref.current.scrollIntoView({ block: 'nearest' }); }, [sel]);
  return ref;
}
function SetRow({ sel, onEnter, onClick, children, cls = 'item setrow' }) {
  const ref = useScrollTo(sel);
  return html`<div ref=${ref} class=${cls + (sel ? ' sel' : '')} onMouseEnter=${() => { hovering = true; onEnter(); }} onMouseLeave=${() => { hovering = false; }} onClick=${onClick}>${children}</div>`;
}
function RowVisual({ it }) {
  if (it.fish !== undefined) return html`<${Fish} sp=${it.fish}/>`;
  if (it.kind === 'boat') return html`<${Icon} src=${boatThumb(it.boat.id)}/>`;
  if (it.kind === 'paint') return html`<span class="swatch" style=${{ background: SWATCH[it.paint] }}/>`;
  return html`<${Icon} k=${it.icon}/>`;
}
function Row({ it, i }) {
  const sel = G.menu.sel === i, ref = useScrollTo(sel);
  return html`<div ref=${ref} class=${'item' + (sel ? ' sel' : '') + (it.ok ? '' : ' off') + (flashing(it.key) ? ' flash' : '')}
    onMouseEnter=${() => { hovering = true; }} onMouseLeave=${() => { hovering = false; }} onClick=${() => { if (G.menu.sel === i) it.act(); else G.menu.sel = i; }}>
    <${RowVisual} it=${it}/>
    <div class="grow"><div>${it.label}</div>${it.pips ? html`<${Pips} n=${it.pips[0]} of=${it.pips[1]}/>` : it.sub && html`<div class="sub">${it.sub}</div>`}</div>
    <span class=${'price' + (it.cost != null && G.coins < it.cost ? ' short' : '')}>${it.right}</span>
  </div>`;
}
function SellDetail({ p }) {
  const groups = {}; for (const f of G.hold) (groups[f.sp] = groups[f.sp] || []).push(f);
  const best = SPECIES.map((s, i) => ({ s, m: p.mult[i] })).filter(o => G.log[o.s.id]).sort((a, b) => b.m - a.m).slice(0, 3);
  return html`<div class="d-body">
    ${Object.keys(groups).length ? html`<div class="ledger">${Object.entries(groups).map(([sp, fs]) => {
      const each = Math.round(fs.reduce((a, f) => a + fishValue(f), 0) / fs.length * priceAt(p, +sp) * (1 + 0.1 * G.up.cook)), m = p.mult[sp], pct = Math.round((m - 1) * 100);
      return html`<div class="row"><${Fish} sp=${+sp} size="s"/><span class="grow">${SPECIES[sp].name} ×${fs.length}</span><span class=${'trend ' + (pct > 0 ? 'up good' : pct < 0 ? 'down bad' : '')}>${pct > 0 ? '+' : ''}${pct}%</span><span class="gold">${money(each)}</span></div>`;
    })}</div>` : html`<p>Nothing in the hold yet.</p>`}
    ${best.length > 0 && html`<p class="muted">This port pays well for ${best.map(o => o.s.name).join(', ')}.</p>`}
  </div>`;
}
function Detail({ p, it }) {
  if (!it) return html`<aside class="detail paper"/>`;
  const visual = it.kind === 'upgrade' ? html`<${Canvas} cls="preview" draw=${boatPreview(G.boatId, equipment())}/>`
    : it.kind === 'boat' ? html`<${Canvas} cls="preview" draw=${boatPreview(it.boat.id, { ...equipment(), paint: G.paint })}/>`
    : it.kind === 'paint' ? html`<${Canvas} cls="preview" draw=${boatPreview(G.boatId, { ...equipment(), paint: it.paint })}/>`
    : it.kind === 'ferry' ? html`<${Canvas} cls="preview chart" draw=${(ctx, w, hh, dpr) => drawChart(ctx, w, hh, (p.x + it.q.x) / 2, (p.y + it.q.y) / 2, Math.max(2, Math.hypot(it.q.x - p.x, it.q.y - p.y) * 1.4 / w), { dpr, labels: true })}/>`
    : it.fish !== undefined ? html`<div class="d-icon"><${Fish} sp=${it.fish} size="xl"/></div>` : html`<div class="d-icon"><${Icon} k=${it.icon} size="xl"/></div>`;
  const max = BOATS[BOATS.length - 1];
  return html`<aside class=${'detail paper' + (flashing(it.key) ? ' flash' : '')}>
    ${visual}
    <h2>${it.kind === 'take' ? `Contract: ${it.label}` : it.label}</h2>
    ${it.kind === 'sell' ? html`<${SellDetail} p=${p}/>` : html`<div class="d-body">
      ${it.kind === 'upgrade' && html`<div class="row"><${Pips} n=${it.pips[0]} of=${it.pips[1]}/><span class="muted">Level ${it.pips[0] + 1} of ${it.pips[1] + 1}</span></div>
        <p><span class="caps">Now</span> ${it.now}</p>${it.what && html`<p><span class="caps">Next</span> <span class="good">${it.what}</span></p>`}<p class="muted small">Fitted gear shows on your boat.</p>`}
      ${it.kind === 'boat' && html`${[['Speed', it.boat.speed / max.speed], ['Hold', it.boat.hold / max.hold, it.boat.hold + ' fish'], ['Hull', it.boat.hp / max.hp, it.boat.hp], ['Turning', it.boat.turn / 1.05]].map(([n, k, v]) => html`<div class="stat"><span class="caps">${n}</span><${Bar} k=${k} tone="gold"/><span class="num">${v || ''}</span></div>`)}<p>${it.boat.what}.</p>`}
      ${it.kind === 'repair' && html`<div class="stat"><span class="caps">Hull</span><${Bar} k=${G.boat.hp / hpMax()}/><span class="num">${G.boat.hp}/${hpMax()}</span></div><p>${it.what}</p>`}
      ${(it.kind === 'supply' || it.kind === 'ferry') && html`<p>${it.what}.</p><p class="muted">${it.sub}.</p>${it.repeat && html`<p class="muted small">Hold the button down to keep buying.</p>`}`}
      ${it.kind === 'take' && html`<p>${it.what}</p>`}
      ${it.kind === 'deliver' && html`<p>${it.sub}.</p>`}
      ${it.kind === 'note' && html`<p>${it.sub}.</p>`}
    </div>`}
    <div class="d-foot">
      ${it.cost != null && html`<span class=${'price big' + (G.coins < it.cost ? ' short' : '')}>${money(it.cost)}</span>`}
      ${it.kind !== 'note' && html`<button class="btn primary" disabled=${!it.ok} onClick=${() => it.act()}>${!it.ok && it.why && it.why.startsWith('Fully') ? 'Maxed' : it.action}${it.ok && html`<${Key} k=" " pad="A"/>`}</button>`}
    </div>
    ${!it.ok && it.why && html`<p class="why">${it.why}</p>`}
  </aside>`;
}
function Port() {
  const p = G.menu.port, tabs = portTabs(p), items = portItems(p), it = selectable(items[G.menu.sel] || {}) ? items[G.menu.sel] : null;
  return html`<div class="screen panel rivets">
    <header class="head"><div><h1>${p.name}</h1><div class="sub">${GREET[hashStr(p.id) % GREET.length]}</div></div>
      <div class="row"><${Icon} k="coin" size="l"/><span class="coins big">${money(G.coinsShown)}</span></div></header>
    <nav class="tabs"><${Key} k="q" pad="LB"/>${tabs.map((t, i) => html`<button class=${'tab' + (i === G.menu.tab ? ' on' : '')} onClick=${() => setTab(i)}><span class="tnum">${i + 1}</span>${t}</button>`)}<${Key} k="e" pad="RB"/></nav>
    <div class="body">
      <div class="list well">${items.map((x, i) => x.kind === 'header' ? html`<div class="list-head caps">${x.label}</div>` : html`<${Row} it=${x} i=${i}/>`)}</div>
      <${Detail} p=${p} it=${it}/>
    </div>
    <footer class="foot"><span class="hints-inline"><${Hint} k="ArrowUp" k2="ArrowDown" pad="D-pad">Choose<//><${Hint} k=" " pad="A">Buy<//><${Hint} k="q" k2="e" pad="LB RB">Switch tab<//></span>
      <button class="btn" onClick=${leavePort}><${Icon} k="anchor" size="s"/>Set off<${Key} k="Escape" pad="B"/></button></footer>
  </div>`;
}

// ---------- chart ----------
let drag = null;
function Chart() {
  const m = G.map, base = m.zoom === 1 ? 2.2 : 4.6;
  const draw = (ctx, w, hh, dpr) => { drawChart(ctx, w, hh, G.boat.x + m.x, G.boat.y + m.y, base / dpr, { dpr, labels: true, grid: true, budget: 10, sextant: G.up.sextant }); compassRose(ctx, w - 60 * dpr, hh - 64 * dpr, 40 * dpr); };
  const hp = homePort();
  return html`<div class="screen paper doc">
    <header class="head"><h1>Sea chart</h1>
      <div class="legend"><span><i class="lg port"/>Port</span><span><i class="lg light"/>Lighthouse</span><span><i class="lg wreck"/>Wreck</span><span><i class="lg treasure"/>Treasure</span><span><${Icon} k="star" size="s"/>Frenzy</span><span><i class="lg unknown"/>Uncharted</span></div></header>
    <div class="chartwrap"><${Canvas} draw=${draw}
      onPointerDown=${e => { drag = [e.clientX, e.clientY]; e.currentTarget.setPointerCapture(e.pointerId); }}
      onPointerMove=${e => { if (!drag) return; m.x -= (e.clientX - drag[0]) * base; m.y -= (e.clientY - drag[1]) * base; drag = [e.clientX, e.clientY]; }}
      onPointerUp=${() => { drag = null; }} onWheel=${e => { m.zoom = e.deltaY > 0 ? 2 : 1; }}/></div>
    <footer class="foot"><span>Home is ${Math.round(Math.hypot(G.boat.x - hp.x, G.boat.y - hp.y) / 10)} m away. Position ${Math.round(G.boat.x / 10)}, ${Math.round(G.boat.y / 10)}.</span>
      <span class="hints-inline"><${Hint} k="ArrowUp" pad="Stick">Pan or drag<//><${Hint} k="z">Zoom or scroll<//><${Hint} k="m" pad="Y">Close<//></span></footer>
  </div>`;
}

// ---------- logbook ----------
const WHEN = { any: 'Any time', day: 'By day', night: 'At night', twilight: 'At dusk or dawn' }, WX_TXT = { any: '', rain: ', in rain', storm: ', in storms' };
const FIGHTS = { steady: 'A steady puller', darter: 'Sudden darts', generic: 'Hard runs', jumper: 'Leaps. Let go mid-air', erratic: 'Erratic', boss: 'Fights in three rounds' };
function Logbook() {
  const sel = clamp(G.logSel || 0, 0, SPECIES.length - 1), s = SPECIES[sel], e = G.log[s.id];
  return html`<div class="screen paper doc flush">
    <div class="journal">
      <div class="page"><header class="head"><h1>Logbook</h1><span class="muted">${logged()} of ${SPECIES.length} species</span></header>
        <div class="lgrid">${SPECIES.map((sp, i) => html`<div class=${'lcell' + (i === sel ? ' sel' : '')} onClick=${() => { G.logSel = i; }}>
          <${Fish} sp=${i} size="l" cls=${G.log[sp.id] ? '' : 'sil'}/>${G.log[sp.id]?.trophy && html`<${Icon} k="star" size="s" cls="corner"/>`}</div>`)}</div>
      </div>
      <div class="page">
        <div class="hero"><${Fish} sp=${sel} cls=${'huge' + (e ? '' : ' sil')}/></div>
        <h2 class=${'center-t' + (s.legend ? ' gold' : '')}>${e ? s.name : 'Unknown species'}</h2>
        <div class="center-t">${s.legend && html`<span class="stamp gold">Legend</span>`}${e?.trophy && html`<span class="stamp bad">Trophy taken</span>`}</div>
        <dl class="facts">
          <dt>Where</dt><dd>${s.where}</dd>
          <dt>When</dt><dd>${WHEN[s.time]}${WX_TXT[s.weather]}</dd>
          <dt>Rod</dt><dd class=${s.rod > G.up.rod ? 'bad' : 'good'}>Level ${s.rod + 1}${s.rod > G.up.rod ? '. Yours is too weak' : ''}</dd>
          <dt>Worth</dt><dd class="gold">About ${money(s.base)}</dd>
          <dt>Fights</dt><dd>${FIGHTS[s.fight]}</dd>
          ${e && html`<dt>Caught</dt><dd>${e.n}</dd><dt>Record</dt><dd>${fmtKg(e.best)}</dd>`}
        </dl>
      </div>
    </div>
    <footer class="foot"><span>Caught ${G.stats.caught}, trophies ${G.stats.trophies}, earned ${money(G.earned)}</span><span class="hints-inline"><${Hint} k="ArrowLeft" k2="ArrowRight" pad="D-pad">Browse<//><${Hint} k="l" pad="LB">Close<//></span></footer>
  </div>`;
}

// ---------- ship + hold ----------
function Ship() {
  const bd = boatDef(), cp = cap(), sel = G.hold[G.shipSel];
  let tot = 0, kg = 0; for (const f of G.hold) { tot += fishValue(f); kg += f.kg; }
  const need = new Map(); for (const c of G.active) need.set(c.sp, (need.get(c.sp) || 0) + c.n);
  const fitted = Object.keys(UPGRADES).filter(k => G.up[k] > 0);
  return html`<div class="screen panel rivets">
    <header class="head"><div><h1>${bd.name}</h1><div class="sub">${PAINTS.find(p => p.id === G.paint)?.name} paint. ${bd.what}.</div></div><div class="row"><span class="caps">Hold worth</span><span class="coins">${money(tot)}</span><span class="muted">${fmtKg(kg)}</span></div></header>
    <div class="body">
      <div class="col side">
        <${Canvas} cls="preview" draw=${boatPreview(bd.id, equipment(), 8)}/>
        <div class="stat"><span class="caps">Speed</span><${Bar} k=${speedMul() / 3.1}/><span class="num">${Math.round(speedMul() * 100)}%</span></div>
        <div class="stat"><span class="caps">Hull</span><${Bar} k=${G.boat.hp / hpMax()}/><span class="num">${Math.ceil(G.boat.hp)}/${hpMax()}</span></div>
        <div class="stat"><span class="caps">Hold</span><${Bar} k=${G.hold.length / cp} tone="gold"/><span class="num">${G.hold.length}/${cp}</span></div>
        <div class="row wrap">${['shrimp', 'glow', 'chum'].map(k => html`<span class="row" title=${SUPPLIES[k].name}><${Icon} k=${k} size="s"/>${G.bait[k] || 0}</span>`)}<span class="row" title="Treasure maps"><${Icon} k="map" size="s"/>${G.maps.length}</span></div>
      </div>
      <div class="col">
        <div class="hold-grid">${Array.from({ length: cp }, (_, i) => { const f = G.hold[i]; if (!f) return html`<div class="fcard empty"/>`; const fr = freshness(f);
          return html`<div class=${'fcard' + (i === G.shipSel ? ' sel' : '')} onClick=${() => { G.shipSel = i; }}><${Fish} sp=${f.sp} size="l"/><div><div>${fmtKg(f.kg)}</div><div class="gold">${money(fishValue(f))}</div></div>
            <span class="badges">${f.trophy && html`<${Icon} k="star" size="s"/>`}${need.get(f.sp) && html`<${Icon} k="map" size="s"/>`}</span>
            <div class=${'fresh ' + (fr > 0.95 ? 'good' : fr > 0.8 ? 'warn' : 'bad')} style=${{ width: `calc(${fr * 100}% - 0.7em)` }}/></div>`; })}</div>
        <div class="well pad row">${sel ? html`<${Fish} sp=${sel.sp} size="s"/><span class="gold">${SPECIES[sel.sp].name}</span><span>${fmtKg(sel.kg)}, ${Math.round(freshness(sel) * 100)}% fresh${sel.trophy ? ', trophy' : ''}${need.get(sel.sp) ? ', wanted for a contract' : ''}</span><span class="grow"/><button class="btn" onClick=${() => { G.pressed.add('x'); }}>Release<${Key} k="x"/></button>` : html`<span class="muted">Your hold is empty. Go fishing!</span>`}</div>
      </div>
      <div class="col side">
        <div class="list-head caps">Fitted gear</div>
        ${fitted.map(k => { const u = UPGRADES[k]; return html`<div class="item static"><${Icon} k=${k}/><div class="grow"><div>${u.name(bd)}</div><div class="sub">${u.lv[G.up[k] - 1]}</div></div><${Pips} n=${G.up[k]} of=${u.costs.length}/></div>`; })}
        ${!fitted.length && html`<p class="muted">Nothing fitted yet. Visit an outfitter in port.</p>`}
      </div>
    </div>
    <footer class="foot"><span class="hints-inline"><${Hint} k="ArrowLeft" k2="ArrowRight" pad="D-pad">Choose fish<//><${Hint} k="x">Release<//></span><${Hint} k="Tab" pad="B">Close<//></footer>
  </div>`;
}

// ---------- menus ----------
export const TITLE_ITEMS = () => [...(hasSave() ? ['CONTINUE'] : []), 'NEW VOYAGE', 'SETTINGS', 'CONTROLS'];
export const PAUSE_ITEMS = ['RESUME', 'SETTINGS', 'CONTROLS', 'SAVE & QUIT'];
function Menu({ items, sel, onPick, setSel }) {
  return html`<div class="menu">${items.map((s, i) => html`<button class=${'item' + (i === sel ? ' sel' : '')} onMouseEnter=${() => setSel(i)} onClick=${() => onPick(i)}>${s}</button>`)}</div>`;
}
function Title() {
  return html`<div class="center">
    <div class="logo">Bobber Run</div>
    <div class="tagline">Fish, sell, upgrade, and sail further</div>
    <div class="panel rivets menu-box"><${Menu} items=${TITLE_ITEMS()} sel=${G.titleSel || 0} setSel=${i => { G.titleSel = i; }} onPick=${i => { G.titleSel = i; G.pressed.add('Enter'); }}/></div>
    <div class="hints-inline shadowed"><${Hint} k="ArrowUp" k2="ArrowDown" pad="D-pad">Choose<//><${Hint} k="Enter" pad="A">Select<//></div>
  </div>`;
}
function Pause() {
  return html`<div class="center dim-bg">
    <div class="logo still">Paused</div>
    <div class="panel rivets menu-box"><${Menu} items=${PAUSE_ITEMS} sel=${G.pauseSel || 0} setSel=${i => { G.pauseSel = i; }} onPick=${i => { G.pauseSel = i; G.pressed.add('Enter'); }}/></div>
  </div>`;
}
function Settings() {
  const sel = G.setSel || 1, cur = ROWS[sel];
  return html`<div class="center dim-bg">
    <div class="panel rivets dialog">
      <h1>Settings</h1>
      <div class="scroll">
        ${ROWS.map((r, i) => r.head ? html`<div class="list-head caps">${r.head}</div>` : html`<${SetRow} sel=${i === sel} onEnter=${() => { G.setSel = i; }} onClick=${e => { G.setSel = i; const b = e.currentTarget.getBoundingClientRect(); G.pressed.add(e.clientX < b.left + b.width * 0.7 ? 'ArrowLeft' : 'ArrowRight'); }}>
          <span>${r.label}</span>${r.type === 'slider' ? html`<div class="vol" title=${`${r.get()} of 10`}>${Array.from({ length: 10 }, (_, k) => html`<i class=${k < r.get() ? 'on' : ''}/>`)}</div>` : html`<span class="value"><${Key} k="ArrowLeft"/>${r.get()}<${Key} k="ArrowRight"/></span>`}<//>`)}
        <${SetRow} cls="item center-t" sel=${sel === ROWS.length} onEnter=${() => { G.setSel = ROWS.length; }} onClick=${() => { G.setSel = ROWS.length; G.pressed.add('Enter'); }}>Back<//>
      </div>
      <p class="help">${cur?.help || ' '}</p>
      <footer class="foot"><span class="hints-inline"><${Hint} k="ArrowUp" k2="ArrowDown" pad="D-pad">Choose<//><${Hint} k="ArrowLeft" k2="ArrowRight">Change<//></span><${Hint} k="Escape" pad="B">Back<//></footer>
    </div></div>`;
}
function Controls() {
  const sel = G.ctlSel || 0;
  return html`<div class="center dim-bg">
    <div class="panel rivets dialog">
      <h1>Controls</h1>
      <div class="scroll">
        ${ACTIONS.map((a, i) => html`<${SetRow} sel=${i === sel} onEnter=${() => { G.ctlSel = i; }} onClick=${() => { G.ctlSel = i; G.pressed.add('Enter'); }}>
          <span>${a.label}</span><span class="value">${G.rebinding === a.id ? html`<span class="gold">Press a key</span>` : html`<${Key} k=${a.key}/>${SET.binds[a.id] && html`<span class="muted small">default ${keyLabel(a.key)}</span>`}`}</span><//>`)}
        <${SetRow} cls="item center-t" sel=${sel === ACTIONS.length} onEnter=${() => { G.ctlSel = ACTIONS.length; }} onClick=${() => { G.ctlSel = ACTIONS.length; G.pressed.add('Enter'); }}>Reset to defaults<//>
        <${SetRow} cls="item center-t" sel=${sel === ACTIONS.length + 1} onEnter=${() => { G.ctlSel = ACTIONS.length + 1; }} onClick=${() => { G.ctlSel = ACTIONS.length + 1; G.pressed.add('Enter'); }}>Back<//>
      </div>
      <p class="help">${G.rebinding ? 'Press the new key, or Esc to cancel.' : 'Choose an action and press Enter to change its key. WASD always steers too. Gamepad: stick steers, A casts, X docks, Y opens the chart, B goes back.'}</p>
      <footer class="foot"><span class="hints-inline"><${Hint} k="ArrowUp" k2="ArrowDown">Choose<//><${Hint} k="Enter">Change key<//></span><${Hint} k="Escape" pad="B">Back<//></footer>
    </div></div>`;
}
function Sunk() {
  return html`<div class="sunk"><div class="logo still bad">Your boat sank</div><p>${G.sunkMsg}.</p><p class="muted">Towed back to port...</p></div>`;
}
function App() {
  const m = G.mode;
  return html`<div class="app">
    ${m === 'title' && html`<${Title}/>`}
    ${(m === 'play' || m === 'sunk') && html`<${Hud}/>`}
    ${m === 'port' && html`<${Port}/>`}
    ${m === 'map' && html`<${Chart}/>`}
    ${m === 'log' && html`<${Logbook}/>`}
    ${m === 'ship' && html`<${Ship}/>`}
    ${m === 'pause' && html`<${Pause}/>`}
    ${m === 'settings' && html`<${Settings}/>`}
    ${m === 'controls' && html`<${Controls}/>`}
    ${m === 'sunk' && G.sunkT > 1 && html`<${Sunk}/>`}
    ${m !== 'title' && html`<${Toasts} low=${m !== 'play' && m !== 'sunk'}/>`}
  </div>`;
}
