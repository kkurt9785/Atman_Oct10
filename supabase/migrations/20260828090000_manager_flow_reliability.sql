-- 관리자 운영 신뢰성 보완
-- ① 반복 초대는 실제 근무 완료 이력이 있는 워커에게만 허용한다.
-- ② 동일 계정의 휴대폰·PC에 각각 푸시를 보낼 수 있게 한다.
-- ③ 푸시 미구독/만료여도 앱 알림함은 항상 fallback으로 남긴다.

-- ---------------------------------------------------------------------------
-- 1. 완료 근무 기반 시설 인력풀
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.recompute_facility_worker_pool(p_facility_id uuid, p_worker_id uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  INSERT INTO public.facility_worker_pool (
    facility_id, worker_id, source, first_worked_at, last_worked_at,
    completed_shift_count, total_worked_minutes
  )
  SELECT
    p_facility_id, p_worker_id, 'completed_shift',
    min(s.shift_date), max(s.shift_date),
    count(*)::integer,
    COALESCE(sum(att.actual_minutes), 0)::integer
  FROM public.shift_applications a
  JOIN public.shifts s ON s.id = a.shift_id
  LEFT JOIN public.shift_attendances att ON att.application_id = a.id
  WHERE s.facility_id = p_facility_id
    AND a.worker_id = p_worker_id
    AND a.status = 'completed'
  HAVING count(*) > 0
  ON CONFLICT (facility_id, worker_id) DO UPDATE SET
    source = CASE WHEN public.facility_worker_pool.source = 'manual' THEN 'manual' ELSE EXCLUDED.source END,
    first_worked_at = EXCLUDED.first_worked_at,
    last_worked_at = EXCLUDED.last_worked_at,
    completed_shift_count = EXCLUDED.completed_shift_count,
    total_worked_minutes = EXCLUDED.total_worked_minutes,
    updated_at = now();
$$;

CREATE OR REPLACE FUNCTION public.sync_facility_worker_pool()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_facility_id uuid;
BEGIN
  IF NEW.status <> 'completed' THEN RETURN NEW; END IF;
  SELECT facility_id INTO v_facility_id FROM public.shifts WHERE id = NEW.shift_id;
  IF NOT FOUND THEN RETURN NEW; END IF;
  PERFORM public.recompute_facility_worker_pool(v_facility_id, NEW.worker_id);
  RETURN NEW;
END $$;

-- 기존의 수락만 된 인력은 "함께한 근무자" 목록에서 제거하고,
-- 실제 완료 근무 데이터로 다시 계산한다. 수동 등록 인력은 보존한다.
DELETE FROM public.facility_worker_pool p
WHERE p.source <> 'manual'
  AND NOT EXISTS (
    SELECT 1
    FROM public.shift_applications a
    JOIN public.shifts s ON s.id = a.shift_id
    WHERE s.facility_id = p.facility_id
      AND a.worker_id = p.worker_id
      AND a.status = 'completed'
  );

SELECT public.recompute_facility_worker_pool(s.facility_id, a.worker_id)
FROM public.shift_applications a
JOIN public.shifts s ON s.id = a.shift_id
WHERE a.status = 'completed'
GROUP BY s.facility_id, a.worker_id;

-- ---------------------------------------------------------------------------
-- 2. 기기별 웹푸시 구독
-- ---------------------------------------------------------------------------
-- 초기 테이블이 만들어진 시점에 따라 updated_at이 없는 프로젝트도 있어,
-- 기존 before update 트리거가 안전하게 동작하도록 먼저 열을 보장한다.
ALTER TABLE public.push_subscriptions
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.push_subscriptions ADD COLUMN IF NOT EXISTS id uuid;
UPDATE public.push_subscriptions SET id = gen_random_uuid() WHERE id IS NULL;
ALTER TABLE public.push_subscriptions ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.push_subscriptions ALTER COLUMN id SET NOT NULL;
ALTER TABLE public.push_subscriptions DROP CONSTRAINT IF EXISTS push_subscriptions_pkey;
ALTER TABLE public.push_subscriptions ADD CONSTRAINT push_subscriptions_pkey PRIMARY KEY (id);

ALTER TABLE public.push_subscriptions ADD COLUMN IF NOT EXISTS endpoint text;
UPDATE public.push_subscriptions
SET endpoint = subscription ->> 'endpoint'
WHERE endpoint IS NULL;
DELETE FROM public.push_subscriptions WHERE COALESCE(endpoint, '') = '';
ALTER TABLE public.push_subscriptions ALTER COLUMN endpoint SET NOT NULL;
ALTER TABLE public.push_subscriptions
  ADD CONSTRAINT push_subscriptions_worker_endpoint_key UNIQUE (worker_id, endpoint);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_recipient
  ON public.push_subscriptions(worker_id, updated_at DESC);

-- 알림함은 푸시가 없어서 discarded가 된 경우에도 보여야 한다.
CREATE OR REPLACE FUNCTION public.get_my_notifications(p_limit integer DEFAULT 50)
RETURNS TABLE (
  id uuid,
  event_type text,
  title text,
  body text,
  data jsonb,
  created_at timestamptz,
  read_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT n.id, n.event_type, n.title, n.body, n.data, n.created_at, r.read_at
  FROM public.notification_outbox n
  LEFT JOIN public.notification_reads r
    ON r.notification_id = n.id AND r.user_id = auth.uid()
  WHERE n.worker_auth_user_id = auth.uid()
  ORDER BY n.created_at DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100);
$$;

-- 검증: true / 0 / 0 이면 각각 스키마, 수락만 된 인력, 누락 endpoint가 정상이다.
SELECT
  EXISTS(
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.push_subscriptions'::regclass
      AND conname = 'push_subscriptions_worker_endpoint_key'
  ) AS multi_device_push_ready,
  (SELECT count(*) FROM public.facility_worker_pool WHERE source <> 'manual' AND completed_shift_count < 1) AS incomplete_pool_members,
  (SELECT count(*) FROM public.push_subscriptions WHERE endpoint = '') AS empty_push_endpoints;
