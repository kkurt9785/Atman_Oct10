'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';

const REQUIRED = [
  { id: 'age', label: '만 18세 이상입니다', hasLink: false },
  { id: 'tos', label: '서비스 이용약관 동의', hasLink: true },
  { id: 'privacy', label: '개인정보 수집·이용 동의', hasLink: true },
  { id: 'location', label: '위치정보 이용 동의', hasLink: true },
];

export function Terms({ onNext }: { onNext: () => void }) {
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [marketing, setMarketing] = useState(false);
  const [birth, setBirth] = useState({ y: '', m: '', d: '' });

  const allRequired = REQUIRED.every((r) => checked[r.id]);
  const birthFilled = birth.y.length === 4 && birth.m.length >= 1 && birth.d.length >= 1;

  function toggleAll() {
    if (allRequired && marketing) {
      setChecked({});
      setMarketing(false);
    } else {
      const all: Record<string, boolean> = {};
      REQUIRED.forEach((r) => (all[r.id] = true));
      setChecked(all);
      setMarketing(true);
    }
  }

  const Check = ({ on }: { on: boolean }) => (
    <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 transition-colors ${on ? 'bg-primary' : 'border-2 border-line'}`}>
      {on && <svg width="12" height="9" viewBox="0 0 12 9" fill="none"><path d="M1 4L4.5 7.5L11 1" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>}
    </div>
  );

  return (
    <div className="flex flex-col min-h-screen">
      {/* Dimmed bg */}
      <div className="flex-1 bg-black/40" />

      {/* Bottom sheet — scrollable */}
      <div className="bg-white rounded-t-[24px] flex flex-col max-h-[92vh]">
        {/* 고정 헤더 */}
        <div className="px-6 pt-6 pb-2 flex-shrink-0">
          <div className="w-10 h-1 bg-line rounded mx-auto mb-6" />
          <h2 className="text-[22px] font-bold text-ink mb-1">이용 전 확인해주세요</h2>
          <p className="text-[15px] text-sub">atman 서비스 이용을 위해 동의가 필요해요</p>
        </div>

        {/* 스크롤 영역 */}
        <div className="overflow-y-auto flex-1 px-6 pt-4">
          {/* 전체 동의 */}
          <button onClick={toggleAll} className="flex items-center gap-3 w-full py-3 mb-2">
            <Check on={allRequired && marketing} />
            <span className="text-[17px] font-bold text-ink">전체 동의</span>
          </button>
          <div className="h-px bg-line mb-2" />

          {REQUIRED.map((r) => (
            <button key={r.id} onClick={() => setChecked((p) => ({ ...p, [r.id]: !p[r.id] }))}
              className="flex items-center justify-between w-full py-3">
              <div className="flex items-center gap-3">
                <Check on={!!checked[r.id]} />
                <span className="text-[15px] text-ink">
                  <span className="text-primary font-medium">(필수) </span>{r.label}
                </span>
              </div>
              {r.hasLink && <span className="text-[13px] text-tertiary underline">보기</span>}
            </button>
          ))}

          <button onClick={() => setMarketing(!marketing)}
            className="flex items-center justify-between w-full py-3 mb-5">
            <div className="flex items-center gap-3">
              <Check on={marketing} />
              <span className="text-[15px] text-ink">
                <span className="text-tertiary font-medium">(선택) </span>마케팅 알림 수신
              </span>
            </div>
            <span className="text-[13px] text-tertiary underline">보기</span>
          </button>

          {/* 생년월일 */}
          <div className="bg-bg rounded-card p-4 mb-6">
            <p className="text-[14px] font-semibold text-sub mb-3">생년월일 입력</p>
            <div className="flex gap-2">
              {([
                { k: 'y', placeholder: '출생 연도', max: 4, label: '년' },
                { k: 'm', placeholder: '월', max: 2, label: '월' },
                { k: 'd', placeholder: '일', max: 2, label: '일' },
              ] as const).map(({ k, placeholder, max, label }) => (
                <div key={k} className="flex-1 relative">
                  <input
                    type="tel"
                    value={birth[k]}
                    onChange={(e) => setBirth((p) => ({ ...p, [k]: e.target.value.replace(/\D/g, '').slice(0, max) }))}
                    placeholder={placeholder}
                    className={`w-full h-12 rounded-xl border text-center text-[16px] font-bold text-ink outline-none transition-colors placeholder:text-tertiary placeholder:text-[13px] placeholder:font-normal
                      ${birth[k] ? 'border-primary bg-white' : 'border-line bg-white'}`}
                  />
                  {birth[k] && (
                    <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[12px] text-tertiary">{label}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* 고정 하단 버튼 */}
        <div className="px-6 pb-10 pt-3 flex-shrink-0 border-t border-line">
          <Button onClick={onNext} disabled={!allRequired || !birthFilled}>동의하고 계속하기</Button>
        </div>
      </div>
    </div>
  );
}
