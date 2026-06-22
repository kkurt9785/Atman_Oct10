// 임시 mock 데이터 (추후 Supabase 연결)
export const SHOP = { name: '수성못 카페', plan: 'bundle' as const, is5Plus: false };

export type Staff = {
  id: string; name: string; job: string;
  todayStatus: '근무중' | '퇴근' | '예정' | '결근';
  monthMinutes: number;       // 이번 달 누적 근로(분)
  hourlyWage: number;
};

export const STAFF: Staff[] = [
  { id: '1', name: '김미영', job: '바리스타', todayStatus: '근무중', monthMinutes: 9120, hourlyWage: 11000 },
  { id: '2', name: '이준호', job: '주방',     todayStatus: '근무중', monthMinutes: 7800, hourlyWage: 10500 },
  { id: '3', name: '박서연', job: '홀서빙',   todayStatus: '예정',   monthMinutes: 4200, hourlyWage: 10320 },
  { id: '4', name: '정태섭', job: '마감',     todayStatus: '퇴근',   monthMinutes: 6300, hourlyWage: 12000 },
];

export const won = (n: number) => n.toLocaleString('ko-KR') + '원';
export const hours = (min: number) => `${Math.floor(min / 60)}시간`;

// 이번 달 요약 (간이 — 실제는 wage-engine 집계)
export const SUMMARY = {
  totalMinutes: STAFF.reduce((s, x) => s + x.monthMinutes, 0),
  estimatedPay: STAFF.reduce((s, x) => s + Math.round((x.monthMinutes / 60) * x.hourlyWage), 0),
  workingNow: STAFF.filter((x) => x.todayStatus === '근무중').length,
};
