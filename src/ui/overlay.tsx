// What sits on the sea rather than in the HUD's corners: the route to a waypoint, the objective's pennant or arrow,
// region and welcome titles, the story's spoken line, the prompt under the boat, school fish, sailors' name tags and
// chat bubbles, and the owners' signs on claimed islands.
import type { JSX } from 'preact';
import { G, schoolActive } from '../game';
import { SPECIES } from '../econ';
import { schoolsNear } from '../world';
import { SET } from '../settings';
import { EMOTES } from '../net';
import { ONLINE } from '../online';
import { speech, voyage } from '../story';
import { markerTarget, type Step } from '../game/guide';
import { waypointRoute } from '../waypoint';
import { coursePath } from '../game/autopilot';
import { regionAt } from '../biome';
import { newWaters, regionAbout } from '../game/regions';
import { IslandSigns } from './island';
import { Face } from './faces';
import { BaitTag, Fish, Icon, Key, edgeFade, forTouch, keyed, viewPct } from './parts';

/** Everything drawn over the sea while sailing. `wp` is the player's waypoint, which takes the arrow from the guide. */
export function SeaLayer({ step, wp }: { step: Step; wp: Step | null }) {
  return (
    <>
      <RouteDots />
      <Welcome />
      <RegionTitle />
      <Speech />
      <BoatPrompt />
      {worldLabels()}
      <IslandSigns />
      <Marker step={wp ?? step} force={!!wp} />
    </>
  );
}

// a line said while you sail (the first quest's), with who says it; it never pauses the game
function Speech() {
  const s = speech();
  if (!s || G.fish || G.card || G.t - voyage.startedAt < 3.6) return null;   // after the welcome title has faded
  return (
    <div class="speech chip" role="status" aria-live="polite">
      <Face who={s.who} name={s.name} role={s.role ?? ''} talking line={s.text} /><span><b class="gold">{s.name}</b> {forTouch(s.text)}</span>
    </div>
  );
}
// the game's name over the water for a moment when a first voyage starts there instead of on a title screen
function Welcome() {
  const age = G.t - voyage.startedAt;
  if (age > 4 || age < 0) return null;
  return <div class={'region-title welcome' + (age > 3 ? ' out' : '')}>Bobber Run</div>;
}

// the objective on screen: a small bobbing pennant over it when it's in clear view, otherwise an arrow circling
// the boat that points to it, with the distance. Both keep clear of the HUD panels.
const TARGET_COL = '#f0cf6a', WAYPOINT_COL = '#e6efec';   // gold for the guide's next step, white for your waypoint, as on the charts
let uiBox: DOMRect | null = null, panels: DOMRect[] = [], em = 16, measuredAt = -1e9;
function measure(): DOMRect | null {
  const now = performance.now();
  if (now - measuredAt > 400 || !uiBox) {
    measuredAt = now;
    const root = document.getElementById('ui');
    uiBox = root?.getBoundingClientRect() ?? null;
    em = root ? parseFloat(getComputedStyle(root).fontSize) || 16 : 16;
    panels = root ? [...root.querySelectorAll('.hud-left, .mini, .hints, .chat, .toast')].map(e => e.getBoundingClientRect()) : [];
    panels.push(...[...document.querySelectorAll('#touch .tbar, #touch .tact')].map(e => e.getBoundingClientRect()));   // touch buttons
  }
  return uiBox;
}
const covered = (x: number, y: number, pad: number): boolean =>
  panels.some(r => x > r.left - pad && x < r.right + pad && y > r.top - pad && y < r.bottom + pad);
function Marker({ step, force }: { step: Step; force?: boolean }) {
  const p = force ? (G.fish || G.card || G.mode !== 'play' ? null : step.at ?? null) : markerTarget(step), box = p && measure();
  if (!p || !box) return null;
  const toPx = (wx: number, wy: number): [number, number] => {
    const [x, y] = viewPct(wx, wy);
    return [box.left + x / 100 * box.width, box.top + y / 100 * box.height];
  };
  const [tx, ty] = toPx(p.x, p.y), col = force ? WAYPOINT_COL : TARGET_COL;
  const pct = (x: number, y: number) => ({ left: (x - box.left) / box.width * 100 + '%', top: (y - box.top) / box.height * 100 + '%' });
  if (tx > box.left + 2 * em && tx < box.right - 2 * em && ty > box.top + 3 * em && ty < box.bottom - 2 * em && !covered(tx, ty - 1.6 * em, em)) {
    if (force) return null;                         // a waypoint in view has its buoy
    const bob = SET.calm ? 0 : Math.sin(G.t * 3) * 0.3;
    return (
      <div key="guide-on" aria-hidden="true" style={{ position: 'absolute', ...pct(tx, ty), transform: `translate(-50%, ${-130 - bob * 40}%)`, pointerEvents: 'none', filter: 'drop-shadow(0 0.12em 0 #000a)' }}>
        <svg viewBox="0 0 16 16" width="1.5em" height="1.5em" style={{ display: 'block' }}>
          <path d="M2.5 3 L13.5 3 L8 12.5 Z" fill={col} stroke="#1b2a33" stroke-width="1.5" stroke-linejoin="round" />
        </svg>
      </div>
    );
  }
  // off screen (or under a panel): an arrow on a ring around the boat, pointing the way
  const [bx, by] = toPx(G.boat.x, G.boat.y), a = Math.atan2(ty - by, tx - bx);
  let R = Math.min(box.width, box.height) * 0.3;
  while (R > 4 * em && covered(bx + Math.cos(a) * R, by + Math.sin(a) * R, 1.5 * em)) R -= em;   // pulled in past a panel
  return (
    <div key="guide-off" aria-hidden="true" style={{ position: 'absolute', ...pct(bx + Math.cos(a) * R, by + Math.sin(a) * R), transform: 'translate(-50%, -50%)', pointerEvents: 'none' }}>
      <svg viewBox="0 0 16 16" width="1.6em" height="1.6em" style={{ display: 'block', transform: `rotate(${a}rad)`, filter: 'drop-shadow(0 0.12em 0 #000a)' }}>
        <path d="M14.5 8 L2.5 2.5 L5.5 8 L2.5 13.5 Z" fill={col} stroke="#1b2a33" stroke-width="1.4" stroke-linejoin="round" />
      </svg>
    </div>
  );
}

// the name of a region as you sail into it, once, like an area title; it waits until you've stayed a few seconds
// so a wiggle along a border doesn't flash it
let region: string | null = null, entering: string | null = null, enterT = 0, titleT = -99, checkT = -1;
let openedFor = -99, openedT = -99;
function RegionTitle() {
  if (G.t - checkT > 0.5) {
    checkT = G.t;
    const here = regionAt(G.boat.x, G.boat.y).id;
    if (region === null) region = here;                          // where you start is never announced
    else if (here === region) entering = null;
    else if (here !== entering) { entering = here; enterT = G.t; }
    else if (G.t - enterT > 3) { region = here; entering = null; titleT = G.t; }
  }
  // new waters: once you're back at the helm (a quest's talk usually comes first), for five seconds
  if (newWaters.at > openedFor && G.mode === 'play') { openedFor = newWaters.at; openedT = G.t; }
  const age = G.t - titleT, opened = G.t - openedT;
  if (opened < 5 && G.mode === 'play') return <div class={'region-title' + (opened > 4 ? ' out' : '')} aria-live="polite">New waters open<small>The rough water has calmed. Look at your chart</small></div>;
  if (age > 4.5 || !region || G.mode !== 'play') return null;
  const r = regionAt(G.boat.x, G.boat.y);
  return <div class={'region-title' + (age > 3.6 ? ' out' : '')} aria-live="polite">{r.name}<small>{regionAbout(r)}</small></div>;
}

// the way to the waypoint (or to where the boat is sailing itself) as a trail of dots on the sea, rippling toward
// the end, with a buoy there; the route already goes round islands, so the dots never cross land
const DOT_GAP = 13, MAX_DOTS = 80;
function RouteDots() {
  const path = G.waypoint ? waypointRoute() : coursePath();
  if (!path.length || G.mode !== 'play' || G.fish) return null;
  const dots: JSX.Element[] = [], inView = (x: number, y: number) => x > -2 && x < 102 && y > -2 && y < 102;
  // dots sit at fixed distances back from the end, so they stay put on the water as the boat sails along them
  // (measured from the boat they'd slide every frame); the ones under or behind the bow are left out
  const xs = [G.boat.x, ...path.map(p => p.x)], ys = [G.boat.y, ...path.map(p => p.y)], cum = [0];
  for (let i = 1; i < xs.length; i++) cum.push(cum[i - 1] + Math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1]));
  const total = cum[cum.length - 1];
  const kMax = Math.floor((total - DOT_GAP * 1.5) / DOT_GAP);              // the dot nearest the bow, counted back from the end
  for (let k = kMax, seg = 0; k >= Math.max(0, kMax - MAX_DOTS + 1); k--) {
    const s = total - k * DOT_GAP;
    while (seg < xs.length - 2 && cum[seg + 1] < s) seg++;
    const t = (s - cum[seg]) / ((cum[seg + 1] - cum[seg]) || 1), [x, y] = viewPct(xs[seg] + (xs[seg + 1] - xs[seg]) * t, ys[seg] + (ys[seg + 1] - ys[seg]) * t);
    if (inView(x, y)) dots.push(<i key={k} style={{ left: x + '%', top: y + '%', animationDelay: k * 0.11 + 's' }} />);
  }
  const end = G.waypoint, [ex, ey] = end ? viewPct(end.x, end.y) : [-9, -9];
  return (
    <div class="route" aria-hidden="true">
      {dots}
      {end && inView(ex, ey) && (
        <svg class="buoy" viewBox="0 0 16 24" style={{ left: ex + '%', top: ey + '%' }}>
          <path d="M8 1 V9" stroke="#2a1f17" stroke-width="1.2" />
          <path d="M8.6 1.5 L14 3.6 L8.6 5.7 Z" fill="#f0cf6a" stroke="#2a1f17" stroke-width="0.8" stroke-linejoin="round" />
          <path d="M4 9 H12 L13 16 Q8 18.5 3 16 Z" fill="#e05a45" stroke="#2a1f17" stroke-width="1" stroke-linejoin="round" />
          <path d="M3.6 12.2 H12.4" stroke="#fff6dc" stroke-width="1.6" />
          <ellipse cx="8" cy="18.5" rx="6.5" ry="1.6" fill="#e6efec" fill-opacity="0.35" />
        </svg>
      )}
    </div>
  );
}

// chat lines over boats: each sailor's latest filtered message (uid 'me' is ours), shown for 6 s, then fading
const CHAT_MS = 6500, CHAT_MAX = 120;
function ChatBubble({ text, at, x, y, mine }: { text: string; at: number; x: number; y: number; mine?: boolean }) {
  const age = Date.now() - at, fade = Math.min(1, Math.max(0, (CHAT_MS - age) / 500));
  return (
    <div class={'bubble say' + (mine ? ' mine' : '')} style={{ left: x + '%', top: y + '%', opacity: fade }}>
      {text.length > CHAT_MAX ? text.slice(0, CHAT_MAX - 1) + '…' : text}
    </div>
  );
}
// the species of nearby schools as a small fish, no words (spyglass 2), other sailors' name tags and greetings,
// and your own greeting
function worldLabels(): JSX.Element[] {
  const labels: JSX.Element[] = [];
  // the spyglass reaches 120 units: fish fade in over its last 30, and at the view's edges, rather than blinking
  if (G.up.spyglass >= 2 && !G.fish) for (const s of schoolsNear(G.boat.x, G.boat.y, 120)) {
    if (!schoolActive(s) || s.boss) continue;
    const [x, y] = viewPct(s.x, s.y - 6), a = edgeFade(x, y, 4, 96, 30, 92) * Math.min(1, (120 - Math.hypot(s.x - G.boat.x, s.y - G.boat.y)) / 30);
    if (a > 0) labels.push(<div class="label-world bare" key={'f' + s.id} style={{ left: x + '%', top: y + '%', opacity: 0.7 * a }} title={SPECIES[s.sp].name}><Fish sp={s.sp} size="s" /></div>);
  }
  // other sailors: a name tag, plus a speech bubble for a few seconds after they greet or chat (the newer wins)
  const now = Date.now(), fresh = (at: number) => now - at < 4500, said = SET.chat === 'off' ? new Map<string, { text: string; at: number }>() : ONLINE.chat;
  for (const s of ONLINE.sailors) {
    const [x, y] = viewPct(s.x, s.y - 22), a = edgeFade(x, y, 2, 98, 6, 96, 3);
    if (!a) continue;
    labels.push(<div class="label-world chip sailor" key={'n' + s.uid} style={{ left: x + '%', top: y + '%', opacity: a }}>{s.name}</div>);
    const line = said.get(s.uid), talking = line && now - line.at < CHAT_MS && (s.emote == null || line.at > s.emoteAt);
    if (talking) labels.push(<ChatBubble key={'c' + s.uid} text={line.text} at={line.at} x={x} y={y - 6.5} />);
    else if (s.emote != null && fresh(s.emoteAt)) {
      labels.push(<div class="bubble" key={'b' + s.uid} style={{ left: x + '%', top: y - 5 + '%' }}>{EMOTES[s.emote]}</div>);
    }
  }
  const mine = said.get('me'), [mx, my] = viewPct(G.boat.x, G.boat.y - 24);
  const emoteAt = G.myEmote ? now - (G.t - G.myEmote.t) * 1000 : -Infinity;   // game time to wall-clock time
  if (mine && now - mine.at < CHAT_MS && mine.at > emoteAt) {
    labels.push(<ChatBubble key="me-chat" text={mine.text} at={mine.at} x={mx} y={my} mine />);
  } else if (G.myEmote && G.t - G.myEmote.t < 4.5) {
    labels.push(<div class="bubble mine" key="me" style={{ left: mx + '%', top: my + '%' }}>{EMOTES[G.myEmote.i]}</div>);
  }
  return labels;
}

// The first minute has no words: once a school is in reach, the cast key under the boat; resting about 6 s
// anywhere else, the steering key. The arrow round the boat already points at the school.
let movedAt = -1;
function FirstHint() {
  const b = G.boat;
  if (movedAt < 0 || Math.hypot(b.vx, b.vy) > 3) movedAt = G.t;
  if (G.fish || G.card || G.mode !== 'play') return null;
  const cast = !!G.prompt?.includes('[SPACE]');
  if (!cast && G.t - movedAt < 6) return null;
  const [x, y] = viewPct(b.x, b.y + 16);
  return (
    <div class="prompt-world first-hint" aria-hidden="true" style={{ left: x + '%', top: y + '%' }}>
      {cast ? <><Key k=" " pad="A" /><Icon k="rod" size="s" /></> : <><Key k="ArrowUp" pad="LS" /><Icon k="hull" size="s" /></>}
    </div>
  );
}
// what you can do right here (cast, dock, salvage) as a small label under the boat instead of a panel; the
// fishing prompts stay at the bottom, where a warning has to be loud
function BoatPrompt() {
  if (!G.stats.caught) return <FirstHint />;
  if (!G.prompt || G.fish || G.card || G.mode !== 'play') return null;
  const [x, y] = viewPct(G.boat.x, G.boat.y + 16);
  return <div class="prompt-world" style={{ left: x + '%', top: y + '%' }}>{keyed(G.prompt)}{G.nearSchool && <BaitTag />}</div>;
}
