import { describe, expect, it } from 'vitest';
import { formatBytes, shouldCompress, targetSize, MAX_EDGE, SKIP_BELOW_BYTES } from './image';

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
  it('formats storage usage for the settings screen', () => {
    expect(formatBytes(0)).toBe('1 KB');
    expect(formatBytes(512 * 1024)).toBe('512 KB');
    expect(formatBytes(1.5 * 1024 * 1024)).toBe('1.5 MB');
    expect(formatBytes(1024 ** 3)).toBe('1.00 GB');
  });
});
