'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { claimFacility, searchFacilities } from '@/lib/facility';

const TYPE_LABEL: Record<string, string> = {
  care_hospital:    '요양병원',
  general_hospital: '종합병원',
  small_hospital:   '병원·의원',
  nursing_home:     '요양원',
  home_health:      '방문간호',
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

  return (
    <div className="min-h-screen bg-surface flex flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-md space-y-6">
        {/* 헤더 */}
        <div className="text-center space-y-2">
          <div className="text-4xl">🏥</div>
          <h1 className="text-[22px] font-bold text-ink">내 병원 찾기</h1>
          <p className="text-[14px] text-sub">병원명을 검색해서 내 병원을 연결해주세요</p>
        </div>

        {/* 검색 */}
        <div className="flex gap-2">
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSearch()}
            placeholder="병원명 입력 (예: 수원요양, W여성)"
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
        {searched && results.length === 0 && (
          <p className="text-center text-[14px] text-sub">
            검색 결과가 없어요.{' '}
            <span className="text-primary">담당자에게 병원 등록을 요청해주세요.</span>
          </p>
        )}

        {results.length > 0 && (
          <ul className="space-y-2">
            {results.map(f => (
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
              <span className="font-semibold text-ink">{selected.name}</span>으로 연결할게요
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
              {isPending ? '연결 중...' : '내 병원으로 연결하기'}
            </button>
            {inviteCode.trim().length < 4 && (
              <p className="text-center text-[12px] text-sub">
                잇닿에서 받은 초대 코드를 입력하면 버튼이 활성화돼요
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
