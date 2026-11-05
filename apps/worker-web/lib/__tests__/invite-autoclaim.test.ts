import { describe, expect, it } from 'vitest';
import { INVITE_AUTOCLAIM_KEY, INVITE_AUTOCLAIM_TTL_MS, clearInviteAutoclaim, hasInviteAutoclaim, rememberInviteAutoclaim } from '../invite-autoclaim';

function memory() {
  const map = new Map<string, string>();
  return { map, getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => void map.set(key, value), removeItem: (key: string) => void map.delete(key) };
}
const A = '20261105-0000-4000-8000-00000000000a';
const B = '20261105-0000-4000-8000-00000000000b';

describe('초대 자동 수락 표시', () => {
  it('누른 그 초대만, 남아 있는 동안 true (읽기만으로는 지우지 않는다)', () => {
    const storage = memory();
    rememberInviteAutoclaim(A, storage, 1_000);
    expect(hasInviteAutoclaim(A, storage, 1_000 + 60_000)).toBe(true);
    expect(storage.map.has(INVITE_AUTOCLAIM_KEY)).toBe(true);
    clearInviteAutoclaim(storage);
    expect(hasInviteAutoclaim(A, storage, 2_000)).toBe(false);
  });
  it('다른 초대를 열면 false 이고 표시를 지운다', () => {
    const storage = memory();
    rememberInviteAutoclaim(A, storage, 1_000);
    expect(hasInviteAutoclaim(B, storage, 2_000)).toBe(false);
    expect(storage.map.has(INVITE_AUTOCLAIM_KEY)).toBe(false);
    expect(hasInviteAutoclaim(A, storage, 2_000)).toBe(false);
  });
  it('30분이 지나면 false 이고 지운다 (시계가 거꾸로여도 false)', () => {
    const storage = memory();
    rememberInviteAutoclaim(A, storage, 1_000);
    expect(hasInviteAutoclaim(A, storage, 1_000 + INVITE_AUTOCLAIM_TTL_MS)).toBe(true);
    expect(hasInviteAutoclaim(A, storage, 1_001 + INVITE_AUTOCLAIM_TTL_MS)).toBe(false);
    expect(storage.map.size).toBe(0);
    rememberInviteAutoclaim(A, storage, 5_000);
    expect(hasInviteAutoclaim(A, storage, 4_000)).toBe(false);
  });
  it('깨진 표시·저장소 없음은 false', () => {
    const storage = memory();
    storage.setItem(INVITE_AUTOCLAIM_KEY, '{oops');
    expect(hasInviteAutoclaim(A, storage)).toBe(false);
    expect(storage.map.size).toBe(0);
    expect(hasInviteAutoclaim(A, null)).toBe(false);
    const throwing = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem: () => { throw new Error('blocked'); } };
    expect(() => rememberInviteAutoclaim(A, throwing)).not.toThrow();
    expect(hasInviteAutoclaim(A, throwing)).toBe(false);
  });
});
