// 미출근(노쇼) 대체 근무의 시간 — 원래 시작 시각으로 열면 '이미 시작한 근무'라 직접 요청(invite_to_vacancy)·수락·공개 지원이
// 모두 거부되고 목록에서도 숨는다(2026-10-14 시작 지난 공고 차단). 그래서 '지금 + 이동 시간'(10분 단위 올림)부터 원래 종료까지로 연다.
// 남은 근무가 너무 짧으면 열지 않는다(2026-11-05 결정 A).
export const REPLACEMENT_TRAVEL_MINUTES = 30;
export const REPLACEMENT_MIN_MINUTES = 120;
export const REPLACEMENT_TOO_SHORT = '남은 근무가 2시간이 안 돼서 대체 근무를 열지 않았어요. 오늘은 근태에서 처리하고, 필요하면 다음 근무를 새로 올려 주세요.';

type ShiftTimes = { shift_date: string; start_time: string; end_time: string };

const kst = (ms: number) => { const iso = new Date(ms + 9 * 3_600_000).toISOString(); return { date: iso.slice(0, 10), time: iso.slice(11, 16) }; };

/** 원래 근무의 시작·종료(KST, 자정 넘김 반영) epoch ms. 형식이 틀리면 null */
export function shiftBoundsMs(shift: ShiftTimes): { startMs: number; endMs: number } | null {
  const startMs = Date.parse(`${shift.shift_date}T${shift.start_time.slice(0, 5)}:00+09:00`);
  let endMs = Date.parse(`${shift.shift_date}T${shift.end_time.slice(0, 5)}:00+09:00`);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;
  if (endMs <= startMs) endMs += 86_400_000;
  return { startMs, endMs };
}

/** 대체 근무 시간: max(원래 시작, 지금+이동 시간 10분 올림) ~ 원래 종료. 남은 시간이 기준보다 짧으면 null */
export function replacementWindow(original: ShiftTimes, now = Date.now()): { shiftDate: string; startTime: string; endTime: string; minutes: number } | null {
  const bounds = shiftBoundsMs(original);
  if (!bounds) return null;
  const step = 10 * 60_000;
  const startMs = Math.max(bounds.startMs, Math.ceil((now + REPLACEMENT_TRAVEL_MINUTES * 60_000) / step) * step);
  const minutes = Math.round((bounds.endMs - startMs) / 60_000);
  if (minutes < REPLACEMENT_MIN_MINUTES) return null;
  const start = kst(startMs);
  return { shiftDate: start.date, startTime: start.time, endTime: kst(bounds.endMs).time, minutes };
}
