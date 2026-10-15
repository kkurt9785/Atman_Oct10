// Browser/SSR shared rules. Never depend on the device's timezone.
export function attendanceTimeKST(value: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return '—';
  return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(value));
}

export function checkDeadlineKST(value: string, now = Date.now()): string | null {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new Error('확인 기한을 올바르게 입력해 주세요.');
  const date = new Date(`${value}:00+09:00`);
  if (!Number.isFinite(date.getTime()) || new Date(date.getTime() + 9 * 3600000).toISOString().slice(0, 16) !== value) throw new Error('확인 기한을 올바르게 입력해 주세요.');
  if (date.getTime() <= now) throw new Error('확인 기한은 현재 이후로 설정해 주세요.');
  return date.toISOString();
}

type ScheduledWorker = { staffId: string; startTime: string; endTime: string };
type ScheduledProject = { startTime: string; endTime: string; participants: { staffId: string }[] };
export function standaloneWorkers<T extends ScheduledWorker>(workers: T[], projects: ScheduledProject[]): T[] {
  // A different shift for the same person must not disappear.
  return workers.filter(worker => !projects.some(project => project.startTime.slice(0, 5) === worker.startTime.slice(0, 5)
    && project.endTime.slice(0, 5) === worker.endTime.slice(0, 5)
    && project.participants.some(person => person.staffId === worker.staffId)));
}
