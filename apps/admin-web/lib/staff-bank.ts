// 직원 지급 계좌 표시 규칙 (2026-11-12 계좌 검토 ①).
// - 앱으로 연결된 직원: 근무자가 자기 앱 [내 정보 › 지급 계좌]에 등록한 계좌가 기준이다.
//   예전엔 '급여 기준 저장'을 누를 때 한 번 복사한 사본을 보여 줘, 근무자가 계좌를 바꿔도 옛 계좌가 "확인됨"으로 남았다.
// - 연결 안 된 직원: 사업장이 넣은 은행·계좌 끝 4자리(확인용, 선택). 전체 계좌번호는 받지 않는다.

/** 근무자 앱(BankAccount.tsx)과 같은 은행 이름 — 직접 입력하면 '국민'·'KB국민은행'처럼 표기가 갈렸다. */
export const STAFF_BANKS = [
  'KB국민', '신한', '하나', '우리', 'NH농협', 'IBK기업', '카카오뱅크', '토스뱅크', '케이뱅크',
  '새마을금고', '신협', '우체국', '수협', 'SC제일', '씨티', '산업',
  'iM뱅크(대구)', '부산', '경남', '광주', '전북', '제주',
] as const;

export type StaffBankSource = 'worker' | 'facility' | 'none';
export type StaffBank = { source: StaffBankSource; bankName: string | null; accountLast4: string | null; workerHasAccount: boolean };
export type WorkerBankRow = { worker_id: string; bank_name: string | null; account_number_last4: string | null };

const last4 = (value: string | null | undefined) => (value && /^\d{4}$/.test(value) ? value : null);

/**
 * 화면·급여·CSV 가 같이 쓰는 계좌 결정.
 * 연결 직원은 근무자 계좌가 있으면 그것, 없으면 사업장이 넣어 둔 값(확인용)으로 — 둘 다 없으면 'none'.
 */
export function resolveStaffBank(
  staff: { workerId: string | null; bankName: string | null; accountLast4: string | null },
  workerBank: Pick<WorkerBankRow, 'bank_name' | 'account_number_last4'> | null | undefined,
): StaffBank {
  const workerName = workerBank?.bank_name?.trim() || null;
  const workerLast4 = last4(workerBank?.account_number_last4);
  const workerHasAccount = Boolean(staff.workerId && workerName && workerLast4);
  if (workerHasAccount) return { source: 'worker', bankName: workerName, accountLast4: workerLast4, workerHasAccount };
  const facilityName = staff.bankName?.trim() || null;
  const facilityLast4 = last4(staff.accountLast4);
  if (facilityName && facilityLast4) return { source: 'facility', bankName: facilityName, accountLast4: facilityLast4, workerHasAccount };
  return { source: 'none', bankName: null, accountLast4: null, workerHasAccount };
}

/** 연결 직원들의 지금 주 계좌(근무자 앱 기준)를 한 번에 읽는다. 실패하면 빈 Map — 화면은 '사업장 입력값'으로 내려간다. */
export async function loadWorkerBanks(
  sb: { from: (table: string) => any },
  workerIds: Array<string | null | undefined>,
): Promise<Map<string, WorkerBankRow>> {
  const ids = [...new Set(workerIds.filter((id): id is string => Boolean(id)))];
  const map = new Map<string, WorkerBankRow>();
  if (!ids.length) return map;
  const { data, error } = await sb.from('worker_bank_accounts').select('worker_id,bank_name,account_number_last4')
    .in('worker_id', ids).eq('is_primary', true).is('deleted_at', null);
  if (error) return map;
  for (const row of (data ?? []) as WorkerBankRow[]) map.set(row.worker_id, row);
  return map;
}
