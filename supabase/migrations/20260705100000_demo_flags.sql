-- Lightweight demo-data flags so sales/demo records can be separated from real users.

ALTER TABLE workers
  ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE facilities
  ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_workers_is_demo ON workers(is_demo);
CREATE INDEX IF NOT EXISTS idx_facilities_is_demo ON facilities(is_demo);
