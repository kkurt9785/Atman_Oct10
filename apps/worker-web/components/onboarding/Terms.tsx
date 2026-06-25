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
  const [birth, setBirth] = useState({ y: '1995', m: '03', d: '15' });

  const allRequired = REQUIRED.every((r) => checked[r.id]);

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

  function toggle(id: string) {
    setChecked((p) => ({ ...p, [id]: !p[id] }));
  }

  const Check = ({ on }: { on: boolean }) => (
    <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ${on ? 'bg-primary' : 'border-2 border-line'}`}>
      {on && <svg width="12" height="9" viewBox="0 0 12 9" fill="none"><path d="M1 4L4.5 7.5L11 1" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>}
    </div>
  );

  return (
    <div className="flex flex-col min-h-screen">
      {/* Dimmed bg */}
      <div className="flex-1 bg-black/40" />

      {/* Bottom sheet */}
      <div className="bg-white rounded-t-[24px] px-6 pt-6 pb-10">
        <div className="w-10 h-1 bg-line rounded mx-auto mb-6" />
        <h2 className="text-[22px] font-bold text-ink mb-1">이용 전 확인해주세요</h2>
        <p className="text-[15px] text-sub mb-6">atman 서비스 이용을 위해 동의가 필요해요</p>

        {/* 전체 동의 */}
        <button onClick={toggleAll} className="flex items-center gap-3 w-full py-3 mb-2">
          <Check on={allRequired && marketing} />
          <span className="text-[17px] font-bold text-ink">전체 동의</span>
        </button>
        <div className="h-px bg-line mb-2" />

        {REQUIRED.map((r) => (
          <button key={r.id} onClick={() => toggle(r.id)} className="flex items-center justify-between w-full py-3">
            <div className="flex items-center gap-3">
              <Check on={!!checked[r.id]} />
              <span className="text-[15px] text-ink">
                <span className="text-primary font-medium">(필수) </span>{r.label}
              </span>
            </div>
            {r.hasLink && <span className="text-[13px] text-tertiary underline">보기</span>}
          </button>
        ))}

        <button onClick={() => setMarketing(!marketing)} className="flex items-center justify-between w-full py-3 mb-4">
          <div className="flex items-center gap-3">
            <Check on={marketing} />
            <span className="text-[15px] text-ink">
              <span className="text-tertiary font-medium">(선택) </span>마케팅 알림 수신
            </span>
          </div>
          <span className="text-[13px] text-tertiary underline">보기</span>
        </button>

        {/* 생년월일 */}
        <p className="text-[14px] font-medium text-sub mb-3">생년월일 입력</p>
        <div className="flex gap-3 mb-6">
          {(['y', 'm', 'd'] as const).map((k, i) => (
            <input
              key={k}
              value={birth[k]}
              onChange={(e) => setBirth((p) => ({ ...p, [k]: e.target.value }))}
              maxLength={k === 'y' ? 4 : 2}
              placeholder={['YYYY', 'MM', 'DD'][i]}
              className="flex-1 h-14 rounded-card border border-line text-center text-[17px] font-semibold text-ink focus:border-primary outline-none"
            />
          ))}
        </div>

        <Button onClick={onNext} disabled={!allRequired}>동의하고 계속하기</Button>
      </div>
    </div>
  );
}
