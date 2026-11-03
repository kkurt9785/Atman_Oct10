import { describe, expect, it } from 'vitest';
import { computeStage, shortcutImportURL, stageLabel } from './autocollect';

describe('auto-collect stage machine', () => {
  const base = { device: 'iphone-push' as const, installed: false, paired: false, collecting: false };
  it('walks install → pair → waiting → collecting with no confirmation stage in between', () => {
    expect(computeStage(base)).toBe('install');
    expect(computeStage({ ...base, installed: true })).toBe('pair');
    expect(computeStage({ ...base, installed: true, paired: true })).toBe('waiting');
    expect(computeStage({ ...base, collecting: true })).toBe('collecting');
  });
  it('opens the Shortcuts add sheet directly for an iCloud link, and chains back to /pair when given an origin', () => {
    expect(shortcutImportURL('https://www.icloud.com/shortcuts/273c25287f24405b913d5237fd9f5168')).toBe('shortcuts://import-shortcut?url=https%3A%2F%2Fwww.icloud.com%2Fshortcuts%2F273c25287f24405b913d5237fd9f5168');
    const chained = new URL(shortcutImportURL('https://www.icloud.com/shortcuts/273c25287f24405b913d5237fd9f5168', 'https://haraguri.vercel.app'));
    expect(chained.protocol + chained.host + chained.pathname).toBe('shortcuts:x-callback-url/import-shortcut');
    expect(chained.searchParams.get('x-success')).toBe('https://haraguri.vercel.app/pair');
    expect(chained.searchParams.get('x-cancel')).toBe('https://haraguri.vercel.app/?tab=money&collect=1');
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
