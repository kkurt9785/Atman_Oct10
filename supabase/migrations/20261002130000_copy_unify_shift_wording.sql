-- 화면 문구 통일 — DB 함수가 직접 내보내는 안내·알림 문구
--
-- 앱 화면은 '시프트' 대신 공고(모집 글)·근무(일하는 자리)로 통일했다. 지원·출퇴근 오류와 알림 제목은
-- DB 함수가 만들어 그대로 화면에 보이므로 함께 바꾼다. 함수 본문은 운영 DB에 있는 정의를 읽어 문구만 치환한다
-- (런타임 패치 — 그동안 덧댄 수정이 사라지지 않게). 다시 돌려도 결과가 같다.
DO $patch$
DECLARE
  r record;
  v_def text;
  v_new text;
  v_count integer := 0;
BEGIN
  FOR r IN
    SELECT p.oid
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind = 'f'
      AND (p.prosrc LIKE '%시프트%' OR p.prosrc LIKE '%해당 워커에게%' OR p.prosrc LIKE '%체크아웃 완료된%')
  LOOP
    v_def := pg_get_functiondef(r.oid);
    v_new := v_def;
    v_new := replace(v_new, '🎉 시프트 수락됐어요!', '🎉 지원이 수락됐어요!');
    v_new := replace(v_new, '이미 지원한 시프트예요', '이미 지원한 공고예요');
    v_new := replace(v_new, '현재 지원할 수 없는 시프트예요', '현재 지원할 수 없는 공고예요');
    v_new := replace(v_new, '자격 조건이 맞지 않는 시프트예요', '직군 조건이 맞지 않는 공고예요');
    v_new := replace(v_new, '이미 체크아웃 완료된 시프트예요', '이미 퇴근 처리된 근무예요');
    v_new := replace(v_new, '해당 워커에게', '해당 근무자에게');
    v_new := replace(v_new, '시프트', '근무');
    IF v_new IS DISTINCT FROM v_def THEN
      EXECUTE v_new;
      v_count := v_count + 1;
    END IF;
  END LOOP;
  RAISE NOTICE 'copy patch: % functions updated', v_count;
END
$patch$;

-- Free 요금제: 이름의 '파일럿'은 내부 용어였고, 소개 문구의 '월 3건'은 실제 한도(공고 월 1건)와 달랐다
UPDATE public.service_plans
SET name = 'Free',
    features = jsonb_set(features, '{tagline}', to_jsonb('공고 월 1건으로 직접 써 보는 인력 운영'::text))
WHERE code = 'free';
