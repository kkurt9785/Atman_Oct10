-- Account-scoped keyset pagination; retain the legacy RPC for existing clients.
CREATE INDEX IF NOT EXISTS notification_outbox_recipient_cursor_idx
ON public.notification_outbox(worker_auth_user_id, created_at DESC, id DESC);

CREATE OR REPLACE FUNCTION public.get_my_notifications_page(
  p_before_created_at timestamptz DEFAULT NULL,
  p_before_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 50
)
RETURNS TABLE(id uuid, event_type text, title text, body text, data jsonb, created_at timestamptz, read_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT n.id, n.event_type, n.title, n.body, n.data, n.created_at, r.read_at
  FROM public.notification_outbox n
  LEFT JOIN public.notification_reads r ON r.notification_id = n.id AND r.user_id = auth.uid()
  WHERE auth.uid() IS NOT NULL AND n.worker_auth_user_id = auth.uid()
    AND ((p_before_created_at IS NULL AND p_before_id IS NULL)
      OR (p_before_created_at IS NOT NULL AND p_before_id IS NOT NULL
          AND (n.created_at, n.id) < (p_before_created_at, p_before_id)))
  ORDER BY n.created_at DESC, n.id DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100);
$$;
REVOKE ALL ON FUNCTION public.get_my_notifications_page(timestamptz, uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_notifications_page(timestamptz, uuid, integer) TO authenticated;
