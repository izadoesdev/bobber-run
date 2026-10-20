// Side goals: coin rewards for milestones, completed in any order. Small ones pay quietly (the coin floater shows
// it), so they never talk over the story quests.
import { sfx } from '../audio';
import { SPECIES, UPGRADES, UPGRADE_KEYS } from '../econ';
import { G } from './state';
import { logged } from './rules';
import { addCoins, toast } from './feedback';

interface Goal { text: string; reward: number; done: () => boolean }
const trophied = (): number => SPECIES.filter(s => G.log[s.id]?.trophy).length;
const goal = (text: string, reward: number, done: () => boolean): Goal => ({ text, reward, done });

// G.goalsDone stores indexes into this list, so only ever append to it
const GOALS: Goal[] = [
  goal('Catch a fish', 10, () => G.stats.caught >= 1),
  goal('Sell fish at a port', 10, () => G.stats.sold >= 1),
  goal('Buy an upgrade', 20, () => G.stats.upgrades >= 1),
  goal('Chart a lighthouse', 20, () => G.stats.lights >= 1),
  goal('Deliver a port contract', 40, () => G.stats.contracts >= 1),
  goal('Log 5 species', 50, () => logged() >= 5),
  goal('Catch a trophy fish', 60, () => G.stats.trophies >= 1),
  goal('Buy the Sail Skiff', 60, () => G.owned.includes('skiff')),
  goal('Catch a fish at night', 60, () => G.stats.night >= 1),
  goal('Salvage a wreck', 50, () => G.stats.wrecks >= 1),
  goal('Find a sunken treasure', 100, () => G.stats.treasures >= 1),
  goal('Catch a fish in a storm', 120, () => G.stats.storm >= 1),
  goal('Catch a fish in a feeding frenzy', 80, () => G.stats.frenzy >= 1),
  goal('Buy the Motor Launch', 150, () => G.owned.includes('launch')),
  goal('Land a Bluefin Tuna', 200, () => !!G.log.tuna),
  goal('Log 10 species', 250, () => logged() >= 10),
  goal('Buy the Trawler', 400, () => G.owned.includes('trawler')),
  goal('Catch the Ghost Carp', 600, () => !!G.log.ghost),
  goal('Catch the Old One', 2500, () => !!G.log.oldone),
  goal('Complete the logbook', 1500, () => logged() >= SPECIES.length),
  goal('Chart 8 lighthouses', 200, () => G.stats.lights >= 8),
  goal('Catch 10 trophies', 300, () => G.stats.trophies >= 10),
  goal('Earn $10,000 in total', 500, () => G.earned >= 10000),
  goal('Max out every upgrade', 800, () => UPGRADE_KEYS.every(k => G.up[k] >= UPGRADES[k].costs.length)),
  goal('Catch a trophy of every species', 3000, () => trophied() >= SPECIES.length),
];

export function checkGoals(): void {
  GOALS.forEach((g, k) => {
    if (G.goalsDone.includes(k) || !g.done()) return;
    G.goalsDone.push(k);
    G.goalIdx = G.goalsDone.length;
    addCoins(g.reward);                            // the coin floater says it; only big milestones get a toast
    if (g.reward >= 200) { toast(`${g.text}  +$${g.reward}`, 'good'); sfx('fanfare'); }
  });
}
