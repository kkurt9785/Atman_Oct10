-- 앱 알림 받은함: 웹 푸시 권한을 거부했거나 놓친 사용자도 동일한 알림을 확인한다.
CREATE TABLE IF NOT EXISTS public.notification_reads (
  notification_id uuid NOT NULL REFERENCES public.notification_outbox(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (notification_id, user_id)
);

ALTER TABLE public.notification_reads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.notification_reads FROM anon, authenticated;

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
    AND n.status <> 'discarded'
  ORDER BY n.created_at DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100);
$$;

CREATE OR REPLACE FUNCTION public.mark_my_notification_read(p_notification_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.notification_reads(notification_id, user_id, read_at)
  SELECT n.id, auth.uid(), now()
  FROM public.notification_outbox n
  WHERE n.id = p_notification_id
    AND n.worker_auth_user_id = auth.uid()
  ON CONFLICT (notification_id, user_id)
  DO UPDATE SET read_at = now();
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_notifications(integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mark_my_notification_read(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_notifications(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_my_notification_read(uuid) TO authenticated;

