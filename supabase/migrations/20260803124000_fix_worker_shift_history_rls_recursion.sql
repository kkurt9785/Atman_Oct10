-- Avoid shifts <-> shift_applications RLS recursion by evaluating ownership
-- inside a narrowly scoped SECURITY DEFINER helper.
CREATE OR REPLACE FUNCTION public.current_worker_can_read_shift(p_shift_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.shift_applications application
    JOIN public.workers worker ON worker.id = application.worker_id
    WHERE application.shift_id = p_shift_id
      AND worker.auth_user_id = auth.uid()
      AND worker.deleted_at IS NULL
  );
$$;

REVOKE ALL ON FUNCTION public.current_worker_can_read_shift(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_worker_can_read_shift(uuid) TO authenticated;

DROP POLICY IF EXISTS shifts_worker_own_history_read ON public.shifts;
CREATE POLICY shifts_worker_own_history_read ON public.shifts
FOR SELECT TO authenticated
USING (public.current_worker_can_read_shift(id));
