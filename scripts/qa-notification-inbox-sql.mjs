// Pipe into LOCAL postgres only. Isolated schema, transaction rolled back.
import { readFileSync } from 'node:fs';
const migration = readFileSync(new URL('../supabase/migrations/20261023120000_notification_inbox_cursor.sql', import.meta.url), 'utf8').replaceAll('public.', 'qa_notification_cursor.');
process.stdout.write(`BEGIN;
CREATE SCHEMA qa_notification_cursor;
CREATE TABLE qa_notification_cursor.notification_outbox(id uuid PRIMARY KEY, worker_auth_user_id uuid, event_type text, title text, body text, data jsonb, created_at timestamptz);
CREATE TABLE qa_notification_cursor.notification_reads(notification_id uuid, user_id uuid, read_at timestamptz, PRIMARY KEY(notification_id,user_id));
${migration}
INSERT INTO qa_notification_cursor.notification_outbox SELECT
  ('00000000-0000-0000-0000-' || lpad(i::text,12,'0'))::uuid,
  '10000000-0000-0000-0000-000000000001'::uuid,'test','test','test','{}','2026-10-23T00:00:00.123456Z'
FROM generate_series(1,120) i;
INSERT INTO qa_notification_cursor.notification_outbox VALUES('99999999-0000-0000-0000-000000000000','20000000-0000-0000-0000-000000000002','other','other','other','{}',now());
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
DO $$ DECLARE n integer; BEGIN
  SELECT count(*) INTO n FROM qa_notification_cursor.get_my_notifications_page(NULL,NULL,50);
  IF n <> 50 THEN RAISE EXCEPTION 'first page expected 50, got %', n; END IF;
  SELECT count(*) INTO n FROM qa_notification_cursor.get_my_notifications_page('2026-10-23T00:00:00.123456Z','00000000-0000-0000-0000-000000000071',50);
  IF n <> 50 THEN RAISE EXCEPTION 'second page expected 50, got %', n; END IF;
  SELECT count(*) INTO n FROM qa_notification_cursor.get_my_notifications_page('2026-10-23T00:00:00.123456Z','00000000-0000-0000-0000-000000000021',50);
  IF n <> 20 THEN RAISE EXCEPTION 'last page expected 20, got %', n; END IF;
  IF EXISTS(SELECT 1 FROM qa_notification_cursor.get_my_notifications_page(NULL,NULL,100) WHERE event_type='other') THEN RAISE EXCEPTION 'cross-user leak'; END IF;
  IF EXISTS(SELECT 1 FROM qa_notification_cursor.get_my_notifications_page(NULL,'00000000-0000-0000-0000-000000000001',50)) THEN RAISE EXCEPTION 'partial cursor accepted'; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','',true);
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM qa_notification_cursor.get_my_notifications_page()) THEN RAISE EXCEPTION 'anonymous rows exposed'; END IF;
  IF has_function_privilege('anon','qa_notification_cursor.get_my_notifications_page(timestamptz,uuid,integer)','EXECUTE') THEN RAISE EXCEPTION 'anonymous execute allowed'; END IF;
END $$;
ROLLBACK;
`);
