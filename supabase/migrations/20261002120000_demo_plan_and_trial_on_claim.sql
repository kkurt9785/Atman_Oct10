-- 실사용 + 시연 겸용 정리
--
-- ① 체험 시계는 '사업장이 처음 연결된 날'부터
--    영업용으로 미리 등록한 사업장(registration_source='invite')도 INSERT 트리거로 30일 체험이 시작돼,
--    6/30 일괄 등록분은 아무도 로그인하기 전인 8/21에 체험이 끝났다. 지금 연결하면 첫날부터 Free였다.
--    첫 연결(이전에 연결된 적 없음) 순간에 체험을 오늘부터 30일로 다시 잡는다. 결제로 전환된 적 있으면 건드리지 않는다.
--
-- ② 시연 사업장은 체험 없이 최상위 플랜 상시 활성
--    데모 51곳도 8/21에 체험이 끝나 Free(직원 3명·공고 월 1건·반복초대 불가·운영 자동화 숨김)로 시연되고 있었다.
--    trial_ends_at 이 없으면 expire_service_trials 대상이 아니므로 만료 함수는 그대로 둔다.
--    이용 기간은 이번 달 1일~말일로 두고 매일 재시드(ensure_demo_subscriptions)가 굴린다 — 화면에 '이번 달 말일까지 · 이용 중'.
--    긱 시연(gigworker_trial)은 별도 무료 베타라 제외. 청구서는 자동 생성되지 않으므로 매출 지표에 섞이지 않는다.
--
-- ③ 대타 자격에 데모 격리 — 데모 워커는 데모 사업장 대타만, 실제 워커는 실제 사업장 대타만.

-- ① ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.restart_trial_on_first_claim()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_today date := (timezone('Asia/Seoul', now()))::date;
BEGIN
  IF COALESCE(NEW.is_demo, false) OR NEW.registration_source = 'gigworker_trial' THEN
    RETURN NEW;
  END IF;
  -- 처음 연결될 때만 (연결 해제 후 재연결·관리자 교체는 제외)
  IF OLD.admin_user_id IS NOT NULL OR NEW.admin_user_id IS NULL OR OLD.invite_code_used_at IS NOT NULL THEN
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM public.facility_subscriptions
             WHERE facility_id = NEW.id AND trial_converted_at IS NOT NULL) THEN
    RETURN NEW;
  END IF;

  -- 진행 중인 체험 → 오늘부터 30일로
  UPDATE public.facility_subscriptions
  SET trial_started_at = now(),
      trial_ends_at = GREATEST(trial_ends_at, v_today + 29),
      current_period_start = v_today,
      current_period_end = GREATEST(current_period_end, v_today + 29),
      updated_at = now()
  WHERE facility_id = NEW.id
    AND status IN ('pending', 'active', 'past_due')
    AND trial_ends_at IS NOT NULL;
  IF FOUND THEN
    RETURN NEW;
  END IF;

  -- 연결 전에 체험이 이미 끝났으면 새 체험 (지금 쓰는 유료·수동 구독이 있으면 그대로)
  INSERT INTO public.facility_subscriptions (
    facility_id, plan_code, status, billing_cycle,
    current_period_start, current_period_end, trial_started_at, trial_ends_at
  )
  SELECT NEW.id,
    CASE WHEN NEW.facility_type = 'pharmacy' THEN 'pharmacy_plus' ELSE 'pro' END,
    'active', 'monthly', v_today, v_today + 29, now(), v_today + 29
  WHERE NOT EXISTS (
    SELECT 1 FROM public.facility_subscriptions
    WHERE facility_id = NEW.id AND status IN ('pending', 'active', 'past_due')
  );
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.restart_trial_on_first_claim() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_restart_trial_on_first_claim ON public.facilities;
CREATE TRIGGER trg_restart_trial_on_first_claim
  AFTER UPDATE OF admin_user_id ON public.facilities
  FOR EACH ROW EXECUTE FUNCTION public.restart_trial_on_first_claim();

-- ② ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ensure_demo_subscriptions()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_today date := (timezone('Asia/Seoul', now()))::date;
  v_start date := date_trunc('month', v_today)::date;
  v_end   date := (date_trunc('month', v_today) + interval '1 month - 1 day')::date;
  v_updated integer;
  v_inserted integer;
BEGIN
  UPDATE public.facility_subscriptions fs
  SET plan_code = CASE WHEN f.facility_type = 'pharmacy' THEN 'pharmacy_plus' ELSE 'pro' END,
      status = 'active',
      trial_started_at = NULL,
      trial_ends_at = NULL,
      current_period_start = v_start,
      current_period_end = v_end,
      cancel_at_period_end = false,
      updated_at = now()
  FROM public.facilities f
  WHERE f.id = fs.facility_id
    AND f.is_demo = true
    AND f.deleted_at IS NULL
    AND f.registration_source IS DISTINCT FROM 'gigworker_trial'
    AND fs.status IN ('pending', 'active', 'past_due');
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  INSERT INTO public.facility_subscriptions (
    facility_id, plan_code, status, billing_cycle, current_period_start, current_period_end
  )
  SELECT f.id,
    CASE WHEN f.facility_type = 'pharmacy' THEN 'pharmacy_plus' ELSE 'pro' END,
    'active', 'monthly', v_start, v_end
  FROM public.facilities f
  WHERE f.is_demo = true
    AND f.deleted_at IS NULL
    AND f.registration_source IS DISTINCT FROM 'gigworker_trial'
    AND NOT EXISTS (
      SELECT 1 FROM public.facility_subscriptions
      WHERE facility_id = f.id AND status IN ('pending', 'active', 'past_due')
    );
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  RETURN v_updated + v_inserted;
END;
$$;
REVOKE ALL ON FUNCTION public.ensure_demo_subscriptions() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_demo_subscriptions() TO service_role;

-- 새로 만드는 시연 사업장도 체험 없이 바로 상시 플랜 (실사업장은 기존 30일 체험 그대로)
CREATE OR REPLACE FUNCTION public.start_facility_pro_trial()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_today date := (timezone('Asia/Seoul', now()))::date;
BEGIN
  IF NEW.registration_source = 'gigworker_trial' THEN
    RETURN NEW;
  END IF;
  INSERT INTO public.facility_subscriptions (
    facility_id, plan_code, status, billing_cycle,
    current_period_start, current_period_end, trial_started_at, trial_ends_at
  )
  SELECT NEW.id,
    CASE WHEN NEW.facility_type = 'pharmacy' THEN 'pharmacy_plus' ELSE 'pro' END,
    'active', 'monthly',
    CASE WHEN COALESCE(NEW.is_demo, false) THEN date_trunc('month', v_today)::date ELSE v_today END,
    CASE WHEN COALESCE(NEW.is_demo, false)
         THEN (date_trunc('month', v_today) + interval '1 month - 1 day')::date ELSE v_today + 29 END,
    CASE WHEN COALESCE(NEW.is_demo, false) THEN NULL ELSE now() END,
    CASE WHEN COALESCE(NEW.is_demo, false) THEN NULL ELSE v_today + 29 END
  WHERE NOT EXISTS (
    SELECT 1 FROM public.facility_subscriptions
    WHERE facility_id = NEW.id AND status IN ('pending', 'active', 'past_due')
  );
  RETURN NEW;
END;
$$;

SELECT public.ensure_demo_subscriptions();

-- ③ ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.can_cover_shift(p_worker_id uuid, p_shift_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.shifts s
    JOIN public.facilities f ON f.id = s.facility_id
    JOIN public.workers w ON w.id = p_worker_id
    WHERE s.id = p_shift_id
      AND w.deleted_at IS NULL
      AND COALESCE(f.is_demo, false) = COALESCE(w.is_demo, false)
      AND (s.required_role IS NULL OR s.required_role = 'any' OR w.role = s.required_role)
      AND (
        EXISTS (SELECT 1 FROM public.facility_worker_pool p
                WHERE p.facility_id = s.facility_id AND p.worker_id = w.id AND p.status = 'active')
        OR EXISTS (SELECT 1 FROM public.facility_staff fs
                   WHERE fs.facility_id = s.facility_id AND fs.worker_id = w.id AND fs.status = 'active')
      )
      AND (
        w.verification_status = 'approved'
        OR (w.role IN ('rn','na','pharmacist')
            AND public.prior_facility_credential(w.id, s.facility_id) IS NOT NULL)
      )
  );
$$;
REVOKE ALL ON FUNCTION public.can_cover_shift(uuid, uuid) FROM PUBLIC;
