BEGIN;
CREATE SCHEMA qa_chat_safety;
GRANT USAGE ON SCHEMA qa_chat_safety TO authenticated,service_role;
CREATE TABLE public.users(id uuid PRIMARY KEY);
CREATE TABLE public.facilities(id uuid PRIMARY KEY,admin_user_id uuid);
CREATE TABLE public.workers(id uuid PRIMARY KEY,auth_user_id uuid,name text,deleted_at timestamptz);
CREATE TABLE public.facility_staff(id uuid PRIMARY KEY,facility_id uuid,worker_id uuid,status text);
CREATE TABLE public.facility_admin_access(facility_id uuid,user_id uuid,access_role text);
CREATE TABLE public.shifts(id uuid PRIMARY KEY,facility_id uuid);
CREATE TABLE public.shift_applications(id uuid PRIMARY KEY,shift_id uuid,worker_id uuid);
CREATE TABLE public.chat_messages(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),application_id uuid,sender_type text,sender_id uuid,body text);
CREATE TABLE public.facility_workroom_messages(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),facility_id uuid,staff_id uuid,sender_type text,sender_user_id uuid,sender_name text,body text,message_type text DEFAULT 'message');
CREATE TABLE public.notification_outbox(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),worker_auth_user_id uuid,event_type text,dedupe_key text,data jsonb,status text DEFAULT 'pending',last_error text);
CREATE FUNCTION public.is_demo_account(uuid) RETURNS boolean LANGUAGE sql AS $$SELECT $1='10000000-0000-4000-8000-000000000099'::uuid$$;
CREATE FUNCTION public.facility_access_role(uuid) RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT 'owner'::text FROM public.facilities WHERE id=$1 AND admin_user_id=auth.uid()
 UNION SELECT access_role FROM public.facility_admin_access WHERE facility_id=$1 AND user_id=auth.uid() LIMIT 1
$$;
INSERT INTO public.users SELECT ('10000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid FROM generate_series(1,5) n;
INSERT INTO public.users VALUES('10000000-0000-4000-8000-000000000099');
INSERT INTO public.facilities VALUES('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002');
INSERT INTO public.workers VALUES
 ('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','첫 직원',NULL),
 ('30000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000004','다른 직원',NULL);
INSERT INTO public.facility_staff VALUES
 ('40000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','active'),
 ('40000000-0000-4000-8000-000000000004','20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000004','active');
INSERT INTO public.shifts VALUES('50000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001');
INSERT INTO public.shift_applications VALUES('60000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001');
INSERT INTO public.chat_messages VALUES
 ('70000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000001','facility','10000000-0000-4000-8000-000000000002','admin text'),
 ('70000000-0000-4000-8000-000000000002','60000000-0000-4000-8000-000000000001','worker','10000000-0000-4000-8000-000000000001','my text'),
 ('70000000-0000-4000-8000-000000000003','60000000-0000-4000-8000-000000000001','system',NULL,'work record');
INSERT INTO public.facility_workroom_messages(id,facility_id,staff_id,sender_type,sender_user_id,sender_name,body) VALUES
 ('80000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',NULL,'admin','10000000-0000-4000-8000-000000000002','담당자','group text'),
 ('80000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000004','admin','10000000-0000-4000-8000-000000000002','담당자','other private text'),
 ('80000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000001',NULL,'system',NULL,'출퇴근','attendance record');
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.facility_workroom_messages ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.chat_messages,public.facility_workroom_messages TO authenticated;
CREATE POLICY chat_participant ON public.chat_messages FOR SELECT TO authenticated USING(EXISTS(
 SELECT 1 FROM public.shift_applications a JOIN public.workers w ON w.id=a.worker_id JOIN public.shifts s ON s.id=a.shift_id
 WHERE a.id=application_id AND (w.auth_user_id=auth.uid() OR public.facility_access_role(s.facility_id) IS NOT NULL)));
CREATE POLICY room_participant ON public.facility_workroom_messages FOR SELECT TO authenticated USING(
 public.facility_access_role(facility_id) IS NOT NULL OR EXISTS(SELECT 1 FROM public.facility_staff fs JOIN public.workers w ON w.id=fs.worker_id
 WHERE fs.facility_id=facility_workroom_messages.facility_id AND w.auth_user_id=auth.uid() AND (staff_id IS NULL OR staff_id=fs.id)));
GRANT SELECT ON public.shift_applications,public.workers,public.shifts,public.facility_staff TO authenticated;
-- APPLY_MIGRATION
CREATE FUNCTION pg_temp.check_that(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$BEGIN
 IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'Assertion failed: %',label;END IF;RAISE NOTICE 'PASS: %',label;
END$$;
CREATE FUNCTION pg_temp.reject(query text,expected text) RETURNS void LANGUAGE plpgsql AS $$BEGIN
 BEGIN EXECUTE query;EXCEPTION WHEN OTHERS THEN IF position(expected IN SQLERRM)>0 THEN RETURN;END IF;RAISE;END;
 RAISE EXCEPTION 'Unexpected success: %',query;
END$$;
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000003',true);
SELECT pg_temp.reject($q$SELECT public.report_safety_message('match','70000000-0000-4000-8000-000000000001','spam','')$q$,'찾지 못');
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
SELECT pg_temp.reject($q$SELECT public.report_safety_message('workroom','80000000-0000-4000-8000-000000000002','privacy','')$q$,'찾지 못');
SELECT public.report_safety_message('match','70000000-0000-4000-8000-000000000001','harassment','test report');
SELECT public.report_safety_message('match','70000000-0000-4000-8000-000000000001','harassment','duplicate');
SELECT pg_temp.check_that((SELECT count(*)=1 AND min(message_snapshot)='admin text' FROM public.chat_safety_reports),'reports are authorized, durable and idempotent');
INSERT INTO public.notification_outbox(worker_auth_user_id,event_type,dedupe_key,data) VALUES
 ('10000000-0000-4000-8000-000000000001','chat.message','chat:70000000-0000-4000-8000-000000000001','{}'),
 ('10000000-0000-4000-8000-000000000001','payout.paid','pay:test','{}');
SELECT public.set_safety_user_block('10000000-0000-4000-8000-000000000002',true,'담당자');
SELECT pg_temp.check_that((SELECT status='discarded' FROM public.notification_outbox WHERE event_type='chat.message'),'blocking cancels queued conversation notifications');
SELECT pg_temp.check_that((SELECT status='pending' FROM public.notification_outbox WHERE event_type='payout.paid'),'blocking preserves essential payout notifications');
SET LOCAL ROLE authenticated;
SELECT pg_temp.check_that((SELECT count(*)=2 FROM public.chat_messages),'blocked incoming chat hidden, own text and system records preserved');
SELECT pg_temp.check_that((SELECT count(*)=1 AND min(body)='attendance record' FROM public.facility_workroom_messages),'workroom enforces privacy and hides blocked user, preserving system records');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000003',true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.check_that((SELECT count(*)=0 FROM public.chat_messages),'safety policies do not grant an outsider message access');
SELECT pg_temp.check_that((SELECT count(*)=0 FROM public.chat_safety_reports),'outsiders cannot read a report');
SELECT pg_temp.reject($q$INSERT INTO public.user_safety_blocks(blocker_user_id,blocked_user_id) VALUES('10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002')$q$,'permission denied');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
SELECT pg_temp.reject($q$INSERT INTO public.chat_messages(application_id,sender_type,sender_id,body) VALUES('60000000-0000-4000-8000-000000000001','facility','10000000-0000-4000-8000-000000000002','blocked')$q$,'차단된 사용자');
SELECT pg_temp.reject($q$INSERT INTO public.facility_workroom_messages(facility_id,staff_id,sender_type,sender_user_id,sender_name,body) VALUES('20000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','admin','10000000-0000-4000-8000-000000000002','admin','blocked')$q$,'차단된 사용자');
INSERT INTO public.notification_outbox(worker_auth_user_id,event_type,dedupe_key,data) VALUES
 ('10000000-0000-4000-8000-000000000001','chat.message','chat:70000000-0000-4000-8000-000000000001:new','{}');
SELECT pg_temp.check_that((SELECT count(*)=2 FROM public.notification_outbox),'new blocked push is not queued');
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
SELECT pg_temp.reject($q$INSERT INTO public.chat_messages(application_id,sender_type,sender_id,body) VALUES('60000000-0000-4000-8000-000000000001','worker','10000000-0000-4000-8000-000000000001','blocked reply')$q$,'차단된 사용자');
INSERT INTO public.facility_admin_access VALUES('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000005','operator');
INSERT INTO public.chat_messages(application_id,sender_type,sender_id,body) VALUES('60000000-0000-4000-8000-000000000001','worker','10000000-0000-4000-8000-000000000001','other admin can still receive');
SELECT public.set_safety_user_block('10000000-0000-4000-8000-000000000002',false,'담당자');
SET LOCAL ROLE authenticated;
SELECT pg_temp.check_that((SELECT count(*)=4 FROM public.chat_messages),'unblock restores eligible historical messages');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000099',true);
SELECT pg_temp.reject($q$SELECT public.set_safety_user_block('10000000-0000-4000-8000-000000000002',true,'담당자')$q$,'시연');
SET LOCAL ROLE authenticated;
SELECT pg_temp.reject($q$SELECT public.review_safety_report(NULL,'resolved','',NULL,true)$q$,'permission denied');
RESET ROLE;
SELECT public.review_safety_report(id,'resolved','위반 확인','10000000-0000-4000-8000-000000000005',true) FROM public.chat_safety_reports;
SELECT pg_temp.check_that((SELECT body='[운영 정책 위반으로 숨겨진 메시지]' FROM public.chat_messages WHERE id='70000000-0000-4000-8000-000000000001'),'operator moderation replaces offending content');
SELECT pg_temp.check_that((SELECT content_hidden AND message_snapshot='admin text' AND reviewed_by IS NOT NULL FROM public.chat_safety_reports),'moderation retains evidence and operator audit');
SELECT pg_temp.check_that((SELECT NOT public.is_safety_outbox_allowed(id) FROM public.notification_outbox WHERE event_type='chat.message'),'moderation suppresses already claimed conversation push');
SELECT 'PASS: chat safety RLS, reporting, blocking, moderation and notifications' AS result;
ROLLBACK;
