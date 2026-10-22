// The chart's sampler, off the main thread: tiles asked for by chartgl.ts come back as transferable buffers.
import { sampleTile, N, NC, BANDS } from './chartsample';

self.onmessage = (e: MessageEvent<{ k: number; l: number; tx: number; ty: number }>) => {
  const { k, l, tx, ty } = e.data, h = new Uint16Array(N * N), c = new Uint8Array(NC * BANDS * NC * 4);
  sampleTile(l, tx, ty, h, c);
  (self as unknown as Worker).postMessage({ k, l, tx, ty, h, c }, [h.buffer, c.buffer]);
};
