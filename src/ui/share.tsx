// Sharing a catch worth showing off: a picture card (the fish, its name and weight, stars, variant, who caught it
// and where to play) sent through the device's share sheet, or, where that can't take a file, the link copied and the
// picture downloaded. The card offers it while it shows, and a small chip keeps the offer for a while afterwards.
import { G } from '../game';
import { NET } from '../net';
import { SPECIES, fmtKg } from '../econ';
import { VARIANTS, type VariantId } from '../species';
import { toast } from '../game/feedback';
import { track } from '../analytics';
import type { CatchCard } from '../types';
import { fishIcon } from './icons';
import { Fish } from './parts';

type Why = 'legend' | 'variant' | 'stars' | 'first' | 'record';
/** Why a catch is worth sharing (the best reason), or null if it's an everyday fish. */
function shareWhy(c: CatchCard): Why | null {
  const sp = SPECIES[c.fish.sp];
  return sp.legend ? 'legend' : c.fish.variant ? 'variant' : (c.stars ?? 0) >= 2 ? 'stars' : c.first ? 'first' : c.record ? 'record' : null;
}
const variantName = (v?: string): string | null => v ? VARIANTS[v as VariantId]?.name ?? v : null;
const byName = (): string => NET.profile?.name || 'a captain';

/** The link that opens the game on this catch (the game reads it on load). */
function link(c: CatchCard): string {
  const q = new URLSearchParams({ catch: SPECIES[c.fish.sp].id, v: c.fish.variant ?? '', kg: String(c.fish.kg), at: `${Math.round(G.boat.x)},${Math.round(G.boat.y)}`, by: byName() });
  return `${location.origin}/?${q}`;
}
const load = (src: string) => new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });

/** The share picture, 1200x630 (the size link previews use): parchment, the fish large, its details, the byline. */
async function picture(c: CatchCard): Promise<Blob> {
  const W = 1200, H = 630, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d')!, sp = SPECIES[c.fish.sp], v = variantName(c.fish.variant);
  await Promise.all(['32px Jersey', '700 64px Pixelify', '600 44px Pixelify', '400 28px Pixelify'].map(f => document.fonts.load(f).catch(() => [])));   // faces load lazily: fetch the ones drawn
  g.fillStyle = '#2a1f17'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#efe3c4'; g.fillRect(24, 24, W - 48, H - 48);
  g.strokeStyle = '#a87a3a'; g.lineWidth = 6; g.strokeRect(40, 40, W - 80, H - 80);
  const fish = await load(fishIcon(c.fish.sp)), s = Math.min(420 / fish.width, 300 / fish.height);
  g.imageSmoothingEnabled = false;
  g.drawImage(fish, 80, H / 2 - fish.height * s / 2 - 10, fish.width * s, fish.height * s);
  const x = 560;
  g.fillStyle = '#7a5530'; g.font = '32px Jersey, monospace'; g.fillText('BOBBER RUN', x, 120);
  g.fillStyle = sp.legend ? '#a8761e' : '#2a1f17'; g.font = '700 64px Pixelify, monospace'; g.fillText((v ? v + ' ' : '') + sp.name, x, 210, W - x - 70);
  g.fillStyle = '#3a2c20'; g.font = '600 44px Pixelify, monospace'; g.fillText(fmtKg(c.fish.kg), x, 280);
  if (c.stars) { g.fillStyle = '#c49a32'; g.font = '700 54px Pixelify, monospace'; g.fillText('★'.repeat(c.stars) + '☆'.repeat(3 - c.stars), x, 350); }
  const tags = [sp.legend && 'Legendary', c.first && 'New species', c.record && 'Personal best', c.fish.trophy && 'Trophy', c.fish.gold && 'Golden'].filter(Boolean) as string[];
  let tx = x;
  g.font = '600 26px Pixelify, monospace';
  for (const t of tags) {
    const w = g.measureText(t).width + 28;
    g.fillStyle = '#2a1f17'; g.fillRect(tx, 380, w, 44); g.fillStyle = '#f0cf6a'; g.fillText(t, tx + 14, 411);
    tx += w + 12;
  }
  g.fillStyle = '#3a2c20'; g.font = '600 30px Pixelify, monospace'; g.fillText(`Caught by ${byName()}`, x, 490, W - x - 70);
  g.fillStyle = '#7a5530'; g.font = '28px Pixelify, monospace'; g.fillText(location.host || 'bobber.databuddy.cc', x, 545);
  return new Promise((res, rej) => cv.toBlob(b => b ? res(b) : rej(new Error('no image')), 'image/png'));
}

let busy = false;
async function share(c: CatchCard): Promise<void> {
  if (busy) return;
  busy = true;
  try {
    const sp = SPECIES[c.fish.sp], v = variantName(c.fish.variant), url = link(c);
    const text = `I caught a ${fmtKg(c.fish.kg)} ${v ? v + ' ' : ''}${sp.name} in Bobber Run!`;
    const blob = await picture(c), file = new File([blob], `bobber-run-${sp.id}.png`, { type: 'image/png' });
    let how: 'native' | 'copy' = 'copy';
    if (navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file], text, url }); how = 'native'; } catch { return; }   // closing the sheet isn't a share
    } else {
      try { await navigator.clipboard.writeText(`${text} ${url}`); } catch { /* no clipboard: the picture still saves */ }
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = file.name; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      toast('Link copied and picture saved', 'good');
    }
    track('share_clicked', { species: sp.id, how, why: shareWhy(c) ?? 'record', ...(c.stars && { stars: c.stars }), ...(c.fish.variant && { variant: c.fish.variant }) });
  } finally { busy = false; }
}

// the last catch worth sharing, offered by a chip for a while after its card goes
const OFFER_S = 15;
let offer: { c: CatchCard; until: number } | null = null;
/** The Share button on the catch card (only for catches worth sharing). */
export function ShareButton({ c }: { c: CatchCard }) {
  if (!shareWhy(c)) return null;
  if (offer?.c !== c) offer = { c, until: G.t + OFFER_S + 8 };
  return <button data-track="share-card" class="btn small-btn share" onClick={() => void share(c)}>Share ↗</button>;
}
/** After the card: a small chip to share it still. */
export function ShareChip() {
  if (!offer || G.card || G.t > offer.until || G.mode !== 'play') return null;
  const c = offer.c;
  return (
    <button data-track="share-chip" class="chip share-chip" onClick={() => void share(c)}>
      <Fish sp={c.fish.sp} size="s" /><span>Share your {variantName(c.fish.variant) ? variantName(c.fish.variant) + ' ' : ''}{SPECIES[c.fish.sp].name}</span><span class="gold">↗</span>
    </button>
  );
}
