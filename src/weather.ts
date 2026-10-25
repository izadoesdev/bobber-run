// Weather: clear / cloudy / rain / storm with smooth transitions, gusts and lightning.
import type { WeatherState } from './types';
import { isWorldFrenzy, today } from './today';
import { biomeMix, coldness, warmth, themeHoldAt, THEMES, type Atmos, type ThemeHold } from './biome';

// mostly fair: rain is a passing shower and a storm an event (wet about a tenth of the time, it was a third); stormy
// days (the same for everyone) still lean towards rain and storms
const roll = (): WeatherState => {
  const r = Math.random();
  return today().stormy ? (r < 0.35 ? 'clear' : r < 0.6 ? 'cloudy' : r < 0.82 ? 'rain' : 'storm')
    : r < 0.62 ? 'clear' : r < 0.82 ? 'cloudy' : r < 0.94 ? 'rain' : 'storm';
};
/** Seconds a state lasts: fair weather stays, showers and storms pass. */
const LASTS: Record<WeatherState, [number, number]> = { clear: [180, 360], cloudy: [120, 240], rain: [60, 150], storm: [50, 100] };
const lasts = (s: WeatherState): number => LASTS[s][0] + Math.random() * (LASTS[s][1] - LASTS[s][0]);

interface Weather {
  state: WeatherState;
  /** the state the next change switches to, and seconds until then */
  upcoming: WeatherState;
  next: number;
  /** eased intensities, 0..1 */
  rain: number; dark: number; wind: number;
  /** lightning flash brightness, and seconds to the next bolt */
  flash: number; boltT: number;
  /** wave animation clock (runs faster in wind) */
  waveT: number;
}
export const WX: Weather = { state: 'clear', upcoming: roll(), next: 150, rain: 0, dark: 0, wind: 0, flash: 0, boltT: 8, waveT: 0 };

/** Target [rain, dark, wind] per state. */
const TARGET: Record<WeatherState, [number, number, number]> = {
  clear: [0, 0, 0], cloudy: [0, 0.1, 0.2], rain: [0.6, 0.16, 0.45], storm: [1, 0.28, 1],
};

export function updateWeather(dt: number, onChange: (s: WeatherState) => void, onBolt: () => void): void {
  WX.waveT += dt * (1 + WX.wind * 1.4);
  if ((WX.next -= dt) <= 0) {
    const s = WX.upcoming;
    if (s !== WX.state) { WX.state = s; onChange(s); }
    WX.upcoming = roll();
    WX.next = lasts(WX.state);
  }
  const [rain, dark, wind] = TARGET[WX.state], k = 1 - Math.exp(-dt / 6);
  WX.rain += (rain - WX.rain) * k;
  WX.dark += (dark - WX.dark) * k;
  WX.wind += (wind - WX.wind) * k;
  WX.flash = Math.max(0, WX.flash - dt * 3);
  if (WX.state === 'storm' && WX.rain > 0.7 && (WX.boltT -= dt) <= 0) {
    WX.boltT = 10 + Math.random() * 14;
    WX.flash = 0.6;
    onBolt();
  }
}
/** Scales the wait for a bite: shorter in rain and storms, and bites come 1.6 times as fast in the hourly world frenzy... */
export const biteMul = (): number => (1 - 0.2 * WX.rain - (WX.state === 'storm' ? 0.15 : 0)) / (isWorldFrenzy() ? 1.6 : 1);
/** ...but trophies are likelier. */
export const trophyBonus = (): number => (WX.state === 'storm' ? 0.08 : 0) + WX.rain * 0.03;
/** Jump straight to a state (cheats and debugging). */
export function setWeather(s: WeatherState): void {
  WX.state = s;
  [WX.rain, WX.dark, WX.wind] = TARGET[s];
  WX.next = 200;
}

// ---------- the air of a place ----------
const ATMOS_KEYS = ['fog', 'haze', 'snow', 'ash', 'leaves', 'petals', 'spores', 'fireflies'] as const;
const atHold: ThemeHold = { theme: 'home', w: 0, jitter: 0 };
/**
 * The ambient effects at (x, y), each 0..1: the open sea's by region (snow flurries up north, warm haze down south,
 * ash over the ember isles, a little fog on kelp coasts, fireflies over the mangroves), blended into the nearest
 * island's theme as you close on it. Pure: the renderer eases toward it and adds night and weather. Fills `out`.
 */
export function atmosAt(x: number, y: number, out: Atmos): Atmos {
  const m = biomeMix(x, y), cd = coldness(y), wm = warmth(y);
  out.fog = 0.25 * m.kelp + 0.2 * cd; out.haze = 0.45 * wm * (1 - m.kelp); out.snow = 0.7 * cd * cd;
  out.ash = 0.55 * m.volcanic; out.leaves = 0; out.petals = 0; out.spores = 0; out.fireflies = 0.6 * m.mangrove;
  const h = themeHoldAt(x, y, atHold), a = THEMES[h.theme].atmos;
  if (h.w > 0) for (const k of ATMOS_KEYS) out[k] += ((a[k] ?? 0) - out[k]) * h.w;
  out.snow = Math.max(out.snow, 0.7 * cd * cd);              // the north snows whatever the island
  return out;
}
