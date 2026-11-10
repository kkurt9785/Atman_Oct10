import type { StaffWagePaymentRow } from './db/payroll';

export function staffExportAmounts(row: Pick<StaffWagePaymentRow, 'saved' | 'status' | 'needsProration' | 'grossAmount' | 'netAmount'>) {
  const confirmed = row.saved && ['approved', 'exported', 'paid'].includes(row.status);
  return {
    gross: row.grossAmount,
    net: confirmed ? row.netAmount : '',
    basis: confirmed ? '확정' : row.status === 'config_required' ? '급여 기준 설정 필요'
      : row.needsProration ? '일할계산 필요 · 기준 월급(지급액 아님)' : '검토 전 · 예상액(지급액 아님)',
  };
}

// 급여 CSV(검토·세무 전달용). 내부 ID 열은 빼고 상태는 화면과 같은 한글로, 직원 행에는 한 달 근태 요약을 붙인다(2026-11-10 치과원장 QA)
export const PAYROLL_EXPORT_HEADER = ['구분', '급여 기간·근무일', '대상자', '근무시간', '출근일수', '지각(회)', '조퇴(회)', '결근(일)', '휴가 사용(일)', '급여 미반영 기록(건)', '세전 예상액', '지급 예정액', '공제 확인', '지급 상태', '지급 예정일', '은행', '계좌 끝 4자리', '지급 완료일', '금액 검토 기준'];

export const PAYROLL_STATUS_LABEL: Record<string, string> = { collecting: '집계 중', draft: '검토 전', approved: '지급 승인', exported: '이체 준비', paid: '지급 완료', worker_confirmed: '입금 확인', disputed: '확인 요청', cancelled: '취소', config_required: '급여 기준 설정 필요' };
export const DEDUCTION_STATUS_LABEL: Record<string, string> = { unconfirmed: '미확정 · 사업장 확인 필요', confirmed: '사업장 확인', hospital_confirmed: '사업장 확인', not_applicable: '해당 없음' };

export type StaffExportStats = { attendDays: number; lateCount: number; earlyLeaveCount: number; absentDays: number };

// 휴가 사용일: 승인된 휴가 시간을 8시간 = 1일로 바꿔 소수 첫째 자리까지
export function leaveDaysText(minutes: number): number {
  return Math.round((Math.max(0, minutes) / 480) * 10) / 10;
}

export function staffExportRow(
  row: Pick<StaffWagePaymentRow, 'saved' | 'status' | 'needsProration' | 'grossAmount' | 'netAmount' | 'periodMonth' | 'workerName' | 'workedMinutes' | 'excludedRecords' | 'bankName' | 'accountLast4'>,
  stats: StaffExportStats | undefined,
  leaveMinutes: number,
): Array<string | number> {
  const amounts = staffExportAmounts(row);
  return [
    '사업장 등록 직원', row.periodMonth.slice(0, 7), row.workerName,
    `${Math.floor(row.workedMinutes / 60)}시간 ${row.workedMinutes % 60}분`,
    stats?.attendDays ?? 0, stats?.lateCount ?? 0, stats?.earlyLeaveCount ?? 0, stats?.absentDays ?? 0, leaveDaysText(leaveMinutes), row.excludedRecords,
    amounts.gross, amounts.net, '사업장 확인 필요', PAYROLL_STATUS_LABEL[row.status] ?? row.status, '', row.bankName ?? '', row.accountLast4 ?? '', '', amounts.basis,
  ];
}

export function shiftExportRow(row: {
  shiftDate?: string | null; startTime?: string | null; endTime?: string | null; workerName?: string | null;
  grossAmount: number; netAmount: number; deductionStatus: string; status: string; dueDate?: string | null;
  bankName?: string | null; accountLast4?: string | null; paidDate: string;
}): Array<string | number> {
  return [
    '공고 지원 인력', row.shiftDate ?? '', row.workerName ?? '근무자',
    `${row.startTime?.slice(0, 5) ?? ''}~${row.endTime?.slice(0, 5) ?? ''}`,
    '', '', '', '', '', '',
    row.grossAmount, row.netAmount, DEDUCTION_STATUS_LABEL[row.deductionStatus] ?? row.deductionStatus, PAYROLL_STATUS_LABEL[row.status] ?? row.status,
    row.dueDate ?? '', row.bankName ?? '', row.accountLast4 ?? '', row.paidDate, '저장된 지급 요청 · 지급상태 확인',
  ];
}
