-- Required headcount per recurring template + auditable no-show replacement shifts.

ALTER TABLE public.shift_templates
  ADD COLUMN IF NOT EXISTS required_headcount smallint NOT NULL DEFAULT 1;
ALTER TABLE public.shift_templates DROP CONSTRAINT IF EXISTS shift_templates_required_headcount_check;
ALTER TABLE public.shift_templates
  ADD CONSTRAINT shift_templates_required_headcount_check CHECK (required_headcount BETWEEN 1 AND 20);

ALTER TABLE public.shifts
  ADD COLUMN IF NOT EXISTS template_slot smallint,
  ADD COLUMN IF NOT EXISTS replacement_for_shift_id uuid REFERENCES public.shifts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_replacement boolean NOT NULL DEFAULT false;
UPDATE public.shifts SET template_slot=1 WHERE template_id IS NOT NULL AND template_slot IS NULL;
ALTER TABLE public.shifts DROP CONSTRAINT IF EXISTS shifts_template_slot_check;
ALTER TABLE public.shifts
  ADD CONSTRAINT shifts_template_slot_check CHECK (
    (template_id IS NULL AND template_slot IS NULL)
    OR (template_id IS NOT NULL AND template_slot BETWEEN 1 AND 20)
  );
ALTER TABLE public.shifts DROP CONSTRAINT IF EXISTS shifts_replacement_check;
ALTER TABLE public.shifts
  ADD CONSTRAINT shifts_replacement_check CHECK (
    (is_replacement = false AND replacement_for_shift_id IS NULL)
    OR (is_replacement = true AND replacement_for_shift_id IS NOT NULL)
  );
DROP INDEX IF EXISTS public.uq_template_shift_date;
CREATE UNIQUE INDEX IF NOT EXISTS uq_template_shift_date_slot
  ON public.shifts(template_id, shift_date, template_slot)
  WHERE template_id IS NOT NULL AND status <> 'cancelled';
CREATE UNIQUE INDEX IF NOT EXISTS uq_active_replacement_shift
  ON public.shifts(replacement_for_shift_id)
  WHERE replacement_for_shift_id IS NOT NULL AND status <> 'cancelled';
CREATE INDEX IF NOT EXISTS idx_shifts_replacement_for
  ON public.shifts(replacement_for_shift_id)
  WHERE replacement_for_shift_id IS NOT NULL;

COMMENT ON COLUMN public.shift_templates.required_headcount IS '해당 요일에 동시에 생성할 필요 인원 수';
COMMENT ON COLUMN public.shifts.replacement_for_shift_id IS '노쇼·공백으로 긴급 대체하는 원본 시프트';
