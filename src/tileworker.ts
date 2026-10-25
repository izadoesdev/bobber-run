// Builds height tiles for tilepool.ts with the same world code, so a tile is the same wherever it was built.
import { tileHeights } from './world';

self.onmessage = (e: MessageEvent<{ tx: number; ty: number }>) => {
  const { tx, ty } = e.data, { h, land } = tileHeights(tx, ty);
  (self as unknown as Worker).postMessage({ tx, ty, h, land }, [h.buffer]);
};
