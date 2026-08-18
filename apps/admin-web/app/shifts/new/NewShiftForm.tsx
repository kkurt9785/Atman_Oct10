'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createShiftAction } from '@/lib/actions/shifts';
import { calcEstimatedShiftPay, MIN_HOURLY_WAGE_2026 } from '@/lib/pay';
import { won } from '@/lib/format';

type Role = 'rn' | 'na' | 'pharmacist' | 'pharmacy_staff' | 'any';

const ALL_ROLES: { value: Role; label: string }[] = [
  { value: 'rn', label: '간호사 (RN)' },
  { value: 'na', label: '간호조무사 (NA)' },
  { value: 'pharmacist', label: '약사' },
  { value: 'pharmacy_staff', label: '약국 전산·사무직' },
  { value: 'any', label: '자격 무관' },
];

const PHARMACY_TASKS: Record<'pharmacist'|'pharmacy_staff', string[]> = {
  pharmacist: ['처방 조제', '처방 검토', '복약지도', '의약품 판매·최종 확인', '재고·마약류 관리'],
  pharmacy_staff: ['처방전 전산 입력 보조', '서류·거래명세표 정리', '재고 정리', '매대 관리', '고객·전화 안내'],
};

type RecentShift={required_role:Role;start_time:string;end_time:string;hourly_wage:number;description:string;department:string|null;notes:string|null};

export default function NewShiftForm({ facilityType, recentShift, copiedShift=false }: { facilityType: string; recentShift?: RecentShift|null; copiedShift?:boolean }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const isPharmacy = facilityType === 'pharmacy';
  const roles = isPharmacy ? ALL_ROLES.filter(({value})=>value==='pharmacist'||value==='pharmacy_staff') : ALL_ROLES;
  const [role, setRole] = useState<Role>(isPharmacy ? 'pharmacist' : 'rn');
  const [shiftDate, setShiftDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  // 대체약사 시세(3~4만원대)와 병원 직군 시세가 크게 달라 직군별 기본값 분리
  const defaultWage=(r:Role)=>r==='pharmacist'?35000:r==='pharmacy_staff'?12000:15000;
  const [hourlyWage, setHourlyWage] = useState(()=>defaultWage(isPharmacy?'pharmacist':'rn'));
  const [description, setDescription] = useState('');
  const [department, setDepartment] = useState('');
  const [notes, setNotes] = useState('');
  const [invitedWorker, setInvitedWorker] = useState<{ id: string; name: string } | null>(null);
  const [selectedTasks,setSelectedTasks]=useState<string[]>([]);
  const loadingRecent=useRef(false);

  function applyRecentShift(){
    if(!recentShift)return;
    loadingRecent.current=true;
    if(roles.some(item=>item.value===recentShift.required_role))setRole(recentShift.required_role);
    setStartTime(recentShift.start_time.slice(0,5));setEndTime(recentShift.end_time.slice(0,5));
    setHourlyWage(recentShift.hourly_wage);setDescription(recentShift.description);
    setDepartment(recentShift.department??'');setNotes(recentShift.notes??'');
  }

  function toggleTask(task:string){
    setSelectedTasks(current=>{
      const next=current.includes(task)?current.filter(item=>item!==task):[...current,task];
      setDescription(next.join(', '));
      return next;
    });
  }

  useEffect(()=>{
    if(loadingRecent.current){loadingRecent.current=false;return;}
    if(role==='pharmacist'||role==='pharmacy_staff'){
      setSelectedTasks([]);
      setDescription('');
      setDepartment(role==='pharmacist'?'조제실':'전산·접수');
    }
    setHourlyWage(defaultWage(role));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[role]);

  // 사업장 전환(FacilitySwitcher → router.refresh)으로 prop이 바뀌면 stale 직군 교정
  // (약국인데 role='rn'이 남아 제출되는 경로 차단)
  useEffect(()=>{
    if(isPharmacy&&role!=='pharmacist'&&role!=='pharmacy_staff')setRole('pharmacist');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[isPharmacy]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get('workerId');
    const name = params.get('workerName');
    if (id && name) setInvitedWorker({ id, name });
  }, []);

  useEffect(()=>{if(copiedShift&&recentShift)applyRecentShift();},[copiedShift]); // 선택한 과거 공고는 진입 즉시 채운다

  const estimatedPay = calcEstimatedShiftPay(startTime, endTime, hourlyWage) ?? 0;
  const isOvernight = startTime && endTime
    ? endTime <= startTime
    : false;

  function handleStartTimeChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value;
    setStartTime(val);
    // 종료 시각이 비어있으면 +8h 자동 제안
    if (val && !endTime) {
      const [h, m] = val.split(':').map(Number);
      const endH = (h + 8) % 24;
      setEndTime(`${String(endH).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
    }
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    // 클라이언트 검증
    if (!shiftDate) { setError('날짜를 선택해주세요.'); return; }
    if (!startTime || !endTime) { setError('시작·종료 시간을 입력해주세요.'); return; }
    if (!description.trim()) { setError('업무 설명을 입력해주세요.'); return; }
    if (!hourlyWage || hourlyWage < MIN_HOURLY_WAGE_2026) { setError('시급은 2026년 최저시급(10,320원) 이상이어야 해요.'); return; }

    const formData = new FormData(e.currentTarget);
    formData.set('required_role', role);
    if (invitedWorker) formData.set('invited_worker_id', invitedWorker.id);

    startTransition(async () => {
      try {
        const result = await createShiftAction(formData);
        if (result && result.ok === false) setError(result.message);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : '';
        if (!msg.includes('NEXT_REDIRECT') && !msg.includes('digest')) {
          setError(msg || '등록 중 오류가 발생했어요. 다시 시도해주세요.');
        }
      }
    });
  }

  return (
    <main className="px-4 pb-32">
      {/* 헤더 */}
      <div className="flex items-center gap-3 mt-2 mb-6 px-1">
        <button
          type="button"
          onClick={() => router.back()}
          className="text-2xl text-sub leading-none"
          aria-label="뒤로"
        >
          ←
        </button>
        <h1 className="text-title font-extrabold text-ink">새 시프트 등록</h1>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        {recentShift&&!invitedWorker&&<button type="button" onClick={applyRecentShift} className="flex min-h-14 items-center justify-between rounded-2xl border border-primary/20 bg-primary/5 px-4 text-left active:bg-primary/10"><span><b className="block text-[13px] text-primary">{copiedShift?'이 공고 조건을 불러왔어요':'최근 공고 조건 불러오기'}</b><span className="mt-0.5 block text-[11px] text-sub">시간·시급·업무를 채우고 날짜만 새로 선택해요</span></span><span className="text-primary">{copiedShift?'✓':'›'}</span></button>}
        {invitedWorker && (
          <section className="bg-primary/10 border border-primary/20 rounded-2xl p-5">
            <p className="text-label font-bold text-primary">자체 인력풀 반복근무 요청</p>
            <p className="text-title font-extrabold text-ink mt-1">{invitedWorker.name} 님에게만 전송</p>
            <p className="text-label text-sub mt-2 leading-5">공개 공고에 노출되지 않으며, 워커가 요청을 확인하고 지원하면 사업장이 최종 확정합니다.</p>
          </section>
        )}
        {/* 필요 자격 */}
        <section className="bg-white rounded-2xl p-5 shadow-sm">
          <p className="text-label font-bold text-sub mb-3">필요 자격 *</p>
          <div className="grid grid-cols-2 gap-2">
            {roles.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                onClick={() => setRole(value)}
                className={`min-h-12 px-2 py-3 rounded-xl text-[13px] font-bold transition-colors ${
                  role === value
                    ? 'bg-primary text-white'
                    : 'bg-bg text-sub'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          {role === 'pharmacy_staff' && (
            <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-[12px] leading-5 text-amber-800">
              전산 입력 보조·서류·재고·매대·고객 안내만 등록할 수 있어요. 조제·판매·복약지도는 약사 공고로 등록해 주세요.
            </p>
          )}
          {(role==='pharmacist'||role==='pharmacy_staff')&&(
            <div className="mt-4">
              <p className="text-[12px] font-bold text-sub">주요 업무를 선택하세요</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {PHARMACY_TASKS[role].map(task=><button key={task} type="button" onClick={()=>toggleTask(task)}
                  className={`rounded-full border px-3 py-2 text-[12px] font-bold ${selectedTasks.includes(task)?'border-primary bg-primary/10 text-primary':'border-line bg-white text-sub'}`}>{task}</button>)}
              </div>
              {selectedTasks.length>0&&<p className="mt-3 text-[11px] font-medium text-primary">선택한 업무가 아래 설명에 자동 반영됐어요.</p>}
            </div>
          )}
        </section>

        {/* 일정 */}
        <section className="bg-white rounded-2xl p-5 shadow-sm">
          <p className="text-label font-bold text-sub mb-3">일정 *</p>
          <div className="flex flex-col gap-3">
            <div>
              <label className="text-label text-sub block mb-1">날짜</label>
              <input
                type="date"
                name="shift_date"
                required
                value={shiftDate}
                onChange={(e) => setShiftDate(e.target.value)}
                className="w-full bg-bg rounded-xl px-4 py-3.5 text-body text-ink focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <div>
              <label className="text-label text-sub block mb-1">시작</label>
              <input
                type="time"
                name="start_time"
                required
                value={startTime}
                onChange={handleStartTimeChange}
                className="w-full bg-bg rounded-xl px-4 py-3.5 text-body text-ink focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <div>
              <label className="text-label text-sub block mb-1">
                종료{isOvernight && <span className="ml-1 text-warn"> · 익일</span>}
              </label>
              <input
                type="time"
                name="end_time"
                required
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="w-full bg-bg rounded-xl px-4 py-3.5 text-body text-ink focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
          </div>
        </section>

        {/* 임금 */}
        <section className="bg-white rounded-2xl p-5 shadow-sm">
          <p className="text-label font-bold text-sub mb-3">임금 *</p>
          <div>
            <label className="text-label text-sub block mb-1">시급</label>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-body text-sub">₩</span>
              <input
                type="number"
                name="hourly_wage"
                required
                step={1000}
                value={hourlyWage || ''}
                placeholder={String(defaultWage(role))}
                onChange={(e) => setHourlyWage(parseInt(e.target.value, 10) || 0)}
                className="w-full bg-bg rounded-xl pl-8 pr-4 py-3.5 text-body text-ink focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            {hourlyWage > 0 && hourlyWage < MIN_HOURLY_WAGE_2026 && (
              <p className="text-label text-warn mt-1">2026년 최저시급(10,320원) 이상이어야 해요</p>
            )}
            {role==='pharmacist' && (
              <p className="text-label text-sub mt-1">대체약사 시세는 보통 시급 30,000~40,000원이에요</p>
            )}
          </div>

          {estimatedPay > 0 && (
            <div className="mt-4 pt-4 border-t border-line">
              <div className="flex items-center justify-between">
                <p className="text-body text-sub">예상 총 지급액</p>
                <p className="text-money font-extrabold text-primary">{won(estimatedPay)}</p>
              </div>

              <p className="text-label text-sub mt-2">이 금액은 사업장이 워커에게 직접 지급합니다. 잇닿 SaaS 이용료와 연동되지 않아요.</p>
            </div>
          )}
        </section>

        {/* 상세 정보 */}
        <section className="bg-white rounded-2xl p-5 shadow-sm">
          <p className="text-label font-bold text-sub mb-3">상세 정보</p>
          <div className="flex flex-col gap-3">
            <div>
              <label className="text-label text-sub block mb-1">업무 설명 *</label>
              <textarea
                name="description"
                required
                rows={3}
                placeholder={role === 'pharmacist' ? '예: 토요일 대체약사, 처방 조제·복약지도'
                  : role === 'pharmacy_staff' ? '예: 처방전 전산 입력 보조, 서류·재고·매대 정리'
                  : '예: 3층 일반병동 야간 간호 지원, 투약 및 활력징후 측정'}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full bg-bg rounded-xl px-4 py-3.5 text-body text-ink placeholder:text-sub resize-none focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <div>
              <label className="text-label text-sub block mb-1">부서 <span className="font-normal">(선택)</span></label>
              <input
                type="text"
                name="department"
                placeholder={role === 'pharmacist' || role === 'pharmacy_staff' ? '예: 조제실, 전산·접수, 재고관리' : '예: 일반병동, 중환자실, 응급실'}
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
                className="w-full bg-bg rounded-xl px-4 py-3.5 text-body text-ink placeholder:text-sub focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <div>
              <label className="text-label text-sub block mb-1">기타 안내 <span className="font-normal">(선택)</span></label>
              <textarea
                name="notes"
                rows={2}
                placeholder="예: 식사 제공, 주차 가능, 복장 규정"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full bg-bg rounded-xl px-4 py-3.5 text-body text-ink placeholder:text-sub resize-none focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
          </div>
        </section>

        {error && (
          <div className="bg-warn/10 rounded-xl px-4 py-3">
            <p className="text-body text-warn font-bold">{error}</p>
          </div>
        )}

        {/* 제출 버튼 */}
        <button
          type="submit"
          disabled={isPending || estimatedPay === 0}
          className="flex items-center justify-center min-h-tap rounded-xl bg-primary text-white text-body font-bold w-full disabled:opacity-50 active:opacity-90 transition-opacity"
        >
          {isPending ? '등록 중...' : invitedWorker ? '반복근무 요청 보내기' : '시프트 등록하기'}
        </button>
        {!isPending && estimatedPay === 0 && (
          <p className="text-label text-sub text-center -mt-2">근무 날짜·시간·시급을 입력하면 등록할 수 있어요</p>
        )}
      </form>
    </main>
  );
}
