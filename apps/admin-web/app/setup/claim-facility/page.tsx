'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { claimFacility, requestFacilityRegistration, searchFacilities } from '@/lib/facility';

const TYPE_LABEL: Record<string, string> = {
  care_hospital:    '요양병원',
  general_hospital: '종합병원',
  small_hospital:   '병원·의원',
  nursing_home:     '요양원',
  home_health:      '방문간호',
  pharmacy:         '약국',
};

type Facility = {
  id: string;
  name: string;
  facility_type: string;
  address_text: string;
};

export default function ClaimFacilityPage() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Facility[]>([]);
  const [selected, setSelected] = useState<Facility | null>(null);
  const [inviteCode, setInviteCode] = useState('');
  const [searched, setSearched] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState('');
  const [businessType,setBusinessType]=useState<'medical'|'pharmacy'>('medical');
  const [showRequest,setShowRequest]=useState(false);
  const [requestForm,setRequestForm]=useState({name:'',address:'',contactName:'',contactPhone:'',note:''});
  const [requestDone,setRequestDone]=useState(false);
  const visibleResults=results.filter(f=>businessType==='pharmacy'?f.facility_type==='pharmacy':f.facility_type!=='pharmacy');

  async function handleSearch() {
    if (query.trim().length < 2) return;
    const data = await searchFacilities(query.trim());
    setResults(data as Facility[]);
    setSearched(true);
  }

  async function handleClaim() {
    if (!selected) return;
    setError('');

    startTransition(async () => {
      const result = await claimFacility(selected.id, inviteCode);
      if (result.ok) {
        router.replace('/');
      } else {
        setError(result.error ?? '연결 실패');
      }
    });
  }

  function updateRequest(key:keyof typeof requestForm,value:string){
    setRequestForm(current=>({...current,[key]:value}));
  }

  async function handleRegistrationRequest(){
    setError('');
    startTransition(async()=>{
      const result=await requestFacilityRegistration({
        facilityType:businessType==='pharmacy'?'pharmacy':'small_hospital',
        facilityName:requestForm.name,
        addressText:requestForm.address,
        contactName:requestForm.contactName,
        contactPhone:requestForm.contactPhone,
        note:requestForm.note,
      });
      if(result.ok)setRequestDone(true);
      else setError(result.error??'등록 요청을 접수하지 못했어요.');
    });
  }

  return (
    <div className="min-h-screen bg-surface flex flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-md space-y-6">
        {/* 헤더 */}
        <div className="text-center space-y-2">
          <div className="text-4xl">{businessType==='pharmacy'?'💊':'🏥'}</div>
          <h1 className="text-[22px] font-bold text-ink">내 사업장 찾기</h1>
          <p className="text-[14px] text-sub">병원·의원·약국명을 검색해서 사업장을 연결해주세요</p>
        </div>

        <div>
          <p className="mb-2 text-[13px] font-bold text-sub">관리할 사업장 유형</p>
          <div className="grid grid-cols-2 gap-2 rounded-2xl bg-white p-2 shadow-sm">
            <button type="button" onClick={()=>{setBusinessType('medical');setSelected(null);}} className={`min-h-16 rounded-xl border px-3 text-left ${businessType==='medical'?'border-primary bg-primary/5':'border-line'}`}><span className="text-[20px]">🏥</span><b className="ml-2 text-[14px]">병원·의원</b></button>
            <button type="button" onClick={()=>{setBusinessType('pharmacy');setSelected(null);}} className={`min-h-16 rounded-xl border px-3 text-left ${businessType==='pharmacy'?'border-primary bg-primary/5':'border-line'}`}><span className="text-[20px]">💊</span><b className="ml-2 text-[14px]">약국</b></button>
          </div>
        </div>

        {/* 검색 */}
        <div className="flex gap-2">
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSearch()}
            placeholder={businessType==='pharmacy'?'약국명 입력 (예: 수원온누리)':'병원·의원명 입력 (예: W여성)'}
            className="flex-1 border border-line rounded-xl px-4 py-3 text-[15px] outline-none focus:border-primary"
          />
          <button
            onClick={handleSearch}
            className="px-4 py-3 bg-primary text-white rounded-xl text-[15px] font-semibold"
          >
            검색
          </button>
        </div>

        {/* 결과 */}
        {searched && visibleResults.length === 0 && (
          <div className="rounded-2xl border border-line bg-white p-5 text-center">
            <p className="text-[14px] font-bold text-ink">검색 결과가 없어요</p>
            <p className="mt-1 text-[12px] text-sub">사업장 정보를 보내주시면 확인 후 연결 방법을 안내해 드려요.</p>
            <button type="button" onClick={()=>{setRequestDone(false);setError('');setShowRequest(true);setRequestForm(current=>({...current,name:query}));}} className="mt-4 h-11 w-full rounded-xl bg-primary text-[14px] font-bold text-white">신규 사업장 등록 요청</button>
          </div>
        )}

        {visibleResults.length > 0 && (
          <ul className="space-y-2">
            {visibleResults.map(f => (
              <li key={f.id}>
                <button
                  onClick={() => setSelected(f)}
                  className={`w-full text-left p-4 rounded-xl border transition-colors ${
                    selected?.id === f.id
                      ? 'border-primary bg-primary/5'
                      : 'border-line bg-white'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-[15px] text-ink">{f.name}</span>
                    <span className="text-[12px] text-sub bg-surface px-2 py-0.5 rounded-full">
                      {TYPE_LABEL[f.facility_type] ?? f.facility_type}
                    </span>
                  </div>
                  <p className="text-[13px] text-sub mt-0.5">{f.address_text}</p>
                </button>
              </li>
            ))}
          </ul>
        )}

        {/* 초대 코드 + 연결 버튼 */}
        {selected && (
          <div className="fixed bottom-0 inset-x-0 p-4 bg-white border-t border-line space-y-3">
            <p className="text-[13px] text-sub text-center">
              <span className="font-semibold text-ink">{selected.name}</span>에 연결할게요
            </p>
            {error && (
              <p className="text-center text-[14px] font-semibold text-warn">{error}</p>
            )}
            <input
              type="text"
              value={inviteCode}
              onChange={e => setInviteCode(e.target.value.toUpperCase())}
              placeholder="초대 코드 입력 (예: A1B2C3D4)"
              className="w-full border border-line rounded-xl px-4 py-3 text-[15px] font-mono tracking-widest outline-none focus:border-primary"
            />
            <button
              onClick={handleClaim}
              disabled={isPending || inviteCode.trim().length < 4}
              className="w-full py-4 bg-primary text-white rounded-xl font-bold text-[16px] disabled:opacity-50"
            >
              {isPending ? '연결 중...' : `내 ${businessType==='pharmacy'?'약국':'병원'}으로 연결하기`}
            </button>
            {inviteCode.trim().length < 4 && (
              <p className="text-center text-[12px] text-sub">
                잇닿에서 받은 초대 코드를 입력하면 버튼이 활성화돼요
              </p>
            )}
          </div>
        )}
      </div>
      {showRequest&&(
        <>
          <button type="button" aria-label="등록 요청 닫기" onClick={()=>!isPending&&setShowRequest(false)} className="fixed inset-0 z-30 bg-black/40"/>
          <section role="dialog" aria-modal="true" aria-labelledby="request-title" className="fixed inset-x-0 bottom-0 z-40 mx-auto max-h-[90vh] max-w-app overflow-y-auto rounded-t-[24px] bg-white px-5 pb-[calc(2rem+env(safe-area-inset-bottom))] pt-5">
            <div className="mx-auto mb-5 h-1 w-10 rounded-full bg-line"/>
            {requestDone?(
              <div className="py-6 text-center">
                <div className="text-4xl">✓</div>
                <h2 id="request-title" className="mt-3 text-[20px] font-extrabold">등록 요청을 접수했어요</h2>
                <p className="mt-2 text-[13px] leading-5 text-sub">사업장 정보를 확인한 뒤 입력한 연락처로 연결 방법을 안내해 드릴게요.</p>
                <button type="button" onClick={()=>setShowRequest(false)} className="mt-6 h-12 w-full rounded-xl bg-primary font-bold text-white">확인</button>
              </div>
            ):(
              <>
                <h2 id="request-title" className="text-[19px] font-extrabold">{businessType==='pharmacy'?'약국':'병원·의원'} 등록 요청</h2>
                <p className="mt-1 text-[12px] text-sub">사업자등록증 제출은 담당자 확인 단계에서 별도로 안내합니다.</p>
                <div className="mt-4 grid grid-cols-2 gap-3">
                  <label className="col-span-2 text-[12px] font-bold text-sub">사업장명<input value={requestForm.name} onChange={e=>updateRequest('name',e.target.value)} className="mt-1 h-11 w-full rounded-xl border border-line px-3 text-[14px]" placeholder="사업장명"/></label>
                  <label className="col-span-2 text-[12px] font-bold text-sub">주소<input value={requestForm.address} onChange={e=>updateRequest('address',e.target.value)} className="mt-1 h-11 w-full rounded-xl border border-line px-3 text-[14px]" placeholder="도로명 주소"/></label>
                  <label className="text-[12px] font-bold text-sub">담당자명<input value={requestForm.contactName} onChange={e=>updateRequest('contactName',e.target.value)} className="mt-1 h-11 w-full rounded-xl border border-line px-3 text-[14px]" placeholder="홍길동"/></label>
                  <label className="text-[12px] font-bold text-sub">연락처<input inputMode="tel" value={requestForm.contactPhone} onChange={e=>updateRequest('contactPhone',e.target.value)} className="mt-1 h-11 w-full rounded-xl border border-line px-3 text-[14px]" placeholder="010-0000-0000"/></label>
                  <label className="col-span-2 text-[12px] font-bold text-sub">요청 메모 (선택)<textarea value={requestForm.note} onChange={e=>updateRequest('note',e.target.value)} className="mt-1 min-h-20 w-full resize-none rounded-xl border border-line p-3 text-[14px]" placeholder="연결을 원하는 담당자나 운영 상황"/></label>
                </div>
                {error&&<p role="alert" className="mt-3 rounded-xl bg-red-50 p-3 text-[12px] font-bold text-red-600">{error}</p>}
                <button type="button" onClick={handleRegistrationRequest} disabled={isPending||requestForm.name.trim().length<2||requestForm.address.trim().length<5||requestForm.contactName.trim().length<2||requestForm.contactPhone.replace(/\D/g,'').length<9} className="mt-4 h-12 w-full rounded-xl bg-primary text-[15px] font-bold text-white disabled:opacity-40">{isPending?'접수 중...':'등록 요청 보내기'}</button>
              </>
            )}
          </section>
        </>
      )}
    </div>
  );
}
