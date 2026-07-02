-- Multi-facility admin access for internal demo/sales operators.
-- Existing facilities.admin_user_id remains the single facility owner link.
-- facility_admin_access allows operator/demo accounts to access many facilities.

CREATE TABLE IF NOT EXISTS facility_admin_access (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  facility_id UUID NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
  access_role TEXT NOT NULL DEFAULT 'operator'
    CHECK (access_role IN ('operator', 'sales', 'super')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, facility_id)
);

CREATE INDEX IF NOT EXISTS idx_facility_admin_access_user
  ON facility_admin_access(user_id);

CREATE INDEX IF NOT EXISTS idx_facility_admin_access_facility
  ON facility_admin_access(facility_id);

ALTER TABLE facility_admin_access ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "facility_admin_access: own read" ON facility_admin_access;
CREATE POLICY "facility_admin_access: own read" ON facility_admin_access
  FOR SELECT USING (user_id = auth.uid());

-- service_role handles writes from admin/server-side tooling.
