// WCAG 2.2 relative luminance.
import { expect, test } from 'bun:test';
const css = await Bun.file(new URL('../styles/ui.css', import.meta.url)).text();
const token = (name: string): string => {
  const match = new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, 'i').exec(css);
  if (!match) throw new Error(`Missing color token: ${name}`);
  return match[1];
};
function luminance(hex: string): number {
  const rgb = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
}
function contrast(a: string, b: string): number {
  const [dark, light] = [luminance(a), luminance(b)].sort((a, b) => a - b);
  return (light + 0.05) / (dark + 0.05);
}
function brighten(hex: string, factor: number): string {
  const channels = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  return '#' + channels.map(channel => Math.min(255, Math.round(channel * factor)).toString(16).padStart(2, '0')).join('');
}

for (const name of ['paper-ink', 'paper-muted', 'paper-gold', 'paper-good', 'paper-bad', 'paper-warn']) {
  test(`${name} is readable on every parchment gradient stop`, () => {
    for (const bg of ['#f8eed6', '#e8d6ad', '#d4ba8a']) expect(contrast(token(name), bg)).toBeGreaterThanOrEqual(4.5);
  });
}
test('button labels are readable at both ends of their shared gradient, including hover', () => {
  const hover = Number(/\.btn:hover\s*\{\s*filter:\s*brightness\(([\d.]+)\)/.exec(css)?.[1]);
  expect(Number.isFinite(hover)).toBe(true);
  for (const bg of ['button-hi', 'button-lo']) for (const k of [1, hover]) {
    expect(contrast(brighten('#fff6dc', k), brighten(token(bg), k))).toBeGreaterThanOrEqual(4.5);
  }
});
