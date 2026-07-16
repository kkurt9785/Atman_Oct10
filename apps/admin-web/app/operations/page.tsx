import Link from 'next/link';
import { Card } from '@/components/ui';
import { won } from '@/lib/billing';
import { todayKST } from '@/lib/date';
import { getOperationsAlerts, getOperationsSummary, getShiftTemplates } from '@/lib/db/operations';
import { createShiftTemplateAction, deactivateShiftTemplateAction, generateRecurringShiftsAction, requestUrgentReplacementAction } from './actions';
import { getAdminContext } from '@/lib/admin-auth';

const ROLE_LABEL: Record<string, string> = { rn: '간호사', na: '간호조무사', any: '자격 무관' };
const DAY_LABEL: Record<number, string> = { 1: '월', 2: '화', 3: '수', 4: '목', 5: '금', 6: '토', 7: '일' };

export default async function OperationsPage() {
  const context = await getAdminContext();
  if (!context || context.accessRole === 'sales') {
    return <main className="px-4"><Card className="mt-8 py-10 text-center"><p className="text-body font-bold">운영 관리 권한이 필요해요</p><p className="text-label text-sub mt-2">병원 소유자 또는 운영 담당자에게 요청해 주세요.</p></Card></main>;
  }
  const [summary, templates, operationAlerts] = await Promise.all([getOperationsSummary(), getShiftTemplates(), getOperationsAlerts()]);
  const alerts = summary.urgentUnfilledCount + summary.expiringCredentialCount + summary.pendingWageCount
    + operationAlerts.filter((alert) => alert.kind === 'no_show').length;
  return (
    <main className="px-4 pb-28">
      <div className="mt-3 mb-5 px-1">
        <p className="text-label font-bold text-primary">운영 자동화</p>
        <h1 className="text-display font-extrabold text-ink mt-1">이번 달 인력 운영</h1>
        <p className="text-label text-sub mt-2">반복 일정과 놓치기 쉬운 업무를 한곳에서 확인하세요.</p>
      </div>

      <Card className="shadow-sm mb-4">
        <p className="text-label text-sub">이번 달 예정 인건비</p>
        <p className="text-money font-extrabold text-ink mt-1">{won(summary.monthEstimatedCost)}</p>
        <div className="grid grid-cols-3 gap-2 mt-4 pt-4 border-t border-line text-center">
          <div><p className="text-title font-extrabold text-primary">{summary.openShiftCount}</p><p className="text-[11px] text-sub">모집 중</p></div>
          <div><p className="text-title font-extrabold text-warn">{summary.urgentUnfilledCount}</p><p className="text-[11px] text-sub">48시간 내 미충원</p></div>
          <div><p className="text-title font-extrabold text-ink">{alerts}</p><p className="text-[11px] text-sub">확인할 일</p></div>
        </div>
      </Card>

      {alerts > 0 && (
        <Card className="border border-amber-200 bg-amber-50 mb-5">
          <p className="text-body font-extrabold text-ink">지금 확인할 항목</p>
          <div className="mt-3 space-y-2 text-label">
            {summary.urgentUnfilledCount > 0 && <Link href="/shifts" className="flex justify-between"><span>48시간 내 지원자 없는 시프트</span><b className="text-warn">{summary.urgentUnfilledCount}건 →</b></Link>}
            {summary.expiringCredentialCount > 0 && <Link href="/workforce" className="flex justify-between"><span>30일 내 만료 또는 만료 자격</span><b className="text-warn">{summary.expiringCredentialCount}건 →</b></Link>}
            {summary.pendingWageCount > 0 && <Link href="/payroll" className="flex justify-between"><span>승인·지급 처리 대기</span><b className="text-warn">{summary.pendingWageCount}건 →</b></Link>}
          </div>
        </Card>
      )}

      {operationAlerts.length > 0 && (
        <div className="space-y-2 mb-5">
          {operationAlerts.slice(0, 8).map((alert) => (
            <Card key={`${alert.kind}:${alert.shiftId}`} className={alert.kind === 'no_show' ? 'border border-red-200' : 'border border-amber-200'}>
              <div className="flex items-center justify-between gap-3">
                <div><p className={`text-label font-extrabold ${alert.kind === 'no_show' ? 'text-red-600' : 'text-warn'}`}>{alert.kind === 'no_show' ? '출근 30분 경과 · 노쇼 확인' : '48시간 내 지원자 없음'}</p><p className="text-body font-bold mt-1">{alert.shiftDate} {alert.startTime.slice(0,5)} · {alert.department ?? '병동'}</p></div>
                <form action={requestUrgentReplacementAction}><input type="hidden" name="shift_id" value={alert.shiftId}/><input type="hidden" name="kind" value={alert.kind}/><button className="h-10 px-3 rounded-xl bg-ink text-white text-[12px] font-bold whitespace-nowrap">{alert.kind === 'no_show' ? '대체 공고·알림' : '긴급 알림 재전송'}</button></form>
              </div>
            </Card>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between px-1 mt-7 mb-3">
        <h2 className="text-title font-bold text-ink">반복 시프트 템플릿</h2>
        <span className="text-label text-sub">최대 8주 생성</span>
      </div>
      {templates.length === 0 ? (
        <Card className="py-8 text-center mb-4"><p className="text-body font-bold">저장된 템플릿이 없어요</p><p className="text-label text-sub mt-1">매주 반복되는 병동 일정을 먼저 저장하세요.</p></Card>
      ) : (
        <div className="space-y-3 mb-5">
          {templates.map((template) => (
            <Card key={template.id} className="shadow-sm">
              <div className="flex justify-between gap-3"><div><p className="text-body font-extrabold">{template.name}</p><p className="text-label text-sub mt-1">{template.weekdays.map((day) => DAY_LABEL[day]).join('·')} · {template.startTime.slice(0,5)}~{template.endTime.slice(0,5)} · {ROLE_LABEL[template.requiredRole]} · {template.requiredHeadcount}명</p></div><p className="text-label font-bold text-primary">{template.hourlyWage.toLocaleString('ko-KR')}원</p></div>
              <form action={generateRecurringShiftsAction} className="grid grid-cols-[1fr_72px] gap-2 mt-4">
                <input type="hidden" name="template_id" value={template.id}/>
                <input type="date" name="start_date" defaultValue={todayKST()} required className="h-11 rounded-xl bg-bg px-3 text-label"/>
                <select name="weeks" defaultValue="4" className="h-11 rounded-xl bg-bg px-2 text-label"><option value="2">2주</option><option value="4">4주</option><option value="8">8주</option></select>
                <button className="col-span-2 h-11 rounded-xl bg-primary text-white text-label font-extrabold">선택 기간 시프트 일괄 생성</button>
              </form>
              <form action={deactivateShiftTemplateAction} className="mt-2 text-right"><input type="hidden" name="template_id" value={template.id}/><button className="text-[11px] text-sub underline">템플릿 사용 중지</button></form>
            </Card>
          ))}
        </div>
      )}

      <details className="bg-white rounded-2xl p-5">
        <summary className="cursor-pointer text-body font-extrabold text-ink">+ 새 반복 템플릿 만들기</summary>
        <form action={createShiftTemplateAction} className="space-y-4 mt-5">
          <input name="name" required maxLength={80} placeholder="예: 3병동 월·수·금 야간" className="w-full h-12 rounded-xl bg-bg px-4 text-body"/>
          <div className="grid grid-cols-3 gap-2"><select name="required_role" className="h-12 rounded-xl bg-bg px-3"><option value="rn">간호사 RN</option><option value="na">간호조무사 NA</option><option value="any">자격 무관</option></select><input type="number" name="required_headcount" min="1" max="20" defaultValue="1" required aria-label="필요 인원" className="h-12 rounded-xl bg-bg px-3"/><input type="number" name="hourly_wage" min="10320" step="100" defaultValue="15000" required aria-label="시급" className="h-12 rounded-xl bg-bg px-3"/></div>
          <div className="grid grid-cols-2 gap-2"><input type="time" name="start_time" defaultValue="22:00" required className="h-12 rounded-xl bg-bg px-3"/><input type="time" name="end_time" defaultValue="06:00" required className="h-12 rounded-xl bg-bg px-3"/></div>
          <div className="flex justify-between gap-1">{Object.entries(DAY_LABEL).map(([day,label]) => <label key={day} className="flex-1"><input type="checkbox" name="weekdays" value={day} className="sr-only peer"/><span className="h-10 rounded-xl bg-bg text-sub peer-checked:bg-primary peer-checked:text-white flex items-center justify-center text-label font-bold">{label}</span></label>)}</div>
          <input name="department" placeholder="부서 (선택)" className="w-full h-12 rounded-xl bg-bg px-4"/>
          <textarea name="description" required rows={3} placeholder="업무 설명" className="w-full rounded-xl bg-bg px-4 py-3 resize-none"/>
          <button className="w-full h-12 rounded-xl bg-ink text-white text-body font-extrabold">템플릿 저장</button>
        </form>
      </details>
    </main>
  );
}
