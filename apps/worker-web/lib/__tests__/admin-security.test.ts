import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../../admin-web/lib/admin-auth', () => ({ getAdminSession: vi.fn() }));
import { isPlatformAdminUser } from '../../../admin-web/lib/platform-admin';

afterEach(() => vi.unstubAllEnvs());
describe('플랫폼 관리자 시연 격리', () => {
  it('ID와 이메일 허용 목록에 동시에 있어도 시연 계정은 거부한다', () => {
    vi.stubEnv('PLATFORM_ADMIN_USER_IDS', 'demo-id');
    vi.stubEnv('PLATFORM_ADMIN_EMAILS', 'sales@demo.atman.co.kr');
    expect(isPlatformAdminUser({ id: 'demo-id', email: 'SALES@DEMO.ATMAN.CO.KR' })).toBe(false);
  });
  it('실제 운영자 이메일·이메일 없는 지정 계정은 허용한다', () => {
    vi.stubEnv('PLATFORM_ADMIN_EMAILS', 'owner@example.invalid');
    vi.stubEnv('PLATFORM_ADMIN_USER_IDS', 'owner-id');
    expect(isPlatformAdminUser({ id: 'id', email: 'OWNER@example.invalid' })).toBe(true);
    expect(isPlatformAdminUser({ id: 'owner-id' })).toBe(true);
    expect(isPlatformAdminUser({ id: 'outsider' })).toBe(false);
    expect(isPlatformAdminUser(null)).toBe(false);
  });
});
