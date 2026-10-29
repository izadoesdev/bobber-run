// DOM UI (Preact), rendered from the live game state; Preact diffs the changes. While sailing it renders every
// frame (labels pinned to the moving world must keep up with the sea); on other screens only after input, a change
// of screen, or 15 times a second for small animations, since restyling the UI every frame was most of the CPU.
// Design system: wood panels frame and navigate, parchment holds documents and details,
// one focus colour, one icon style (voxel renders), sentence case for anything longer than a label.
import { Chat } from './chat';
import { Leaderboard } from './leaders';
import { IslandDialog } from './island';
import { EncounterDialog } from './encounter';
import { SailorCard } from './sailorcard';
import { render } from 'preact';
import { G } from '../game';
import { Hud, Toasts } from './hud';
import { Port } from './port';
import { AdminChip, AdminPanel } from './admin';
import { Chart, Journal, Logbook, Ship } from './screens';
import { Cheats, Controls, EmotePick, Finale, Online, Pause, SaveWarning, Settings, Sunk, Talk, Title } from './menus';

let root: HTMLElement | null = null, dirty = true, lastMode = '', lastAt = 0;
const LIVE = new Set(['play', 'sunk', 'emote']);   // the sailing view: world-pinned labels move with the camera
export function initUI(el: HTMLElement): void {
  root = el;
  const poke = (): void => { dirty = true; };
  for (const ev of ['keydown', 'keyup', 'pointerdown', 'pointerup', 'pointermove', 'wheel', 'input', 'resize']) addEventListener(ev, poke, { capture: true, passive: true });
}
export function drawUI(): void {
  if (!root) return;
  const now = performance.now();
  if (!LIVE.has(G.mode) && !dirty && !G.pad && G.mode === lastMode && now - lastAt < 66) return;   // a gamepad sends no events: render every frame
  dirty = false; lastMode = G.mode; lastAt = now;
  render(<App />, root);
}

function App() {
  const m = G.mode;
  return (
    <div class="app">
      {m === 'title' && <Title />}
      {(m === 'play' || m === 'sunk') && <Hud />}
      {m === 'play' && <><Chat /><SailorCard /></>}
      {m === 'port' && G.menu.port && <Port p={G.menu.port} />}
      {m === 'map' && <Chart />}
      {m === 'log' && <Logbook />}
      {m === 'ship' && <Ship />}
      {m === 'pause' && <Pause />}
      {m === 'settings' && <Settings />}
      {m === 'controls' && <Controls />}
      {m === 'sunk' && G.sunkT > 1 && <Sunk />}
      {m === 'finale' && <Finale />}
      {m === 'cheat' && <Cheats />}
      {m === 'account' && <Online />}
      {m === 'emote' && <><Hud /><EmotePick /></>}
      {m === 'talk' && G.talk && <Talk t={G.talk} />}
      {m === 'journal' && <Journal />}
      {m === 'leaders' && <Leaderboard />}
      {m === 'island' && <IslandDialog />}
      {m === 'encounter' && <EncounterDialog />}
      {m !== 'title' && <><AdminChip /><AdminPanel /></>}
      {m !== 'title' && <Toasts low={m !== 'play' && m !== 'sunk'} />}
      {m !== 'pause' && <SaveWarning />}
    </div>
  );
}
