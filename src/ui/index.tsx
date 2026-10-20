// DOM UI (Preact). Re-rendered every frame from the live game state; Preact diffs the changes.
// Design system: wood panels frame and navigate, parchment holds documents and details,
// one focus colour, one icon style (voxel renders), sentence case for anything longer than a label.
import { Chat } from './chat';
import { Leaderboard } from './leaders';
import { IslandDialog } from './island';
import { SailorCard } from './sailorcard';
import { render } from 'preact';
import { G } from '../game';
import { Hud, Toasts } from './hud';
import { Port } from './port';
import { Chart, Journal, Logbook, Ship } from './screens';
import { Cheats, Controls, EmotePick, Finale, Online, Pause, Settings, Sunk, Talk, Title } from './menus';

let root: HTMLElement | null = null;
export function initUI(el: HTMLElement): void { root = el; }
export function drawUI(): void { if (root) render(<App />, root); }

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
      {m !== 'title' && <Toasts low={m !== 'play' && m !== 'sunk'} />}
    </div>
  );
}
