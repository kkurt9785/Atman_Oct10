// Photos are shrunk in the browser before upload so the shared storage lasts: a 10MB phone photo becomes a few hundred KB.
// A small thumbnail is uploaded beside it so chat lists never download full photos (egress is the real cost at scale).
export const MAX_EDGE = 1600;
export const THUMB_EDGE = 320;
export const THUMB_QUALITY = 0.7;
export const SKIP_BELOW_BYTES = 400 * 1024;
export const QUALITY = 0.82;
export const isRasterImage = (type: string) => /^image\/(jpeg|png|webp)$/.test(type);
export const thumbPath = (path: string) => path.replace(/\.[^./]+$/, '') + '.thumb.jpg';

export function targetSize(width: number, height: number, maxEdge = MAX_EDGE) {
  const longest = Math.max(width, height);
  if (longest <= maxEdge) return { width, height, scaled: false };
  const ratio = maxEdge / longest;
  return { width: Math.round(width * ratio), height: Math.round(height * ratio), scaled: true };
}
export function shouldCompress(type: string, size: number) {
  return /^image\/(jpeg|png|webp)$/.test(type) && size > SKIP_BELOW_BYTES;
}
export function formatBytes(bytes: number) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

async function decode(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if ('createImageBitmap' in window) {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions); } catch { /* fall back below */ }
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('이미지를 읽지 못했어요.')); };
    img.src = url;
  });
}

function draw(source: ImageBitmap | HTMLImageElement, width: number, height: number, quality: number) {
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.resolve<Blob | null>(null);
  ctx.drawImage(source, 0, 0, width, height);
  return new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
}

// Returns the file to store (original when compression is unnecessary or would not help) and a thumbnail for raster images.
export async function prepareUpload(file: File): Promise<{ file: File; thumb: File | null }> {
  if (!isRasterImage(file.type)) return { file, thumb: null };
  let source: ImageBitmap | HTMLImageElement;
  try { source = await decode(file); } catch { return { file, thumb: null }; }
  const baseName = file.name.replace(/\.[^.]+$/, '');
  const small = targetSize(source.width, source.height, THUMB_EDGE);
  const thumbBlob = await draw(source, small.width, small.height, THUMB_QUALITY);
  const thumb = thumbBlob ? new File([thumbBlob], `${baseName}.thumb.jpg`, { type: 'image/jpeg' }) : null;
  let stored = file;
  if (shouldCompress(file.type, file.size)) {
    const { width, height, scaled } = targetSize(source.width, source.height);
    const blob = await draw(source, width, height, QUALITY);
    if (blob && (scaled || blob.size < file.size)) stored = new File([blob], `${baseName}.jpg`, { type: 'image/jpeg', lastModified: file.lastModified });
  }
  if ('close' in source) source.close();
  return { file: stored, thumb };
}
