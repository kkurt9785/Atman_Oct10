import { describe, expect, it } from 'vitest';
import { computeStage, stageLabel } from './autocollect';

describe('auto-collect stage machine', () => {
  const base = { device: 'iphone-push' as const, installed: false, paired: false, collecting: false };
  it('walks install → pair → waiting → collecting with no confirmation stage in between', () => {
    expect(computeStage(base)).toBe('install');
    expect(computeStage({ ...base, installed: true })).toBe('pair');
    expect(computeStage({ ...base, installed: true, paired: true })).toBe('waiting');
    expect(computeStage({ ...base, collecting: true })).toBe('collecting');
  });
  it('a paired or collecting phone never falls back to install prompts', () => {
    expect(computeStage({ ...base, paired: true })).toBe('waiting');
    expect(computeStage({ ...base, device: 'galaxy', collecting: true })).toBe('collecting');
  });
  it('other devices get their own recipe stage', () => {
    expect(computeStage({ ...base, device: 'iphone-sms' })).toBe('other');
    expect(computeStage({ ...base, device: 'galaxy', paired: true })).toBe('other');
  });
  it('labels say off until the first payment is collected', () => {
    expect(stageLabel('pair', null, 0).off).toBe(true);
    expect(stageLabel('waiting', null, 0)).toEqual({ text: '연결됨 ✓ · 첫 결제 알림 기다리는 중', off: false });
    expect(stageLabel('collecting', new Date(Date.now() - 120_000).toISOString(), 25).text).toBe('수집 중 ✓ · 마지막 2분 전 · 25건 저장');
  });
});
