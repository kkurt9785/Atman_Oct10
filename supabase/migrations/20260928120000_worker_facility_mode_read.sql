-- 워커 앱은 연결된 사업장이 의료 사업장인지 긱 근무지인지 구분할 때
-- facilities.registration_source 하나만 추가로 읽는다. 기존 행 RLS는 그대로 적용되어
-- 활성·미삭제 사업장만 보이며, 연락처·사업자번호·QR 비밀값은 계속 차단된다.
GRANT SELECT (registration_source) ON public.facilities TO authenticated;
