import { describe, expect, it } from 'vitest';
import { parseDemoSelection } from '@/app/intro/demo-selection-params';

describe('/intro ?role=&kind= — 서버가 첫 HTML 을 맞추는 해석 (10/20 P0 · GPT 10/23 #2)', () => {
  it('근무자 QR 은 처음부터 근무자 선택', () => {
    expect(parseDemoSelection('worker', 'gigworker')).toEqual({ role: 'worker', kind: 'gigworker' });
    expect(parseDemoSelection('WORKER', ' Pharmacy ')).toEqual({ role: 'worker', kind: 'pharmacy' });
    expect(parseDemoSelection(['worker', 'admin'], ['care'])).toEqual({ role: 'worker', kind: 'care' });
  });
  it('없거나 모르는 값은 기존 기본값(관리자·병원)', () => {
    expect(parseDemoSelection(undefined, undefined)).toEqual({ role: 'admin', kind: 'hospital' });
    expect(parseDemoSelection('owner', 'clinic')).toEqual({ role: 'admin', kind: 'hospital' });
  });
});
