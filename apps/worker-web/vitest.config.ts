import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// 순수 규칙(셸 판정·알림 분류)만 검사한다. 화면·Supabase 는 vi.mock 으로 끊는다.
export default defineConfig({
  test: { environment: 'node', include: ['lib/**/*.test.ts'] },
  resolve: { alias: { '@': fileURLToPath(new URL('.', import.meta.url)) } },
});
