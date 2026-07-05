-- Allow authenticated users to create their own worker profile during onboarding.
-- Existing SELECT/UPDATE policies already restrict rows by workers.auth_user_id.

DROP POLICY IF EXISTS workers_insert_own ON workers;
CREATE POLICY workers_insert_own ON workers
  FOR INSERT
  WITH CHECK (auth_user_id = auth.uid());
