// 초대 근무 지급 명세 — 사장님 앱(apps/admin-web/lib/pay-statement.ts)과 같은 문장을 만든다. 바꾸면 양쪽 같이.
export type PayoutStatement = {
  facilityName: string; workerName: string; periodStart: string; periodEnd: string;
  workedDays: number; workedMinutes: number; payBasis: string; payRate: number;
  amount: number; withholdingAmount: number; netAmount: number;
  status: 'scheduled' | 'paid' | 'cancelled'; payAt: string | null; paidAt: string | null;
};

export const won = (value: number) => `${Math.round(value).toLocaleString('ko-KR')}원`;
export const hoursText = (minutes: number) => `${Math.floor(minutes / 60)}시간${minutes % 60 ? ` ${minutes % 60}분` : ''}`;
export const periodText = (start: string, end: string) => (start === end ? start : `${start} ~ ${end}`);

// 휴게: 행에 적힌 값이 있으면 그대로, 없으면(옛 기록) 4시간 이상일 때만 근무자 기본 휴게 — 사장님 앱 정산과 같은 규칙
export function effectiveBreakMinutes(workedMinutes: number, rowBreak: number | null | undefined, staffDefault: number | null | undefined) {
  const explicit = Number(rowBreak ?? 0);
  if (explicit > 0) return Math.min(explicit, workedMinutes);
  if (workedMinutes < 240) return 0;
  return Math.min(Number(staffDefault ?? 0), workedMinutes);
}

export function statementText(s: PayoutStatement) {
  const basis = s.payBasis === 'hourly' ? `시급 ${won(s.payRate)} × ${hoursText(s.workedMinutes)}`
    : s.payBasis === 'daily' ? `일급 ${won(s.payRate)} × ${s.workedDays}일`
    : `월 정액 ${won(s.payRate)}`;
  const when = s.status === 'paid' ? `${(s.paidAt ?? s.payAt ?? '').slice(0, 10)} 지급 완료` : `${s.payAt ?? ''} 지급 예정`;
  return [
    `[잇닿 지급 명세] ${s.facilityName}`,
    `근무자: ${s.workerName}`,
    `기간: ${periodText(s.periodStart, s.periodEnd)} (${s.workedDays}일 · ${hoursText(s.workedMinutes)})`,
    `${basis} = 세전 ${won(s.amount)}`,
    s.withholdingAmount > 0 ? `공제: 사업소득 3.3% −${won(s.withholdingAmount)}` : '공제: 없음',
    `실지급: ${won(s.netAmount)} (${when})`,
    '잇닿(itdot.co.kr)에 기록된 출퇴근으로 계산했어요.',
  ].join('\n');
}

// 공유 시트가 있으면 공유, 없으면 복사. 돌려주는 문구를 화면에 잠깐 보여 준다
export async function sharePayoutStatement(s: PayoutStatement): Promise<string> {
  const text = statementText(s);
  if (typeof navigator !== 'undefined' && navigator.share) {
    try { await navigator.share({ title: '잇닿 지급 명세', text }); return ''; } catch { return ''; }
  }
  try { await navigator.clipboard.writeText(text); return '명세를 복사했어요'; } catch { return '복사하지 못했어요'; }
}
