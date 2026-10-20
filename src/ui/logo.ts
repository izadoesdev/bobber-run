// Island logos: any picture the player picks becomes a small pixel-art flag. It's fitted into 32x32 (keeping its
// shape), the colours are stepped to a few levels per channel, and see-through pixels are made fully clear, so every
// logo matches the game's look and the upload stays a few kilobytes.
const LOGO_PX = 32, LEVELS = 6, MAX_BYTES = 16_000;

export interface Logo { blob: Blob; url: string }
export async function pixelLogo(file: Blob): Promise<Logo | { why: string }> {
  if (!file.type.startsWith('image/')) return { why: 'Pick an image file (PNG, JPG, GIF or WebP)' };
  let img: ImageBitmap;
  try { img = await createImageBitmap(file); } catch { return { why: 'That image could not be read' }; }
  const c = document.createElement('canvas');
  c.width = c.height = LOGO_PX;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  const k = Math.min(LOGO_PX / img.width, LOGO_PX / img.height), w = Math.max(1, Math.round(img.width * k)), h = Math.max(1, Math.round(img.height * k));
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, Math.floor((LOGO_PX - w) / 2), Math.floor((LOGO_PX - h) / 2), w, h);
  img.close();
  const d = ctx.getImageData(0, 0, LOGO_PX, LOGO_PX), px = d.data, step = 255 / (LEVELS - 1);
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] < 128) { px[i] = px[i + 1] = px[i + 2] = px[i + 3] = 0; continue; }
    for (let ch = 0; ch < 3; ch++) px[i + ch] = Math.round(px[i + ch] / step) * step;
    px[i + 3] = 255;
  }
  ctx.putImageData(d, 0, 0);
  const blob = await new Promise<Blob | null>(res => c.toBlob(res, 'image/png'));
  if (!blob) return { why: 'That image could not be converted' };
  if (blob.size > MAX_BYTES) return { why: 'That image is too detailed. Try a simpler logo' };
  return { blob, url: URL.createObjectURL(blob) };
}
