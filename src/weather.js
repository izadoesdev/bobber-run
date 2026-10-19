// Weather: clear / cloudy / rain / storm with smooth transitions, gusts and lightning.
const roll = () => { const r = Math.random(); return r < 0.45 ? 'clear' : r < 0.65 ? 'cloudy' : r < 0.88 ? 'rain' : 'storm'; };
export const WX = { state: 'clear', upcoming: roll(), next: 150, rain: 0, dark: 0, wind: 0, flash: 0, boltT: 8, waveT: 0 };
const TARGET = { clear: [0, 0, 0], cloudy: [0, 0.14, 0.2], rain: [0.6, 0.22, 0.45], storm: [1, 0.36, 1] }; // rain, dark, wind
export function updateWeather(dt, onChange, onBolt) {
  WX.waveT += dt * (1 + WX.wind * 1.4);
  if ((WX.next -= dt) <= 0) {
    const s = WX.upcoming;
    if (s !== WX.state) { WX.state = s; onChange(s); }
    WX.upcoming = roll(); WX.next = 90 + Math.random() * 150;
  }
  const t = TARGET[WX.state], k = 1 - Math.exp(-dt / 6);
  WX.rain += (t[0] - WX.rain) * k; WX.dark += (t[1] - WX.dark) * k; WX.wind += (t[2] - WX.wind) * k;
  WX.flash = Math.max(0, WX.flash - dt * 3);
  if (WX.state === 'storm' && WX.rain > 0.7 && (WX.boltT -= dt) <= 0) { WX.boltT = 5 + Math.random() * 10; WX.flash = 1; onBolt(); }
}
export const biteMul = () => 1 - 0.2 * WX.rain - (WX.state === 'storm' ? 0.15 : 0);
export const trophyBonus = () => (WX.state === 'storm' ? 0.08 : 0) + WX.rain * 0.03;
export function setWeather(s) { WX.state = s; const t = TARGET[s]; WX.rain = t[0]; WX.dark = t[1]; WX.wind = t[2]; WX.next = 200; }
