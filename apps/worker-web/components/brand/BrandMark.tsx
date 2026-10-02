// 잇닿 마크 "맞닿음": 사업장(파랑)과 사람(검정)이 겹치는 한 칸이 곧 '닿음'.
// 근태 화면의 '닿기' 버튼과 같은 도형이라, 로고를 본 사람이 버튼을 보고 바로 이해한다.
type Tone = 'light' | 'dark' | 'onPrimary';

const TONES: Record<Tone, { a: string; b: string; touch: string }> = {
  light: { a: '#3182F6', b: '#191F28', touch: '#FFFFFF' },
  dark: { a: '#4D8DFF', b: '#FFFFFF', touch: '#0F1420' },
  onPrimary: { a: 'rgba(255,255,255,0.45)', b: '#FFFFFF', touch: '#1B64DA' },
};

export function BrandMark({ size = 24, tone = 'light', className }: { size?: number; tone?: Tone; className?: string }) {
  const c = TONES[tone];
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 52 52" fill="none" className={className}>
      <rect x="4" y="4" width="28" height="28" rx="8" fill={c.a} />
      <rect x="20" y="20" width="28" height="28" rx="8" fill={c.b} />
      <rect x="20" y="20" width="12" height="12" rx="3" fill={c.touch} />
    </svg>
  );
}

export function Wordmark({ tone = 'light', size = 20, suffix }: { tone?: 'light' | 'dark'; size?: number; suffix?: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <BrandMark size={Math.round(size * 1.2)} tone={tone} />
      <span style={{ fontSize: size }} className={`font-extrabold leading-none tracking-[-0.5px] ${tone === 'dark' ? 'text-white' : 'text-ink'}`}>
        잇닿{suffix && <span className={tone === 'dark' ? 'text-white/60' : 'text-primary'}> {suffix}</span>}
      </span>
    </span>
  );
}
