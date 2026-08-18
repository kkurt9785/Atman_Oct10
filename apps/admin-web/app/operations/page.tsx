import Link from 'next/link';
import { Card } from '@/components/ui';
import { won } from '@/lib/format';
import { todayKST } from '@/lib/date';
import { getOperationsAlerts, getOperationsSummary, getShiftTemplates, getWorkforceCoverage, getWorkforceRecommendations, getStaffingRequirements } from '@/lib/db/operations';
import { approveWorkforceRecommendationAction, createShiftTemplateAction, createStaffingRequirementAction, deactivateShiftTemplateAction, deactivateStaffingRequirementAction, fillSevenDayScheduleGapsAction, generateRecurringShiftsAction, requestUrgentReplacementAction, resetFacilityLiveDemoAction } from './actions';
import { getAdminContext } from '@/lib/admin-auth';
import { getShop } from '@/lib/db/shop';
import { hasPlanFeature } from '@/lib/billing-gates';
import { adminClient } from '@/lib/supabase';
import { ManageBackLink } from '@/components/ManageBackLink';

const ROLE_LABEL: Record<string, string> = { rn: '간호사', na: '간호조무사', pharmacist: '약사', pharmacy_staff: '약국 전산·사무직', any: '자격 무관' };
const DAY_LABEL: Record<number, string> = { 1: '월', 2: '화', 3: '수', 4: '목', 5: '금', 6: '토', 7: '일' };

const NOTICE: Record<string, string> = {
  template_saved: '반복 템플릿을 저장했어요.',
  generated: '반복 시프트를 생성했어요. 공고 목록에서 확인하세요.',
  urgent_sent: '긴급 알림을 보냈어요.',
  template_off: '템플릿 사용을 중지했어요.',
  gaps_filled: '앞으로 7일의 근무표 공백을 공고로 만들고 워커에게 알렸어요.',
  no_schedule_gap: '앞으로 7일 근무표에는 새로 만들 공백이 없어요.',
  recommendation_applied: '추천안을 승인해 공고를 만들고 대상 워커에게 알렸어요.',
  recommendation_changed: '근무표가 갱신되어 추천안이 달라졌어요. 최신 내용을 다시 확인해 주세요.',
  requirement_saved: '병동·직군별 필요 인원 기준을 저장했어요.',
  requirement_off: '필요 인원 기준 사용을 중지했어요.',
  live_demo_reset: '시연을 처음 상태로 돌렸어요. 워커 앱에서 새 공고에 직접 지원해 보세요.',
};

export default async function OperationsPage({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  const notice = NOTICE[(await searchParams).notice ?? ''];
  const context = await getAdminContext();
  if (!context || context.accessRole === 'sales') {
    return <main className="px-4"><Card className="mt-8 py-10 text-center"><p className="text-body font-bold">운영 관리 권한이 필요해요</p><p className="text-label text-sub mt-2">사업장 소유자 또는 운영 담당자에게 요청해 주세요.</p></Card></main>;
  }
  const [summary, templates, requirements, operationAlerts, coverage, recommendations, shop] = await Promise.all([getOperationsSummary(), getShiftTemplates(), getStaffingRequirements(), getOperationsAlerts(), getWorkforceCoverage(), getWorkforceRecommendations(), getShop()]);
  const isPharmacy = shop?.facilityType === 'pharmacy';
  // 운영 자동화는 Pro·Pharmacy Plus 기능 — 미충족 플랜에는 실행 시점 에러 대신 먼저 안내한다
  const gateSb = adminClient();
  const hasOperations = !!gateSb && (await hasPlanFeature(gateSb, context.facilityId, 'operations'));
  const roleOptions: [string, string][] = isPharmacy
    ? [['pharmacist', '약사'], ['pharmacy_staff', '약국 전산·사무직']]
    : [['rn', '간호사 RN'], ['na', '간호조무사 NA'], ['pharmacist', '약사'], ['pharmacy_staff', '약국 전산·사무직'], ['any', '자격 무관']];
  const alerts = summary.urgentUnfilledCount + summary.expiringCredentialCount + summary.pendingWageCount
    + operationAlerts.filter((alert) => alert.kind === 'no_show').length;
  const scheduleGapCount = coverage.reduce((sum, day) => sum + day.scheduleGap, 0);
  const recruitingCount = coverage.reduce((sum, day) => sum + day.recruiting, 0);
  return (
    <main className="px-4 pb-28">
      <ManageBackLink href="/more/operations" label="근무 운영" />
      {notice && <p role="status" className="mt-3 rounded-xl border border-success/30 bg-success/10 px-4 py-3 text-[13px] font-bold text-success">{notice}
      {!hasOperations && (
        <Card className="mb-4 border border-amber-200 bg-amber-50">
          <p className="text-body font-extrabold text-ink">운영 자동화는 Pro·Pharmacy Plus 요금제 기능이에요</p>
          <p className="text-label text-sub mt-1 leading-5">반복 근무표 자동 생성, 인력 공백 알림, 긴급 대체 모집을 쓸 수 있어요. 지금 플랜에서는 화면만 미리 볼 수 있습니다.</p>
          <Link href="/membership" className="mt-3 inline-flex min-h-10 items-center rounded-xl bg-primary px-4 text-label font-extrabold text-white">요금제 살펴보기</Link>
        </Card>
      )}
</p>}
      <div className="mt-3 mb-5 px-1">
        <p className="text-label font-bold text-primary">운영 자동화</p>
        <h1 className="text-display font-extrabold text-ink mt-1">이번 달 인력 운영</h1>
        <p className="text-label text-sub mt-2">반복 일정과 놓치기 쉬운 업무를 한곳에서 확인하세요.</p>
      </div>

      {shop?.isDemo && (
        <Card className="mb-4 border border-violet-200 bg-violet-50">
          <div className="flex items-center justify-between gap-3"><div><p className="text-body font-extrabold text-ink">두 기기 실시간 시연</p><p className="text-[12px] leading-5 text-sub mt-1">초기화 후 워커가 지원하면 관리자 알림 → 수락 → 워커 알림 → 채팅을 직접 확인할 수 있어요.</p></div><form action={resetFacilityLiveDemoAction}><button className="min-h-11 shrink-0 rounded-xl bg-violet-600 px-4 text-[12px] font-extrabold text-white">시연 초기화</button></form></div>
        </Card>
      )}

      <Card className="shadow-sm mb-4">
        <p className="text-label text-sub">이번 달 예정 인건비</p>
        <p className="text-money font-extrabold text-ink mt-1">{won(summary.monthEstimatedCost)}</p>
        <div className="grid grid-cols-3 gap-2 mt-4 pt-4 border-t border-line text-center">
          <div><p className="text-title font-extrabold text-primary">{summary.openShiftCount}</p><p className="text-[11px] text-sub">모집 중</p></div>
          <div><p className="text-title font-extrabold text-warn">{summary.urgentUnfilledCount}</p><p className="text-[11px] text-sub">48시간 내 미충원</p></div>
          <div><p className="text-title font-extrabold text-ink">{alerts}</p><p className="text-[11px] text-sub">확인할 일</p></div>
        </div>
      </Card>

      <section className="mb-5" aria-labelledby="staffing-recommendations">
        <div className="flex items-end justify-between px-1 mb-3">
          <div><p className="text-label font-bold text-primary">근무표·휴가·근태 자동 분석</p><h2 id="staffing-recommendations" className="text-title font-extrabold text-ink mt-1">인력 공백 알림</h2></div>
          <span className="text-label font-bold text-sub">앞으로 7일</span>
        </div>
        {requirements.length === 0 ? (
          <Card className="border border-primary/20 bg-primary/5"><p className="text-body font-extrabold text-ink">먼저 병동별 필요 인원을 정해 주세요</p><p className="text-label text-sub mt-1">기준을 한 번 저장하면 근무표·휴가·근태를 비교해 부족한 시간만 알려드려요.</p><a href="#staffing-settings" className="mt-3 inline-flex min-h-10 items-center rounded-xl bg-primary px-4 text-label font-extrabold text-white">필요 인원 설정</a></Card>
        ) : recommendations.length === 0 ? (
          <Card className="border border-success/20 bg-success/5"><p className="text-body font-extrabold text-ink">현재 확인된 인력 공백이 없어요</p><p className="text-label text-sub mt-1">고정 근무자와 확정 단기 인력이 기준 인원을 충족하고 있어요.</p></Card>
        ) : (
          <div className="space-y-3">
            {recommendations.slice(0, 5).map((item) => {
              const dateLabel = new Intl.DateTimeFormat('ko-KR', { month: 'numeric', day: 'numeric', weekday: 'short', timeZone: 'Asia/Seoul' }).format(new Date(`${item.date}T00:00:00+09:00`));
              return <Card key={item.key} className="border border-amber-200 bg-amber-50/70">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0"><p className="text-[12px] font-extrabold text-warn">{dateLabel} · {item.startTime.slice(0,5)}~{item.endTime.slice(0,5)}</p><p className="text-body font-extrabold text-ink mt-1">{item.department ?? (isPharmacy ? '약국 전체' : '전체 병동')} {ROLE_LABEL[item.role]} {item.shortage}명이 부족해요</p><p className="text-label text-sub mt-1 leading-5">{item.reason} · 기준 {item.required}명 / 현재 반영 {item.scheduled}명</p></div>
                  <span className="shrink-0 rounded-full bg-white px-2.5 py-1 text-[11px] font-extrabold text-primary">가능 인력풀 {item.candidateCount}명</span>
                </div>
                {item.candidateCount > 0 && <p className="mt-3 rounded-xl bg-white/80 px-3 py-2 text-[12px] text-sub">함께 일했던 인력풀 중 이 시간대에 가능한 인력이 <b className="text-ink">{item.candidateCount}명</b> 있어요. 공고를 올리면 조건이 맞는 워커 모두에게 알림이 갑니다.</p>}
                <form action={approveWorkforceRecommendationAction} className="mt-3">
                  <input type="hidden" name="recommendation_key" value={item.key}/>
                  <button className="w-full min-h-11 rounded-xl bg-primary px-4 text-label font-extrabold text-white">공고 올리고 조건 맞는 워커에게 알림</button>
                </form>
              </Card>;
            })}
          </div>
        )}
      </section>

      <section id="staffing-settings" className="scroll-mt-20 mb-6">
        <div className="px-1 mb-3"><p className="text-label font-bold text-primary">최초 한 번 설정</p><h2 className="text-title font-extrabold text-ink mt-1">병동·시간별 필요 인원</h2><p className="text-label text-sub mt-1">공고 수가 아니라 실제 운영에 반드시 필요한 최소 인원입니다.</p></div>
        {requirements.length > 0 && <div className="space-y-2 mb-3">{requirements.map((item) => <Card key={item.id} className="py-3.5">
          <div className="flex items-center justify-between gap-3"><div className="min-w-0"><p className="text-body font-extrabold text-ink">{item.name} · {item.requiredHeadcount}명</p><p className="text-[12px] text-sub mt-1">{item.department ?? (isPharmacy ? '약국 전체' : '전체 병동')} · {ROLE_LABEL[item.requiredRole]} · {item.weekdays.map((day) => DAY_LABEL[day]).join('·')} · {item.startTime.slice(0,5)}~{item.endTime.slice(0,5)}</p></div><form action={deactivateStaffingRequirementAction}><input type="hidden" name="requirement_id" value={item.id}/><button className="text-[11px] text-sub underline whitespace-nowrap">사용 중지</button></form></div>
        </Card>)}</div>}
        <details className="bg-white rounded-2xl p-5" open={requirements.length === 0}>
          <summary className="cursor-pointer text-body font-extrabold text-ink">+ 필요 인원 기준 추가</summary>
          <form action={createStaffingRequirementAction} className="space-y-4 mt-5">
            <input name="name" required maxLength={80} placeholder={isPharmacy ? '예: 평일 조제 인력' : '예: 3병동 주간 인력'} className="w-full h-12 rounded-xl bg-bg px-4 text-body"/>
            <div className="grid grid-cols-2 gap-2"><input name="department" placeholder={isPharmacy ? '조제실 (비우면 약국 전체)' : '3병동'} className="h-12 rounded-xl bg-bg px-3"/><select name="required_role" className="h-12 rounded-xl bg-bg px-3">{roleOptions.map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></div>
            <div className="grid grid-cols-3 gap-2"><input type="time" name="start_time" defaultValue="09:00" required aria-label="시작 시간" className="h-12 rounded-xl bg-bg px-2"/><input type="time" name="end_time" defaultValue="18:00" required aria-label="종료 시간" className="h-12 rounded-xl bg-bg px-2"/><input type="number" name="required_headcount" min="1" max="100" defaultValue="2" required aria-label="필요 인원" className="h-12 rounded-xl bg-bg px-3"/></div>
            <div className="flex justify-between gap-1">{Object.entries(DAY_LABEL).map(([day,label]) => <label key={day} className="flex-1"><input type="checkbox" name="weekdays" value={day} defaultChecked={Number(day) <= 5} className="sr-only peer"/><span className="h-10 rounded-xl bg-bg text-sub peer-checked:bg-primary peer-checked:text-white flex items-center justify-center text-label font-bold">{label}</span></label>)}</div>
            <div><p className="text-[12px] font-bold text-ink mb-2">부족할 때 생성할 대체 공고 조건</p><input type="number" name="replacement_hourly_wage" min="10320" step="100" defaultValue={isPharmacy ? 35000 : 15000} required aria-label="대체 근무 시급" className="w-full h-12 rounded-xl bg-bg px-4"/></div>
            <textarea name="replacement_description" required rows={3} placeholder={isPharmacy ? '조제 보조 및 고객 응대 업무' : '해당 병동의 단기 대체 근무'} className="w-full rounded-xl bg-bg px-4 py-3 resize-none"/>
            <button className="w-full h-12 rounded-xl bg-ink text-white text-body font-extrabold">필요 인원 기준 저장</button>
          </form>
        </details>
      </section>

      <section id="coverage" className="scroll-mt-20 mb-5">
        <div className="flex items-end justify-between px-1 mb-3">
          <div><p className="text-label font-bold text-primary">근무 공백부터 확인</p><h2 className="text-title font-extrabold text-ink mt-1">앞으로 7일 충원 현황</h2></div>
          <Link href="/shifts" className="text-label font-bold text-primary">전체 시프트 →</Link>
        </div>
        {(scheduleGapCount > 0 || recruitingCount > 0) && (
          <Card className="mb-3 border border-primary/20 bg-primary/5">
            <div className="flex items-center justify-between gap-3">
              <div><p className="text-body font-extrabold text-ink">공백 {scheduleGapCount}명 · 모집 중 {recruitingCount}명</p><p className="text-label text-sub mt-1 leading-5">한 번 생성하면 공고 등록과 워커 알림은 뒤에서 처리돼요.</p></div>
              {scheduleGapCount > 0 && <form action={fillSevenDayScheduleGapsAction}><button className="min-h-11 shrink-0 rounded-xl bg-primary px-4 text-[12px] font-extrabold text-white">공백 한 번에 모집</button></form>}
            </div>
          </Card>
        )}
        <Card className="p-0 overflow-hidden divide-y divide-line">
          {coverage.map((day) => {
            const isGap = day.scheduleGap > 0;
            const isRecruiting = day.recruiting > 0;
            const label = new Intl.DateTimeFormat('ko-KR', { month: 'numeric', day: 'numeric', weekday: 'short', timeZone: 'Asia/Seoul' }).format(new Date(`${day.date}T00:00:00+09:00`));
            return <div key={day.date} className="flex items-center gap-3 px-4 py-3.5">
              <div className="w-[72px] shrink-0"><p className="text-body font-extrabold text-ink">{label}</p><p className="text-[11px] text-sub mt-0.5">예정 {day.planned}명</p></div>
              <div className="min-w-0 flex-1">
                {isGap ? <><p className="text-label font-extrabold text-red-600">근무표 공백 {day.scheduleGap}명</p><p className="text-[11px] text-sub mt-0.5">반복 일정이 아직 공고로 생성되지 않았어요</p></>
                  : isRecruiting ? <><p className="text-label font-extrabold text-warn">{day.recruiting}명 모집 중</p><p className="text-[11px] text-sub mt-0.5">확정 {day.filled}명 · 지원 현황을 확인하세요</p></>
                  : day.planned > 0 ? <><p className="text-label font-extrabold text-success">필요 인원 충원 완료</p><p className="text-[11px] text-sub mt-0.5">확정 {day.filled}명</p></>
                  : <p className="text-label text-sub">등록된 근무 없음</p>}
              </div>
              {isRecruiting && !isGap ? <Link href="/applications" className="h-9 shrink-0 rounded-xl bg-primary px-3 flex items-center text-[11px] font-extrabold text-white">지원 확인</Link>
                : null}
            </div>;
          })}
        </Card>
      </section>

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
                <div><p className={`text-label font-extrabold ${alert.kind === 'no_show' ? 'text-red-600' : 'text-warn'}`}>{alert.kind === 'no_show' ? '출근 30분 경과 · 노쇼 확인' : '48시간 내 지원자 없음'}</p><p className="text-body font-bold mt-1">{alert.shiftDate} {alert.startTime.slice(0,5)} · {alert.department ?? (isPharmacy?'조제실':'병동')}</p></div>
                <form action={requestUrgentReplacementAction}><input type="hidden" name="shift_id" value={alert.shiftId}/><input type="hidden" name="kind" value={alert.kind}/><button className="h-10 px-3 rounded-xl bg-ink text-white text-[12px] font-bold whitespace-nowrap">{alert.kind === 'no_show' ? '대체 공고·알림' : '긴급 알림 재전송'}</button></form>
              </div>
            </Card>
          ))}
        </div>
      )}

      <div id="templates" className="scroll-mt-20 flex items-center justify-between px-1 mt-7 mb-3">
        <h2 className="text-title font-bold text-ink">반복 시프트 템플릿</h2>
        <span className="text-label text-sub">최대 8주 생성</span>
      </div>
      {templates.length === 0 ? (
        <Card className="py-8 text-center mb-4"><p className="text-body font-bold">저장된 템플릿이 없어요</p><p className="text-label text-sub mt-1">매주 반복되는 일정을 먼저 저장하세요. 요일·시간·직군을 정해두면 몇 주치 공고를 한 번에 만들 수 있어요.</p></Card>
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
          <input name="name" required maxLength={80} placeholder={isPharmacy?'예: 토요일 대체약사':'예: 3병동 월·수·금 야간'} className="w-full h-12 rounded-xl bg-bg px-4 text-body"/>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3"><select name="required_role" className="h-12 rounded-xl bg-bg px-3">{roleOptions.map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select><input type="number" name="required_headcount" min="1" max="20" defaultValue="1" required aria-label="필요 인원" className="h-12 rounded-xl bg-bg px-3"/><input type="number" name="hourly_wage" min="10320" step="100" defaultValue={isPharmacy?35000:15000} required aria-label="시급" className="h-12 rounded-xl bg-bg px-3"/></div>
          <div className="grid grid-cols-2 gap-2"><input type="time" name="start_time" defaultValue={isPharmacy?'09:00':'22:00'} required className="h-12 rounded-xl bg-bg px-3"/><input type="time" name="end_time" defaultValue={isPharmacy?'13:00':'06:00'} required className="h-12 rounded-xl bg-bg px-3"/></div>
          <div className="flex justify-between gap-1">{Object.entries(DAY_LABEL).map(([day,label]) => <label key={day} className="flex-1"><input type="checkbox" name="weekdays" value={day} className="sr-only peer"/><span className="h-10 rounded-xl bg-bg text-sub peer-checked:bg-primary peer-checked:text-white flex items-center justify-center text-label font-bold">{label}</span></label>)}</div>
          <input name="department" placeholder="부서 (선택)" className="w-full h-12 rounded-xl bg-bg px-4"/>
          <textarea name="description" required rows={3} placeholder="업무 설명" className="w-full rounded-xl bg-bg px-4 py-3 resize-none"/>
          <button className="w-full h-12 rounded-xl bg-ink text-white text-body font-extrabold">템플릿 저장</button>
        </form>
      </details>
    </main>
  );
}
