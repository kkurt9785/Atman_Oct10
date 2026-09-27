// 잇닿 마크 "맞닿음" — 워커 앱과 같은 도형. 사업장(파랑)과 사람(검정)이 겹치는 한 칸이 '닿음'.
type Tone = 'light' | 'dark';
const TONES: Record<Tone, { a: string; b: string; touch: string }> = {
  light: { a: '#3182F6', b: '#191F28', touch: '#FFFFFF' },
  dark: { a: '#4D8DFF', b: '#FFFFFF', touch: '#191F28' },
};

export function BrandMark({ size = 24, tone = 'light' }: { size?: number; tone?: Tone }) {
  const c = TONES[tone];
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 52 52" fill="none">
      <rect x="4" y="4" width="28" height="28" rx="8" fill={c.a} />
      <rect x="20" y="20" width="28" height="28" rx="8" fill={c.b} />
      <rect x="20" y="20" width="12" height="12" rx="3" fill={c.touch} />
    </svg>
  );
}

export function Wordmark({ size = 18, tone = 'light', suffix = '사장님' }: { size?: number; tone?: Tone; suffix?: string | null }) {
  return (
    <span className="inline-flex items-center gap-2">
      <BrandMark size={Math.round(size * 1.2)} tone={tone} />
      <span style={{ fontSize: size }} className={`font-extrabold leading-none tracking-[-0.5px] ${tone === 'dark' ? 'text-white' : 'text-ink'}`}>
        잇닿{suffix && <span className={tone === 'dark' ? 'text-white/60' : 'text-primary'}> {suffix}</span>}
      </span>
    </span>
  );
}
