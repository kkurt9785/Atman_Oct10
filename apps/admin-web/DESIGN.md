# 잇닿 사장님 대시보드 — 디자인 원칙

대상: **40대+ 소상공인·관리자**. 기본은 모던, 필요 시 토스식 큰글씨로 확대.

## 원칙 (토스 시니어 UX + Homebase/Gusto 단순함 참고)
1. **기본 = 모던(16px)** + **큰글씨 토글**(상단) → root 16→20px, rem 기반이라 글씨·아이콘 전체 ×1.25 확대. localStorage 기억.
2. **모바일 우선** — 폭 480px 중심, 하단 4탭(홈·직원·근태·급여).
3. **한 화면 = 한 가지 일** — 큰 카드, 명확한 단일 주요 동작(56px+ 버튼).
4. **금액·시간은 크게·굵게** — 사장님이 가장 먼저 보는 정보.
5. **해요체 + 긍정형 문구** — "이번 달 급여, 다 계산해뒀어요".
6. **전문 노무용어 최소화** — 어려운 말은 쉬운 설명 동반.
7. **일관성** — 컴포넌트(`components/ui.tsx`)로 통일.

## 구조
```
app/layout.tsx        상단바(잇닿 + 큰글씨토글) + 하단탭
app/page.tsx          홈 — 이번 달 요약·빠른메뉴·오늘근무
app/staff             직원
app/timesheet         근태(QR 자동기록)
app/payroll           급여(항목 자동분리, 명세서 발급)
components/ui.tsx      Card·BigStat·PrimaryButton·ActionTile·StatusBadge
components/TextSizeToggle.tsx  큰글씨 모드
lib/mock.ts           임시 데이터 (→ 추후 Supabase + @itdat/wage-engine)
```

## 실행
```bash
cd apps/admin-web && npm install && npm run dev   # http://localhost:3000
```
(설치 전 IDE의 'Cannot find module react/tailwindcss' 오류는 정상 — install 후 사라짐)

## 확장 로드맵 (심플 → 확장)
- 지금: mock UI 골격 + 큰글씨 토글.
- 다음: Supabase 연결(org/entitlement 게이팅) → 노무 메뉴는 통합/노무 플랜만 노출.
- 그다음: wage-engine 연동 실데이터, 명세서 PDF, 전자근로계약.
</content>
