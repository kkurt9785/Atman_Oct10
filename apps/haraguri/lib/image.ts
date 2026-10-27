// Photos are shrunk in the browser before upload so the shared storage lasts: a 10MB phone photo becomes a few hundred KB.
export const MAX_EDGE = 1600;
export const SKIP_BELOW_BYTES = 400 * 1024;
export const QUALITY = 0.82;

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

// Returns the original file when compression is unnecessary or would not help.
export async function prepareUpload(file: File): Promise<File> {
  if (!shouldCompress(file.type, file.size)) return file;
  let source: ImageBitmap | HTMLImageElement;
  try { source = await decode(file); } catch { return file; }
  const { width, height, scaled } = targetSize(source.width, source.height);
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return file;
  ctx.drawImage(source, 0, 0, width, height);
  if ('close' in source) source.close();
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', QUALITY));
  if (!blob || (!scaled && blob.size >= file.size)) return file;
  const name = file.name.replace(/\.[^.]+$/, '') + '.jpg';
  return new File([blob], name, { type: 'image/jpeg', lastModified: file.lastModified });
}
