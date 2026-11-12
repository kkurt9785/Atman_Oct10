import { STAFF_BANKS, type StaffBankSource } from '@/lib/staff-bank';

// 직원 카드 › 급여 기준 안의 지급 계좌 칸 (2026-11-12 계좌 검토 ①).
// 연결 직원: 근무자가 자기 앱에 등록한 계좌를 보여 준다(사업장이 바꾸지 않는다).
// 연결 안 된 직원: 은행을 목록에서 고르고 계좌 끝 4자리를 '확인용'으로 넣는다 — 둘 다 선택, 비워도 급여 승인은 된다.
const box = 'col-span-2 rounded-xl px-3 py-3';
const field = 'mt-1 h-11 w-full rounded-xl border border-line bg-white px-3 text-[0.75rem] font-normal text-ink';

export function StaffBankFields({ linked, source, bankName, accountLast4 }: {
  linked: boolean; source: StaffBankSource; bankName: string | null; accountLast4: string | null;
}) {
  if (linked) {
    if (source === 'worker') {
      return <div className={`${box} border border-line bg-white`}>
        <p className="text-[0.6875rem] font-bold text-sub">근무자가 등록한 지급 계좌</p>
        <p className="mt-0.5 text-[0.8125rem] font-extrabold text-ink">{bankName} · ****{accountLast4}</p>
        <p className="mt-1 text-[0.6875rem] leading-4 text-sub">계좌를 바꾸는 건 근무자 본인 앱에서 해요. 바뀌면 여기에도 바로 보여요.</p>
      </div>;
    }
    return <div className={`${box} border border-amber-200 bg-amber-50`}>
      <p className="text-[0.75rem] font-bold text-amber-800">근무자 앱에 아직 지급 계좌가 없어요</p>
      {source === 'facility' && <p className="mt-0.5 text-[0.6875rem] text-amber-800">사업장이 넣어 둔 확인용 계좌 · {bankName} ****{accountLast4}</p>}
      <p className="mt-1 text-[0.6875rem] leading-4 text-amber-800">근무자에게 앱 [내 정보 › 지급 계좌]에서 등록해 달라고 해 주세요. 계좌가 없어도 급여 승인은 할 수 있어요.</p>
    </div>;
  }
  const current = bankName?.trim() ?? '';
  const banks: string[] = current && !(STAFF_BANKS as readonly string[]).includes(current) ? [current, ...STAFF_BANKS] : [...STAFF_BANKS];
  return <>
    <label className="text-[0.6875rem] font-bold text-sub">지급 은행 <span className="font-normal">(선택)</span>
      <select name="bank_name" defaultValue={current} className={field}>
        <option value="">선택 안 함</option>
        {banks.map((bank) => <option key={bank} value={bank}>{bank}</option>)}
      </select>
    </label>
    <label className="text-[0.6875rem] font-bold text-sub">계좌 끝 4자리 <span className="font-normal">(선택)</span>
      <input name="account_last4" inputMode="numeric" pattern="[0-9]{4}" maxLength={4} defaultValue={accountLast4 ?? ''} placeholder="예: 1234" className={field}/>
    </label>
    <p className="col-span-2 text-[0.6875rem] leading-4 text-sub">전체 계좌번호는 받지 않아요. 이체할 때 맞는 계좌인지 확인하는 용도예요. 직원이 앱을 쓰면 본인이 등록한 계좌가 대신 보여요.</p>
  </>;
}
