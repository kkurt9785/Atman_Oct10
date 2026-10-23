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
