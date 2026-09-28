import { describe, expect, it, vi } from 'vitest';

// worker-mode 는 모듈 상단에서 supabase 클라이언트를 만든다 — 규칙만 검사하므로 끊는다
vi.mock('@/lib/supabase', () => ({ supabase: {} }));

import {
  GIGWORKER_SOURCE, hasMedicalContext, isMedicalShellPath, resolveWorkerShell,
} from '@/lib/worker-mode';

const GIG = GIGWORKER_SOURCE;
const HOSPITAL = 'self_hospital';

describe('resolveWorkerShell — 셸 판정 규칙', () => {
  it('긱 근무지가 없으면 무조건 의료 셸 (선호값 무시)', () => {
    expect(resolveWorkerShell([], 'rn', true)).toBe('medical');
    expect(resolveWorkerShell([HOSPITAL], 'other', true)).toBe('medical');
    expect(resolveWorkerShell([], null, true)).toBe('medical');
  });
  it('긱 근무지만 있고 의료 근거가 없으면 무조건 긱 셸 (선호값 무시)', () => {
    expect(resolveWorkerShell([GIG], 'other', false)).toBe('gig');
    expect(resolveWorkerShell([GIG], null, false)).toBe('gig');
  });
  it('둘 다면 마지막에 쓴 셸', () => {
    expect(resolveWorkerShell([GIG], 'rn', true)).toBe('gig');
    expect(resolveWorkerShell([GIG], 'rn', false)).toBe('medical');
    expect(resolveWorkerShell([GIG, HOSPITAL], 'other', true)).toBe('gig');
    expect(resolveWorkerShell([GIG, HOSPITAL], 'other', false)).toBe('medical');
  });
});

describe('hasMedicalContext — 의료 셸을 쓸 근거', () => {
  it("직군 'other' 는 근거가 아니다 (초대 간편가입)", () => {
    expect(hasMedicalContext([GIG], 'other')).toBe(false);
    expect(hasMedicalContext([], 'other')).toBe(false);
  });
  it('의료 직군이거나 병원·약국에 직원으로 연결되면 근거', () => {
    expect(hasMedicalContext([GIG], 'rn')).toBe(true);
    expect(hasMedicalContext([GIG, HOSPITAL], 'other')).toBe(true);
    expect(hasMedicalContext([], 'pharmacist')).toBe(true);
  });
});

describe('isMedicalShellPath — 가드 대상 경로', () => {
  it('로그인 필요한 의료 셸 경로만 가드한다', () => {
    for (const path of ['/home', '/settings/profile', '/workplace', '/workroom?facility=x', '/notifications', '/chat/abc']) {
      expect(isMedicalShellPath(path.split('?')[0])).toBe(true);
    }
  });
  it('둘러보기·초대 수락·긱 경로는 가드하지 않는다', () => {
    for (const path of ['/shifts', '/map', '/jobs/1', '/workplace/join', '/gig', '/gig/workroom', '/', '/homework']) {
      expect(isMedicalShellPath(path)).toBe(false);
    }
  });
});
