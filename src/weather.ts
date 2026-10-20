// Weather: clear / cloudy / rain / storm with smooth transitions, gusts and lightning.
import type { WeatherState } from './types';

const roll = (): WeatherState => {
  const r = Math.random();
  return r < 0.45 ? 'clear' : r < 0.65 ? 'cloudy' : r < 0.88 ? 'rain' : 'storm';
};

export interface Weather {
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
  clear: [0, 0, 0], cloudy: [0, 0.14, 0.2], rain: [0.6, 0.22, 0.45], storm: [1, 0.36, 1],
};

export function updateWeather(dt: number, onChange: (s: WeatherState) => void, onBolt: () => void): void {
  WX.waveT += dt * (1 + WX.wind * 1.4);
  if ((WX.next -= dt) <= 0) {
    const s = WX.upcoming;
    if (s !== WX.state) { WX.state = s; onChange(s); }
    WX.upcoming = roll();
    WX.next = 90 + Math.random() * 150;
  }
  const [rain, dark, wind] = TARGET[WX.state], k = 1 - Math.exp(-dt / 6);
  WX.rain += (rain - WX.rain) * k;
  WX.dark += (dark - WX.dark) * k;
  WX.wind += (wind - WX.wind) * k;
  WX.flash = Math.max(0, WX.flash - dt * 3);
  if (WX.state === 'storm' && WX.rain > 0.7 && (WX.boltT -= dt) <= 0) {
    WX.boltT = 5 + Math.random() * 10;
    WX.flash = 1;
    onBolt();
  }
}
/** Bites come slower in rain and storms... */
export const biteMul = (): number => 1 - 0.2 * WX.rain - (WX.state === 'storm' ? 0.15 : 0);
/** ...but trophies are likelier. */
export const trophyBonus = (): number => (WX.state === 'storm' ? 0.08 : 0) + WX.rain * 0.03;
/** Jump straight to a state (cheats and debugging). */
export function setWeather(s: WeatherState): void {
  WX.state = s;
  [WX.rain, WX.dark, WX.wind] = TARGET[s];
  WX.next = 200;
}
