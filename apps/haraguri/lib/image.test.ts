import { describe, expect, it } from 'vitest';
import { formatBytes, shouldCompress, targetSize, thumbPath, MAX_EDGE, SKIP_BELOW_BYTES, THUMB_EDGE } from './image';

describe('photo shrinking before upload', () => {
  it('scales the longest edge to the limit and keeps the aspect ratio', () => {
    expect(targetSize(4000, 3000)).toEqual({ width: 1600, height: 1200, scaled: true });
    expect(targetSize(3000, 4000)).toEqual({ width: 1200, height: 1600, scaled: true });
    expect(targetSize(1200, 800)).toEqual({ width: 1200, height: 800, scaled: false });
    expect(targetSize(MAX_EDGE, MAX_EDGE).scaled).toBe(false);
  });
  it('only compresses large raster images, never documents or small files', () => {
    expect(shouldCompress('image/jpeg', SKIP_BELOW_BYTES + 1)).toBe(true);
    expect(shouldCompress('image/png', 5 * 1024 * 1024)).toBe(true);
    expect(shouldCompress('image/jpeg', SKIP_BELOW_BYTES)).toBe(false);
    expect(shouldCompress('application/pdf', 9 * 1024 * 1024)).toBe(false);
    expect(shouldCompress('image/gif', 9 * 1024 * 1024)).toBe(false);
  });
  it('derives a thumbnail path beside the photo inside the same family folder', () => {
    expect(thumbPath('fam/user/abc.jpg')).toBe('fam/user/abc.thumb.jpg');
    expect(thumbPath('fam/user/abc.webp')).toBe('fam/user/abc.thumb.jpg');
    expect(thumbPath('fam/user/noext')).toBe('fam/user/noext.thumb.jpg');
    expect(targetSize(4000, 3000, THUMB_EDGE)).toEqual({ width: 320, height: 240, scaled: true });
  });
  it('formats storage usage for the settings screen', () => {
    expect(formatBytes(0)).toBe('1 KB');
    expect(formatBytes(512 * 1024)).toBe('512 KB');
    expect(formatBytes(1.5 * 1024 * 1024)).toBe('1.5 MB');
    expect(formatBytes(1024 ** 3)).toBe('1.00 GB');
  });
});
