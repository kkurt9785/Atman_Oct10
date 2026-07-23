-- Demo workers intentionally have no auth.users row. Their hiring must still
-- succeed; only the push-notification side effect is skipped.
CREATE OR REPLACE FUNCTION public.skip_authless_notification()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.worker_auth_user_id IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_skip_authless_notification ON public.notification_outbox;
CREATE TRIGGER trg_skip_authless_notification
  BEFORE INSERT ON public.notification_outbox
  FOR EACH ROW
  EXECUTE FUNCTION public.skip_authless_notification();

REVOKE ALL ON FUNCTION public.skip_authless_notification() FROM PUBLIC, anon, authenticated;

