import { workerShellCopy, type WorkerShell } from '@/lib/worker-mode';

// 두 셸이 같은 근무표·근태 컴포넌트를 쓰더라도 현재 모드는 언제나 눈에 보여야 한다.
// staffFirst: 직원으로 연결된(또는 직원 초대를 받는) 사람에게는 의료 셸을 '내 직장'으로 부른다.
export function WorkerModeBadge({ shell, dark = false, staffFirst = false }: { shell: WorkerShell; dark?: boolean; staffFirst?: boolean }) {
  const copy = workerShellCopy(shell, staffFirst);
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-extrabold ${dark ? 'bg-white/10 text-white' : 'bg-primary/10 text-primary'}`} title={copy.detail}>
      <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${shell === 'gig' ? 'bg-primary' : dark ? 'bg-white' : 'bg-primary'}`} />
      {copy.label}
    </span>
  );
}
