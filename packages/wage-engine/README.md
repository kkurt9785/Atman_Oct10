# @itdat/wage-engine

한국 근로기준법 **법정수당 계산 엔진**. 순수 함수 + 룰 버전드.
포괄임금 금지(2026.4 지침) 대응 — 실근로시간 기준 항목별 산출.

## 사용

```ts
import { calcShiftWage, calcWeeklyHolidayPay } from '@itdat/wage-engine';

const wage = calcShiftWage(
  { startAt: '2026-07-01T22:00:00', endAt: '2026-07-02T06:00:00' }, // 철야
  12000,                  // 시급
  { is5Plus: true },      // 사업장 정책
);
// → { base, overtimePremium, nightPremium, holidayPremium, gross, ruleVersion, warnings }

const weekly = calcWeeklyHolidayPay(40, true, 12000); // 주휴수당
```

## 적용 룰 (RULESET_2026, `version: '2026.1'`)

| 항목 | 규칙 | 근거 |
|---|---|---|
| 최저시급 | 10,320원 | 고용노동부 고시 |
| 연장 | 1일 8h 초과 +50% | §56 |
| 야간 | 22:00~06:00 +50% (중복 가산) | §56 |
| 휴일 | 8h 이내 +50% / 초과 +100% | §56 |
| 5인 미만 | 가산 미적용(약정 시만) | §11 |
| 주휴 | 주 15h↑ + 개근 → (주소정/40)×8h 유급 | §55 |
| 휴게 | 4h↑30분 / 8h↑60분, 무급 공제 | §54 |

## 테스트

```bash
npm test          # node --experimental-strip-types src/index.test.ts
```

## 설계 메모
- **룰 버전드**: 법 개정 시 `RULESET_20XX` 추가 → 과거 계산은 당시 버전으로 재현(분쟁 대응).
- **순수 함수**: DB/IO 없음 → Edge Function·앱·배치 어디서나 동일 결과.
- v1 가정: 휴게는 야간 시간대에 없다고 보고 야간분을 실근로 상한으로 캡. 휴일근로 시 연장 가산은 휴일 초과(+100%)로 흡수(중복 배제).
- 주(weekly) 단위 연장(40h 초과)·정확한 휴게 배치는 C(임금대장) 집계 단계에서 보강.
</content>
