import { describe, expect, it } from 'vitest';
import { csvCell } from '../../../admin-web/lib/csv';

// 2026-11-05 병원 QA P2 — 근태·급여 CSV 내보내기에서 이름·사유가 수식으로 실행되지 않게
describe('CSV 수식 주입 방어', () => {
  it.each(['=HYPERLINK("http://evil.test","클릭")', '+1+2', '-2+3', '@SUM(A1)', '\t=1', '\r=1'])('%s 앞에 따옴표를 붙인다', (value) => {
    expect(csvCell(value).startsWith(`"'`)).toBe(true);
  });
  it('따옴표는 두 번 써서 감싼다', () => {
    expect(csvCell('=A1&"x"')).toBe(`"'=A1&""x"""`);
  });
  it('보통 글자·빈 값·숫자는 그대로 둔다', () => {
    expect(csvCell('김민서')).toBe('"김민서"');
    expect(csvCell(null)).toBe('""');
    expect(csvCell(-1500)).toBe('"-1500"');
    expect(csvCell(0)).toBe('"0"');
  });
});
