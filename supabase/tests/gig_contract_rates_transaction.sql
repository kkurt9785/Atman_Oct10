-- Isolated local fixture: all DDL and data are rolled back, including extension creation.
BEGIN;
CREATE SCHEMA qa_gig_contract_rates;
CREATE TABLE qa_gig_contract_rates.facility_staff (
  id uuid PRIMARY KEY, worker_kind text, pay_basis text, pay_rate integer
);
CREATE TABLE qa_gig_contract_rates.staff_attendances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), staff_id uuid, check_in_at timestamptz
);
CREATE TABLE qa_gig_contract_rates.gig_payouts (staff_id uuid, status text);
-- APPLY_MIGRATION
CREATE FUNCTION pg_temp.uid(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT md5(n::text)::uuid $$;
CREATE FUNCTION pg_temp.must_fail(command text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE command;
  EXCEPTION WHEN raise_exception THEN
    IF position('근태 기록이 있는 계약' IN SQLERRM) = 0 THEN RAISE; END IF;
    RETURN;
  END;
  RAISE EXCEPTION 'Expected contract protection: %', command;
END;
$$;
INSERT INTO qa_gig_contract_rates.facility_staff VALUES
  (pg_temp.uid(1),'gig','hourly',12000),
  (pg_temp.uid(2),'gig',NULL,NULL),
  (pg_temp.uid(3),'gig','hourly',12000),
  (pg_temp.uid(4),'staff','monthly',3000000),
  (pg_temp.uid(5),'gig','hourly',0),
  (pg_temp.uid(6),'gig','hourly',12000);
INSERT INTO qa_gig_contract_rates.staff_attendances(staff_id,check_in_at)
SELECT pg_temp.uid(n),now() FROM unnest(ARRAY[1,2,4,5]) n;
-- A planned/absent placeholder without any actual check-in is not worked history.
INSERT INTO qa_gig_contract_rates.staff_attendances(staff_id,check_in_at) VALUES (pg_temp.uid(6),NULL);

SELECT pg_temp.must_fail('UPDATE qa_gig_contract_rates.facility_staff SET pay_rate=15000 WHERE id=pg_temp.uid(1)');
SELECT pg_temp.must_fail('UPDATE qa_gig_contract_rates.facility_staff SET pay_basis=''daily'' WHERE id=pg_temp.uid(1)');
SELECT pg_temp.must_fail('UPDATE qa_gig_contract_rates.facility_staff SET pay_rate=NULL WHERE id=pg_temp.uid(1)');
-- Re-saving identical terms remains valid.
UPDATE qa_gig_contract_rates.facility_staff SET pay_rate=12000,pay_basis='hourly' WHERE id=pg_temp.uid(1);
-- Initial rates are allowed even when attendance was captured before terms were configured.
UPDATE qa_gig_contract_rates.facility_staff SET pay_rate=14000,pay_basis='hourly' WHERE id=pg_temp.uid(2);
UPDATE qa_gig_contract_rates.facility_staff SET pay_rate=14000 WHERE id=pg_temp.uid(5);
SELECT pg_temp.must_fail('UPDATE qa_gig_contract_rates.facility_staff SET pay_rate=15000 WHERE id=pg_temp.uid(2)');
UPDATE qa_gig_contract_rates.facility_staff SET pay_rate=15000 WHERE id=pg_temp.uid(3);
UPDATE qa_gig_contract_rates.facility_staff SET pay_rate=3200000 WHERE id=pg_temp.uid(4);
UPDATE qa_gig_contract_rates.facility_staff SET pay_rate=15000 WHERE id=pg_temp.uid(6);
-- Paying or cancelling a payout never releases the historical contract rate.
INSERT INTO qa_gig_contract_rates.gig_payouts VALUES (pg_temp.uid(1),'paid');
SELECT pg_temp.must_fail('UPDATE qa_gig_contract_rates.facility_staff SET pay_rate=15000 WHERE id=pg_temp.uid(1)');
UPDATE qa_gig_contract_rates.gig_payouts SET status='cancelled';
SELECT pg_temp.must_fail('UPDATE qa_gig_contract_rates.facility_staff SET pay_rate=15000 WHERE id=pg_temp.uid(1)');

DO $$ BEGIN
  IF (SELECT pay_rate FROM qa_gig_contract_rates.facility_staff WHERE id=pg_temp.uid(1)) <> 12000 THEN RAISE EXCEPTION 'worked rate changed'; END IF;
  IF (SELECT pay_rate FROM qa_gig_contract_rates.facility_staff WHERE id=pg_temp.uid(4)) <> 3200000 THEN RAISE EXCEPTION 'staff salary blocked'; END IF;
  -- Fixture has no foreign keys; this RowShareLock comes from attendance's FOR UPDATE trigger.
  IF NOT EXISTS (SELECT 1 FROM pg_locks WHERE pid=pg_backend_pid() AND relation='qa_gig_contract_rates.facility_staff'::regclass AND mode='RowShareLock' AND granted) THEN
    RAISE EXCEPTION 'attendance did not lock the staff contract';
  END IF;
END $$;
-- Same order as the restricted reset_gigworker_invite_demo routine: remove fixture
-- payout and attendance history before resetting the demonstration contract.
DELETE FROM qa_gig_contract_rates.gig_payouts WHERE staff_id=pg_temp.uid(1);
DELETE FROM qa_gig_contract_rates.staff_attendances WHERE staff_id=pg_temp.uid(1);
UPDATE qa_gig_contract_rates.facility_staff SET pay_basis='hourly',pay_rate=15000 WHERE id=pg_temp.uid(1);
DO $$ BEGIN
  IF (SELECT pay_rate FROM qa_gig_contract_rates.facility_staff WHERE id=pg_temp.uid(1)) <> 15000 THEN RAISE EXCEPTION 'demo reset order blocked'; END IF;
END $$;
SELECT 'PASS: worked rate/basis immutable, initial configuration allowed, unworked edits allowed, paid/cancelled history protected, staff salary unchanged, attendance FOR UPDATE lock acquired, demo delete-before-reset works' AS result;
ROLLBACK;
