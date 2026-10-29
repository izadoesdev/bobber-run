import { LIFE, type CatchableLife } from '../life';
import { SP } from '../species';
import type { School } from '../types';
import { G } from './state';

let nextId = 0;

function stockFor(animal: CatchableLife, sp: number, reach = 0): School {
  const stock = animal.fishing ??= {
    id: `wildlife:${++nextId}`, sp, x: animal.x, y: animal.y,
    stock: 1, max: 1, respawn: 0, ph: 0, wildlife: true, reach,
  };
  stock.x = animal.x;
  stock.y = animal.y;
  return stock;
}

/** The very same actors the renderer draws, with one catch per individual, not duplicate fish schools. */
export function wildlifeStocks(): School[] {
  const stocks: School[] = [];
  for (const whale of LIFE.whales) stocks.push(stockFor(whale, SP.humpback, 16 * whale.size));
  for (const giant of LIFE.giants) {
    const species = { shadow: SP.sleepershark, ray: SP.manta, squid: SP.gsquid, eel: SP.ribboneel };
    stocks.push(stockFor(giant, species[giant.kind], giant.len / 2));
  }
  for (const pod of LIFE.pods) for (const dolphin of pod.m) stocks.push(stockFor(dolphin, SP.dolphin, 5));
  for (const jelly of LIFE.jellies) stocks.push(stockFor(jelly, SP.jellyfish, jelly.size));
  return stocks.filter(stock => stock.stock > 0);
}

export function wildlifePresent(stock: School): boolean {
  return wildlifeStocks().includes(stock);
}

/** Once hooked, the fishing renderer owns the animal's position. A landed individual disappears. */
export function creatureShown(animal: CatchableLife): boolean {
  const stock = animal.fishing;
  return !stock || (stock.stock > 0 && !(G.fish?.s === stock && G.fish.st === 'reel'));
}
