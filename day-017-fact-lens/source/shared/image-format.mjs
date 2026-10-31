// Only raster formats handled by the bitmap decoder. Never treat HTML/SVG as an image.
export function rasterMime(bytes) {
  if (bytes.length >= 8 && [137,80,78,71,13,10,26,10].every((value, i) => bytes[i] === value)) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  const ascii = (start, end) => String.fromCharCode(...bytes.slice(start, end));
  if (bytes.length >= 6 && ['GIF87a','GIF89a'].includes(ascii(0, 6))) return 'image/gif';
  if (bytes.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  return null;
}
