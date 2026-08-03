-- Workers must be able to read the shift attached to their own application
-- after it moves beyond the public open/matched states. This also keeps
-- activity history and wage-payment facility details renderable.
DROP POLICY IF EXISTS shifts_worker_own_history_read ON public.shifts;
CREATE POLICY shifts_worker_own_history_read ON public.shifts
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.shift_applications application
    WHERE application.shift_id = shifts.id
      AND application.worker_id = public.current_worker_id()
  )
);
