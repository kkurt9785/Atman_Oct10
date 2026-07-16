-- Run after 20260715100000_operations_capacity_replacement.sql.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='shift_templates' AND column_name='required_headcount') THEN
    RAISE EXCEPTION 'shift_templates.required_headcount is missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='shifts' AND column_name='replacement_for_shift_id') THEN
    RAISE EXCEPTION 'shifts.replacement_for_shift_id is missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='uq_active_replacement_shift') THEN
    RAISE EXCEPTION 'active replacement uniqueness index is missing';
  END IF;
END $$;
