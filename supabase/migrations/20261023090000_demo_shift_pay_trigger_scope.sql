-- 2026-10-23 GPT 검토 — 시연 공고 예상액 트리거가 메모(DEMO-·LIVE-SALES-DEMO)만 보고 작동하던 것을
-- 시연 사업장(facilities.is_demo)인 경우로 좁힌다. 실제 사업장 공고 메모에 같은 접두어가 들어가도 사업장이 입력한 예상액을 덮지 않는다.
-- 사업장 행은 RLS 와 무관하게 읽어야 하므로 SECURITY DEFINER + 빈 search_path (모든 이름은 스키마까지 적는다)
CREATE OR REPLACE FUNCTION public.demo_shift_estimated_pay_trg() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF (NEW.notes LIKE 'DEMO-%' OR NEW.notes LIKE 'LIVE-SALES-DEMO%')
     AND EXISTS (SELECT 1 FROM public.facilities f WHERE f.id = NEW.facility_id AND f.is_demo) THEN
    NEW.estimated_total_pay := coalesce(public.estimated_shift_pay(NEW.start_time, NEW.end_time, NEW.hourly_wage), NEW.estimated_total_pay);
  END IF;
  RETURN NEW;
END $$;

-- 트리거 함수는 RPC 로 부를 일이 없다
REVOKE ALL ON FUNCTION public.demo_shift_estimated_pay_trg() FROM PUBLIC, anon, authenticated;

-- 어제 만든 계산 함수도 search_path 고정(Supabase 보안 점검 경고 대상)
ALTER FUNCTION public.estimated_shift_pay(time, time, numeric) SET search_path = '';
