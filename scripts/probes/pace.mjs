// Progression pace, measured: a scripted captain plays HOURS of simulated time near the coast (sails to the best
// biting school in reach, fights each fish by keeping the strain out of the red and easing off for surges, sells
// when the hold is full, buys the next boat or upgrade) and reports income every 15 minutes and when milestones
// fell. Sailing is costed at the boat's speed, not simulated, so treat times as a fast but human-ish lower bound.
// Run: bun run build && bunx vite preview --port 4870, then node scripts/probes/pace.mjs http://localhost:4870/ [hours]
import { chromium } from '@playwright/test';

const url = process.argv[2] ?? 'http://localhost:4870/', HOURS = Number(process.argv[3] ?? 2);
const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await (await b.newContext({ viewport: { width: 640, height: 400 } })).newPage();
await p.route(/(cdn|basket|api)\.databuddy\.cc/, r => r.abort());
await p.goto(url + '?offline'); await p.waitForTimeout(4000);
const out = await p.evaluate(HOURS => {
  const { G, GAME, SPECIES, schoolsNear, poisNear, homePort, sim } = window.BR, b = G.boat, marks = [];
  let T = 0, attempts = 0, lost = 0; const why = {}; const no = k => { why[k] = (why[k] || 0) + 1; };
  const step = sec => { for (let i = 0, n = Math.round(sec * 30); i < n; i++) { sim(1 / 30); T += 1 / 30; } };
  const mark = s => marks.push(`${Math.round(T / 60)}m ${s}`);
  const travel = (x, y) => { const t = Math.hypot(x - b.x, y - b.y) / (28 * GAME.speedMul()); T += t; G.clock += t; Object.assign(b, { x, y, px: x, py: y, vx: 0, vy: 0, w: 0 }); step(0.1); };
  const items = () => GAME.portItems(G.menu.port), tab = name => { const i = GAME.portTabs(G.menu.port).indexOf(name); if (i >= 0) GAME.setTab(i); return i >= 0; };
  const act = pred => { const it = items().find(pred); if (it?.ok && it.act) { it.act(); it.act(); return true; } return false; };   // twice: big buys ask to confirm
  const BOATS = ['skiff', 'launch', 'trawler', 'schooner', 'drifter', 'flagship'];
  const UPS = ['hold', 'rod', 'prop', 'ice', 'tackle', 'reel', 'line', 'hold', 'rod', 'hull', 'sonar', 'cook', 'net', 'lantern', 'quarter'];
  G.talk = null; G.mode = 'play'; G.story = { i: 99, base: {}, shown: true }; G.stats.caught = 5;
  let nextMark = 900;
  while (T < HOURS * 3600) {
    if (T >= nextMark) { mark(`earned $${G.earned}, ${G.stats.caught} caught, ${GAME.logged()} species, boat ${G.boatId}, rod ${G.up.rod}`); nextMark += 900; }
    if (G.hold.length >= GAME.cap()) {                                        // full: sell at the nearest charted port
      let best = homePort(), bd = Infinity;
      for (const q of poisNear(b.x, b.y, 3000)) if (q.type === 'port' && G.found.has(q.id)) { const d = Math.hypot(q.x - b.x, q.y - b.y); if (d < bd) { bd = d; best = q; } }
      travel(best.dock.x, best.dock.y); GAME.dock(best);
      if (G.mode !== 'port') { no('dock failed: ' + G.mode); G.hold.length = 0; continue; }
      tab('MARKET'); act(i => i.kind === 'sell');
      const want = BOATS.find(id => !G.owned.includes(id));
      if (want && tab('SHIPYARD') && act(i => i.boat?.id === want && !i.paint)) mark(`bought the ${want}`);
      else if (tab('OUTFITTER')) for (const k of UPS) if (act(i => i.key === k)) break;
      GAME.leavePort?.(); G.mode = 'play'; continue;
    }
    const near = schoolsNear(b.x, b.y, 900).filter(s => GAME.schoolActive(s) && SPECIES[s.sp].rod <= G.up.rod && !s.boss && !GAME.catchNeed(s.sp));   // landable from this boat
    if (!near.length) { no('no school in reach'); T += 20; G.clock += 20; step(1); continue; }
    const worth = s => SPECIES[s.sp].base / (Math.hypot(s.x - b.x, s.y - b.y) / (28 * GAME.speedMul()) + 12);
    const s = near.sort((x, y) => worth(y) - worth(x))[0];
    travel(s.x + 28, s.y);
    G.pressed.add(' '); step(1 / 30); if (!G.fish) { no(`no cast (mode ${G.mode}, near ${!!G.nearSchool})`); continue; } attempts++;
    for (let t = 0; G.fish && G.fish.st !== 'bite' && t < 20; t += 1 / 30) step(1 / 30);
    if (!G.fish) { no('no bite'); continue; }
    step(0.25); G.pressed.add(' '); step(1 / 30);                             // strike a quarter second in
    const before = G.stats.caught;
    for (let t = 0; G.fish && t < 90; t += 1 / 30) { const f = G.fish; G.keys[' '] = !(f.cue > 0 || f.taking) && f.tension < (f.redAt ?? 0.75) - 0.08; step(1 / 30); }
    G.keys[' '] = false; G.card = null;
    if (G.stats.caught === before) lost++;
  }
  return { marks: [...marks, 'why: ' + JSON.stringify(why)], summary: `${HOURS} h: earned $${G.earned}, ${G.stats.caught} caught of ${attempts} hooked (${lost} lost), ${GAME.logged()}/${SPECIES.length} species, boat ${G.boatId}, ${G.stats.upgrades} upgrades` };
}, HOURS);
console.log(out.summary); for (const m of out.marks) console.log('  ' + m);
await b.close();
