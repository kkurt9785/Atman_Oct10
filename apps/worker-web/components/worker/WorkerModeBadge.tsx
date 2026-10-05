import type { WorkerShell } from '@/lib/worker-mode';

const COPY: Record<WorkerShell, { label: string; detail: string }> = {
  medical: { label: '병원·약국', detail: '근무 찾기 · 지원 · 출퇴근' },
  gig: { label: '긱 근무', detail: '초대받은 근무 · 출퇴근' },
};

// 두 셸이 같은 근무표·근태 컴포넌트를 쓰더라도 현재 모드는 언제나 눈에 보여야 한다.
export function WorkerModeBadge({ shell, dark = false }: { shell: WorkerShell; dark?: boolean }) {
  const copy = COPY[shell];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-extrabold ${dark ? 'bg-white/10 text-white' : shell === 'gig' ? 'bg-ink text-white' : 'bg-primary/10 text-primary'}`} title={copy.detail}>
      <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${shell === 'gig' ? 'bg-primary' : dark ? 'bg-white' : 'bg-primary'}`} />
      {copy.label}
    </span>
  );
}
