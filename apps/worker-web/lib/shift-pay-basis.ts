import { calcBreakMinutes, estimatedShiftPay, parseClockToMinutes } from './shared/gig-pay/shift-pay';

// 예상 지급액이 몇 시간 기준인지 — 무급 휴게를 빼서 8시간 공고가 7시간분으로 보이는 이유를 한 줄로 푼다(2026-11-05 QA).
// 금액이 공유 식에서 나온 경우에만 붙인다(시드처럼 식 밖 금액에 맞지 않는 설명을 달지 않게). 휴게 규칙은 calcBreakMinutes 를 그대로 쓴다.
export function payBasisLabel(shift: { start_time: string; end_time: string; hourly_wage: number; estimated_total_pay: number }) {
  const start = parseClockToMinutes(shift.start_time), end = parseClockToMinutes(shift.end_time);
  if (start == null || end == null || estimatedShiftPay(shift.start_time, shift.end_time, shift.hourly_wage) !== shift.estimated_total_pay) return null;
  const total = end - start > 0 ? end - start : end - start + 24 * 60;
  const breakMinutes = calcBreakMinutes(total), paid = total - breakMinutes;
  const length = [Math.floor(paid / 60) ? `${Math.floor(paid / 60)}시간` : '', paid % 60 ? `${paid % 60}분` : ''].filter(Boolean).join(' ');
  return breakMinutes ? `휴게 ${breakMinutes}분을 빼고 ${length} 기준이에요` : `휴게 없이 ${length} 기준이에요`;
}
