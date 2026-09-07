'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { claimFacility, registerFacilitySelf, requestFacilityRegistration } from '@/lib/facility';
import { FacilityPinMap } from '@/components/FacilityPinMap';
import type { FacilitySearchHit } from '@/app/api/facility-search/route';

const TYPE_LABEL: Record<string, string> = {
  care_hospital:    '요양병원',
  general_hospital: '종합병원',
  small_hospital:   '병원·의원',
  nursing_home:     '요양원',
  home_health:      '방문간호',
  pharmacy:         '약국',
};

type Hit = FacilitySearchHit;

export default function ClaimFacilityPage() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Hit[]>([]);
  const [sources, setSources] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Hit | null>(null);
  const [inviteCode, setInviteCode] = useState('');
  const [searched, setSearched] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState('');
  // 유형은 검색 게이트가 아니라 결과 필터 — 기본 '전체'라 어떤 유형이든 숨겨지지 않는다.
  const [typeFilter,setTypeFilter]=useState<'all'|'medical'|'care'|'pharmacy'>('all');
  const [searching,setSearching]=useState(false);
  const [searchFailed,setSearchFailed]=useState(false);
  const [showRequest,setShowRequest]=useState(false);
  const [requestType,setRequestType]=useState<''|'medical'|'care'|'pharmacy'>('');
  const [requestForm,setRequestForm]=useState({name:'',address:'',contactName:'',contactPhone:'',note:''});
  const [requestDone,setRequestDone]=useState(false);
  // 즉시 등록 시트 — 검색 결과(심평원/카카오)를 확인·핀 조정 후 등록
  const [registerHit,setRegisterHit]=useState<Hit|null>(null);
  const [registerForm,setRegisterForm]=useState({name:'',phone:'',lng:0,lat:0});
  const isPharmacyType=(t:string)=>t==='pharmacy';
  const isCareType=(t:string)=>t==='care_hospital';
  const pharmacyCount=results.filter(f=>isPharmacyType(f.facilityType)).length;
  const careCount=results.filter(f=>isCareType(f.facilityType)).length;
  const medicalCount=results.length-pharmacyCount-careCount;
  const visibleResults=typeFilter==='all'?results
    :results.filter(f=>typeFilter==='pharmacy'?isPharmacyType(f.facilityType):typeFilter==='care'?isCareType(f.facilityType):!isPharmacyType(f.facilityType)&&!isCareType(f.facilityType));
  const hiddenByFilter=results.length-visibleResults.length;
  const hiraUnavailable=searched&&sources.hira&&sources.hira!=='ok';

  async function handleSearch() {
    if (query.trim().length < 2 || searching) return;
    setSearching(true);setSearchFailed(false);setSelected(null);setRegisterHit(null);
    try{
      const res=await fetch(`/api/facility-search?q=${encodeURIComponent(query.trim())}`,{cache:'no-store'});
      if(!res.ok)throw new Error('search failed');
      const data=await res.json() as {hits:Hit[];sources:Record<string,string>};
      setResults(data.hits);setSources(data.sources??{});
      setSearched(true);
    }catch{
      setResults([]);setSearched(true);setSearchFailed(true);
    }finally{
      setSearching(false);
    }
  }

  function pick(hit:Hit){
    setError('');
    if(hit.source==='db'||hit.registeredFacilityId){
      // 잇닿에 이미 있는 사업장 → 초대 코드로 연결
      setSelected({...hit,id:hit.registeredFacilityId??hit.id});setRegisterHit(null);
      return;
    }
    if(hit.lng==null||hit.lat==null){setError('이 사업장은 좌표가 없어 바로 등록할 수 없어요. 등록 요청으로 보내 주세요.');return;}
    setSelected(null);
    setRegisterHit(hit);
    setRegisterForm({name:hit.name,phone:hit.phone??'',lng:hit.lng,lat:hit.lat});
  }

  async function handleClaim() {
    if (!selected) return;
    setError('');
    startTransition(async () => {
      const result = await claimFacility(selected.id, inviteCode);
      if (result.ok) router.replace('/');
      else setError(result.error ?? '연결 실패');
    });
  }

  async function handleRegister(){
    if(!registerHit)return;
    setError('');
    startTransition(async()=>{
      const result=await registerFacilitySelf({
        name:registerForm.name.trim(),
        facilityType:registerHit.facilityType,
        addressText:registerHit.address,
        lng:registerForm.lng,lat:registerForm.lat,
        phone:registerForm.phone.trim()||null,
        hiraYkiho:registerHit.hiraYkiho,hiraClCd:registerHit.hiraClCd,bedCount:registerHit.bedCount,
        source:registerHit.source==='hira'?'self_hira':'self_kakao',
      });
      if(result.ok)router.replace('/');
      else setError(result.error??'사업장을 등록하지 못했어요.');
    });
  }

  function updateRequest(key:keyof typeof requestForm,value:string){
    setRequestForm(current=>({...current,[key]:value}));
  }

  async function handleRegistrationRequest(){
    if(!requestType)return;
    setError('');
    startTransition(async()=>{
      const result=await requestFacilityRegistration({
        facilityType:requestType==='pharmacy'?'pharmacy':requestType==='care'?'care_hospital':'small_hospital',
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
          <div className="text-4xl">🏥💊</div>
          <h1 className="text-[22px] font-bold text-ink">내 사업장 찾기</h1>
          <p className="text-[14px] text-sub">약국·병원·요양병원명을 검색하면 바로 등록하거나 초대 코드로 연결할 수 있어요</p>
        </div>

        {/* 검색 — 통합 서치바 (버튼이 바 안에 있어 좁은 화면에서도 안 깨짐) */}
        <div className="flex items-center gap-1 rounded-2xl border border-line bg-white p-1.5 pl-4 shadow-sm focus-within:border-primary">
          <input
            type="search"
            enterKeyHint="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.nativeEvent.isComposing && handleSearch()}
            placeholder="사업장명 검색"
            aria-label="사업장명 검색"
            className="h-11 min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-sub"
          />
          <button
            onClick={handleSearch}
            disabled={searching}
            aria-label="검색"
            className="flex h-11 w-12 shrink-0 items-center justify-center rounded-xl bg-primary text-white disabled:opacity-50"
          >
            {searching
              ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden="true"/>
              : <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2.4"/><path d="M20 20l-3.5-3.5" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"/></svg>}
          </button>
        </div>
        <p className="-mt-4 px-1 text-[12px] text-sub">예: W여성, 수원 온누리 — 전국 병원·약국 정보(심평원)에서 찾아드려요</p>
        {hiraUnavailable&&<p role="status" className="-mt-3 rounded-xl bg-amber-50 px-3 py-2 text-[12px] text-amber-700">전국 요양기관 조회가 잠시 불가해 잇닿에 등록된 사업장만 보여요. 없으면 아래 등록 요청을 이용해 주세요.</p>}

        {/* 유형 필터 칩 — 결과를 거르기만 하고, 기본 '전체'라 아무것도 숨기지 않는다 */}
        {searched && results.length > 0 && (
          <div className="flex gap-2" role="group" aria-label="사업장 유형 필터">
            {([['all',`전체 ${results.length}`],['medical',`병원·의원 ${medicalCount}`],['care',`요양병원 ${careCount}`],['pharmacy',`약국 ${pharmacyCount}`]] as const).map(([key,label])=>(
              <button key={key} type="button" onClick={()=>{setTypeFilter(key);setSelected(null);setRegisterHit(null);}}
                aria-pressed={typeFilter===key}
                className={`h-9 rounded-full border px-3 text-[13px] font-bold ${typeFilter===key?'border-primary bg-primary/5 text-primary':'border-line bg-white text-sub'}`}>
                {label}
              </button>
            ))}
          </div>
        )}

        {/* 결과 */}
        {searched && searchFailed && (
          <div role="alert" className="rounded-2xl border border-line bg-white p-5 text-center">
            <p className="text-[14px] font-bold text-ink">검색에 실패했어요</p>
            <p className="mt-1 text-[12px] text-sub">네트워크 상태를 확인하고 다시 시도해 주세요.</p>
            <button type="button" onClick={handleSearch} className="mt-4 h-11 w-full rounded-xl bg-primary text-[14px] font-bold text-white">다시 검색</button>
          </div>
        )}
        {searched && !searchFailed && visibleResults.length === 0 && (
          <div className="rounded-2xl border border-line bg-white p-5 text-center">
            <p className="text-[14px] font-bold text-ink">검색 결과가 없어요</p>
            {hiddenByFilter>0?(
              <>
                <p className="mt-1 text-[12px] text-sub">다른 유형에서 {hiddenByFilter}건을 찾았어요.</p>
                <button type="button" onClick={()=>setTypeFilter('all')} className="mt-4 h-11 w-full rounded-xl bg-primary text-[14px] font-bold text-white">전체 결과 보기</button>
              </>
            ):(
              <>
                <p className="mt-1 text-[12px] text-sub">사업장 정보를 보내주시면 확인 후 연결 방법을 안내해 드려요.</p>
                <button type="button" onClick={()=>{setRequestDone(false);setError('');setShowRequest(true);setRequestForm(current=>({...current,name:query}));}} className="mt-4 h-11 w-full rounded-xl bg-primary text-[14px] font-bold text-white">신규 사업장 등록 요청</button>
              </>
            )}
          </div>
        )}

        {visibleResults.length > 0 && (
          <ul className="space-y-2 pb-40">
            {visibleResults.map(f => {
              const active=(selected?.id===f.id)||(registerHit?.id===f.id);
              const registered=f.source==='db'||Boolean(f.registeredFacilityId);
              return (
              <li key={`${f.source}:${f.id}`}>
                <button
                  onClick={() => pick(f)}
                  className={`w-full text-left p-4 rounded-xl border transition-colors ${active?'border-primary bg-primary/5':'border-line bg-white'}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-[15px] text-ink">{f.name}</span>
                    <span className="shrink-0 text-[12px] text-sub bg-surface px-2 py-0.5 rounded-full">
                      {TYPE_LABEL[f.facilityType] ?? f.typeLabel}
                    </span>
                  </div>
                  <p className="text-[13px] text-sub mt-0.5">{f.address}</p>
                  <p className={`mt-1.5 text-[11px] font-bold ${registered?'text-sub':'text-primary'}`}>
                    {registered?'잇닿 등록 사업장 · 초대 코드로 연결':f.source==='hira'?'심평원 요양기관 · 바로 등록 가능':'지도 검색 결과 · 바로 등록 가능'}
                  </p>
                </button>
              </li>
            );})}
          </ul>
        )}

        {/* 초대 코드 + 연결 버튼 (잇닿 등록 사업장) */}
        {selected && (
          <div className="fixed bottom-0 inset-x-0 mx-auto max-w-app p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] bg-white border-t border-line space-y-3">
            <p className="text-[13px] text-sub text-center">
              <span className="font-semibold text-ink">{selected.name}</span>
              <span className="ml-1 rounded-full bg-surface px-2 py-0.5 text-[11px]">{TYPE_LABEL[selected.facilityType]??selected.typeLabel}</span>에 연결할게요
            </p>
            {error && (
              <p role="alert" className="text-center text-[14px] font-semibold text-warn">{error}</p>
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
              {isPending ? '연결 중...' : `내 ${isPharmacyType(selected.facilityType)?'약국':'병원'}으로 연결하기`}
            </button>
            {inviteCode.trim().length < 4 && (
              <p className="text-center text-[12px] text-sub">
                잇닿에서 받은 초대 코드를 입력하면 버튼이 활성화돼요
              </p>
            )}
          </div>
        )}
        {error&&!selected&&!registerHit&&!showRequest&&<p role="alert" className="rounded-xl bg-red-50 p-3 text-[12px] font-bold text-red-600">{error}</p>}
      </div>

      {/* 즉시 등록 시트 (심평원·카카오 결과) */}
      {registerHit&&(
        <>
          <button type="button" aria-label="등록 닫기" onClick={()=>!isPending&&setRegisterHit(null)} className="fixed inset-0 z-30 bg-black/40"/>
          <section role="dialog" aria-modal="true" aria-labelledby="register-title" className="fixed inset-x-0 bottom-0 z-40 mx-auto max-h-[92vh] max-w-app overflow-y-auto rounded-t-[24px] bg-white px-5 pb-[calc(2rem+env(safe-area-inset-bottom))] pt-5">
            <div className="mx-auto mb-5 h-1 w-10 rounded-full bg-line"/>
            <h2 id="register-title" className="text-[19px] font-extrabold">이 사업장으로 등록할게요</h2>
            <p className="mt-1 text-[12px] leading-5 text-sub">
              {registerHit.source==='hira'?'심평원 요양기관 정보로 기본값을 채웠어요. ':'지도 검색 정보로 기본값을 채웠어요. '}
              등록 후 잇닿이 확인하면 공고 등록이 열려요. 사업자등록번호는 설정에서 입력합니다.
            </p>
            <div className="mt-4 rounded-xl bg-surface px-4 py-3 text-[12px] text-sub">
              <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-bold text-primary">{TYPE_LABEL[registerHit.facilityType]??registerHit.typeLabel}</span>
              <span className="ml-2">{registerHit.address}</span>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <label className="col-span-2 text-[12px] font-bold text-sub">사업장명<input value={registerForm.name} onChange={e=>setRegisterForm(c=>({...c,name:e.target.value}))} className="mt-1 h-11 w-full rounded-xl border border-line px-3 text-[14px]"/></label>
              <label className="col-span-2 text-[12px] font-bold text-sub">대표 전화 (선택)<input inputMode="tel" value={registerForm.phone} onChange={e=>setRegisterForm(c=>({...c,phone:e.target.value}))} className="mt-1 h-11 w-full rounded-xl border border-line px-3 text-[14px]" placeholder="031-000-0000"/></label>
            </div>
            <p className="mt-4 text-[12px] font-bold text-sub">출퇴근 인증 위치</p>
            <FacilityPinMap className="mt-1" lng={registerForm.lng} lat={registerForm.lat} radiusMeters={100} onChange={({lng,lat})=>setRegisterForm(c=>({...c,lng,lat}))}/>
            {error&&<p role="alert" className="mt-3 rounded-xl bg-red-50 p-3 text-[12px] font-bold text-red-600">{error}</p>}
            <button type="button" onClick={handleRegister} disabled={isPending||registerForm.name.trim().length<2} className="mt-4 h-12 w-full rounded-xl bg-primary text-[15px] font-bold text-white disabled:opacity-40">{isPending?'등록 중...':'사업장 등록하고 시작하기'}</button>
            <p className="mt-2 text-center text-[11px] text-sub">이미 다른 관리자가 등록한 사업장이면 초대 코드 연결로 안내돼요</p>
          </section>
        </>
      )}

      {/* 등록 요청 시트 (검색으로도 못 찾을 때) */}
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
                <h2 id="request-title" className="text-[19px] font-extrabold">신규 사업장 등록 요청</h2>
                <p className="mt-1 text-[12px] text-sub">사업자등록증 제출은 담당자 확인 단계에서 별도로 안내합니다.</p>
                <p className="mt-4 text-[12px] font-bold text-sub">사업장 유형</p>
                <div className="mt-1 grid grid-cols-3 gap-2">
                  <button type="button" onClick={()=>setRequestType('pharmacy')} aria-pressed={requestType==='pharmacy'} className={`min-h-16 rounded-xl border px-2 text-center text-[13px] font-bold ${requestType==='pharmacy'?'border-primary bg-primary/5 text-primary':'border-line'}`}><span className="block">약국</span><span className="mt-1 block text-[10px] font-medium text-sub">5명 59,000원부터</span></button>
                  <button type="button" onClick={()=>setRequestType('medical')} aria-pressed={requestType==='medical'} className={`min-h-16 rounded-xl border px-2 text-center text-[13px] font-bold ${requestType==='medical'?'border-primary bg-primary/5 text-primary':'border-line'}`}><span className="block">병원·의원</span><span className="mt-1 block text-[10px] font-medium text-sub">10명 69,000원</span></button>
                  <button type="button" onClick={()=>setRequestType('care')} aria-pressed={requestType==='care'} className={`min-h-16 rounded-xl border px-2 text-center text-[13px] font-bold ${requestType==='care'?'border-primary bg-primary/5 text-primary':'border-line'}`}><span className="block">요양병원</span><span className="mt-1 block text-[10px] font-medium text-sub">20명 119,000원</span></button>
                </div>
                <p className="mt-2 text-[11px] leading-4 text-sub">30일 무료 체험 후 선택한 업종과 관리 인원에 맞는 요금제만 표시됩니다.</p>
                <div className="mt-4 grid grid-cols-2 gap-3">
                  <label className="col-span-2 text-[12px] font-bold text-sub">사업장명<input value={requestForm.name} onChange={e=>updateRequest('name',e.target.value)} className="mt-1 h-11 w-full rounded-xl border border-line px-3 text-[14px]" placeholder="사업장명"/></label>
                  <label className="col-span-2 text-[12px] font-bold text-sub">주소<input value={requestForm.address} onChange={e=>updateRequest('address',e.target.value)} className="mt-1 h-11 w-full rounded-xl border border-line px-3 text-[14px]" placeholder="도로명 주소"/></label>
                  <label className="text-[12px] font-bold text-sub">담당자명<input value={requestForm.contactName} onChange={e=>updateRequest('contactName',e.target.value)} className="mt-1 h-11 w-full rounded-xl border border-line px-3 text-[14px]" placeholder="홍길동"/></label>
                  <label className="text-[12px] font-bold text-sub">연락처<input inputMode="tel" value={requestForm.contactPhone} onChange={e=>updateRequest('contactPhone',e.target.value)} className="mt-1 h-11 w-full rounded-xl border border-line px-3 text-[14px]" placeholder="010-0000-0000"/></label>
                  <label className="col-span-2 text-[12px] font-bold text-sub">요청 메모 (선택)<textarea value={requestForm.note} onChange={e=>updateRequest('note',e.target.value)} className="mt-1 min-h-20 w-full resize-none rounded-xl border border-line p-3 text-[14px]" placeholder="연결을 원하는 담당자나 운영 상황"/></label>
                </div>
                {error&&<p role="alert" className="mt-3 rounded-xl bg-red-50 p-3 text-[12px] font-bold text-red-600">{error}</p>}
                <button type="button" onClick={handleRegistrationRequest} disabled={isPending||!requestType||requestForm.name.trim().length<2||requestForm.address.trim().length<5||requestForm.contactName.trim().length<2||requestForm.contactPhone.replace(/\D/g,'').length<9} className="mt-4 h-12 w-full rounded-xl bg-primary text-[15px] font-bold text-white disabled:opacity-40">{isPending?'접수 중...':'등록 요청 보내기'}</button>
                {!requestType&&<p className="mt-2 text-center text-[12px] text-sub">사업장 유형을 선택하면 보낼 수 있어요</p>}
              </>
            )}
          </section>
        </>
      )}
    </div>
  );
}
