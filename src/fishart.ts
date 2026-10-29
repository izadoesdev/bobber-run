// Per-species body-shape templates (T=top M=mid B=belly F=fin E=eye G=glow S=stripe), extruded into voxel fish.
import type { FishMark, FishShape } from './types';

export const FISH_T: Record<FishShape, string[]> = {
  whale: ['........FFF...........', 'F....TTTTTTTTTTTT.....', 'FF.TMMMMMMMMMMMMMMTT..', '.FFMMMMMMMMMMMMMMMMMET', 'FF.BBBBBBBBBBBBBBBBBB.', 'F.....FFF.....FFF.....', '......FF.......FF.....'],
  dolphin: ['........FF.........', '.......FFF.........', 'F....TTTTTTTT......', 'FF.TMMMMMMMMMTT....', '.FFMMMMMMMMMMMMETTT', 'FF.BBBBBBBBBBBBB...', 'F.....FF....FF.....'],
  jelly: ['.....TTTTT.....', '...TTMMMMMTT...', '..TMMMMMMMMMT..', '.TMMMMMMMMMMMT.', '.BBBBBBBBBBBBB.', '..F.F..F..F.F..', '..F.F..F..F.F..', '.F..F..F..F..F.', '..F..F.F.F..F..', '..F....F....F..'],
  slim:  ['.....FF......', 'FF..TTTTTTT..', '.FFTMMMMMMMET', 'FF..BBBBBBBB.', '.....F..F....'],
  perch: ['....F.F.F....', '...FFFFFFF...', 'F..TTTTTTTT..', 'FFTMTMTMTMMET', 'F.MMMMMMMMMMT', 'F..BBBBBBBB..', '.....F..F....'],
  long:  ['......FFF.......', 'F...TTTTTTTTT...', 'FF.TMMMMMMMMMTT.', 'FFTMMMMMMMMMMMET', 'F..BBBBBBBBBBBB.', '.....F....F.....'],
  flat:  ['....TTTT.....', '..TTMMMMTT...', '.TMMMMMMMMT..', 'FTMMMMMMMEET.', 'FTMMMMMMMMMT.', '.TMMMMMMMMT..', '..TTMMMMTT...', '....TTTT.....'],
  tuna:  ['F......FF.......', 'FF...TTTTTTTT...', '.FFTTMMMMMMMMTT.', '..FMMMMMMMMMMMET', '.FFBBBBBBBBBBBB.', 'FF....F.F.F.....', 'F...............'],
  bill:  ['.....FFFFF..........', 'F...TTTTTTTTT.......', 'FF.TMMMMMMMMMTT.....', '.FTMMMMMMMMMMMMETTTT', 'FF.BBBBBBBBBBBB.....', 'F......F............'],
  round: ['.....FF......', '...TTTTTT....', '..TMMMMMMT...', 'F.MMMMMMMMT..', 'FFMMMMMMMMET.', 'F.MMMMMMMMT..', '..BBBBBBBB...', '...BBBBBB....', '.....FF......'],
  squid: ['.......TTTTT..', 'F.F.FMMMMMMMT.', 'FFFFFMMMMMEMMT', 'F.F.FMMMMMMMT.', '.......BBBBB..'],
  glow:  ['....FF......', 'F..TTTTTT...', 'FFTMGMGMMET.', 'F..BGBGBBB..', '....F.......'],
  levi:  ['..........FFFF............', 'F......TTTTTTTTTTT........', 'FF...TTMMMMMMMMMMMTTT.....', '.FF.TMMMMMMMMMMMMMMMMTT...', '..FFMMMMMMMMMMMMMMMMMMMET.', '.FF.BBBBBBBBBBBBBBBBBBBBG.', 'FF....BBBBBBBBBBBBBBB...G.', 'F........F......F......G..'],
  crab:  ['.F.......F.', 'FF.......FF', '.F.TTTTT.F.', '..TMMMMMT..', '.FMMEMEMMF.', 'F.BBBBBBB.F', '.F.F...F.F.'],
  eel:   ['.....FFFFFFFFFF.....', 'FTTTTTTTTTTTTTTTTTT.', '.MMMMMMMMMMMMMMMMMET', '..BBBBBBBBBBBBBBBB..'],
  puffer:['...F.F.F....', '.F.TTTTT.F..', '..TTMMMMTT..', 'FTMMMMMMMET.', '.TMMMMMMMMTT', 'FTMMMMMMMMT.', '.BBBBBBBBB..', 'F.BBBBBBB.F.', '...F.F.F....'],
  angel: ['....F.....', '...FF.....', '..TTT.....', '.TTMMT....', 'FTMMMMET..', 'FMMSMMMMT.', 'FMMSMMMMT.', '.BBSBBBB..', '..BBB.....', '...FF.....', '....F.....'],
  shark: ['..........F.......', '.........FF.......', 'F.......FFF.......', 'FF...TTTTTTTTTT...', '.FFTTMMMMMMMMMMTT.', '..FMMMMMMMMMMMMMET', '.FF.BBBBBBBBBBBBB.', 'F.....F.FF........'],
  // a ray seen from above (rows run across its wings): plan-view shapes are drawn as they are, not as a side view
  ray:   ['....T.....', '...TTT....', '...TTTT...', '..TTTTTT..', '..TTTTTTT.', '.TTTTTTTT.', '.TTMMMTTTF', 'FTTMMMMTTE', 'FFMMMMMMTT', 'FTTMMMMTTE', '.TTMMMTTTF', '.TTTTTTTT.', '..TTTTTTT.', '..TTTTTT..', '...TTTT...', '...TTT....', '....T.....'],
  carp:  ['.....FFFF......', 'F...TTTTTTTT...', 'FF.TMMMMMMMMTT.', 'FFTMMMMMMMMMMET', 'FF.BBBBBBBBBBB.', 'F....F...F.....'],
};

/**
 * The colour a species' markings paint on one body cell, or null. `t` is how far along the body it is (0 at the tail,
 * 1 at the head), `i` its column, `off` how far it lies from the line a stripe runs along, and `k` a stable 0..1 number
 * per cell for spots. Shared by the fish in the water (seen from above) and their icons (seen from the side).
 */
export function markAt(mark: [FishMark, string] | undefined, t: number, i: number, off: number, k: number): string | null {
  if (!mark) return null;
  const [kind, c] = mark;
  if (kind === 'bars') return i % 3 === 0 && t > 0.15 && t < 0.92 ? c : null;
  if (kind === 'bands') return [0.22, 0.5, 0.78].some(b => Math.abs(t - b) < 0.07) ? c : null;
  if (kind === 'spots') return k < 0.2 ? c : null;
  return Math.abs(off) < 0.5 && t > 0.08 && t < 0.9 ? c : null;
}
