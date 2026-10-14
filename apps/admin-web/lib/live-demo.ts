export const LIVE_DEMO_REGISTRATION_NUMBERS = [
  'DEMO-TARGET-0001',
  'DEMO-TARGET-PHARMACY',
  'DEMO-TARGET-0026',
] as const;

export function isLiveDemoFacility(facility: {
  is_demo?: boolean | null;
  business_registration_number?: string | null;
} | null | undefined) {
  return Boolean(
    facility?.is_demo
      && facility.business_registration_number
      && LIVE_DEMO_REGISTRATION_NUMBERS.includes(
        facility.business_registration_number as typeof LIVE_DEMO_REGISTRATION_NUMBERS[number],
      ),
  );
}

export function isLiveDemoShift(notes: string | null | undefined) {
  return Boolean(notes?.startsWith('LIVE-SALES-DEMO-'));
}

// 지원 가능한 미래 시간이어야 한다. KST 자정 전후에도 날짜와 시간이 함께 이동한다.
export function liveDemoWindow(now = Date.now()) {
  const quarterHour = 15 * 60 * 1000;
  const start = (Math.floor(now / quarterHour) + 1) * quarterHour;
  const kst = (time: number) => new Date(time + 9 * 60 * 60 * 1000).toISOString();
  return { shiftDate: kst(start).slice(0, 10), startTime: kst(start).slice(11, 16), endTime: kst(start + 45 * 60 * 1000).slice(11, 16) };
}
