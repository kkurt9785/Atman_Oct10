-- 긱워커 시연을 기존 RN 데모 계정에서 완전히 분리한다.
-- 새 계정은 의료 직군·지원·근무 이력이 없고, 긱 초대/근태/정산만 가진다.

DO $setup_gig_demo$
DECLARE
  v_auth uuid := '20260928-1130-4000-8000-000000000001';
  v_worker uuid := '20260928-1130-4000-8000-000000000002';
  v_email text := 'worker-gig-demo@demo.atman.co.kr';
  v_password text;
  v_facility uuid;
  v_staff constant uuid := '20260922-0000-4000-8000-000000000004';
  v_invite constant uuid := '20260922-0000-4000-8000-000000000005';
  v_token constant uuid := '20260922-0000-4000-8000-000000000006';
  v_admin uuid;
  v_today date := (timezone('Asia/Seoul', now()))::date;
BEGIN
  -- 운영의 DEMO_ACCOUNT_PASSWORD와 동일한 기존 데모 해시를 재사용한다.
  SELECT encrypted_password INTO v_password
  FROM auth.users
  WHERE email='worker-demo-4@demo.atman.co.kr' AND is_sso_user=false
  LIMIT 1;
  IF v_password IS NULL THEN
    v_password := extensions.crypt('Atman-demo-2026!', extensions.gen_salt('bf'));
  END IF;

  INSERT INTO auth.users(
    instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
    confirmation_token,recovery_token,email_change_token_new,email_change,
    email_change_token_current,phone_change,phone_change_token,reauthentication_token,
    raw_app_meta_data,raw_user_meta_data,is_sso_user,is_anonymous,created_at,updated_at
  ) VALUES (
    '00000000-0000-0000-0000-000000000000',v_auth,'authenticated','authenticated',v_email,v_password,now(),
    '','','','','','','','',
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"profile_nickname":"긱워커 데모"}'::jsonb,false,false,now(),now()
  ) ON CONFLICT (email) WHERE is_sso_user=false DO UPDATE SET
    encrypted_password=EXCLUDED.encrypted_password,
    email_confirmed_at=COALESCE(auth.users.email_confirmed_at,now()),
    confirmation_token='',recovery_token='',email_change_token_new='',email_change='',
    email_change_token_current='',phone_change='',phone_change_token='',reauthentication_token='',
    raw_app_meta_data=EXCLUDED.raw_app_meta_data,
    raw_user_meta_data=EXCLUDED.raw_user_meta_data,
    is_anonymous=false,updated_at=now()
  RETURNING id INTO v_auth;

  INSERT INTO auth.identities(
    provider_id,user_id,identity_data,provider,last_sign_in_at,created_at,updated_at
  ) VALUES (
    v_auth::text,v_auth,
    jsonb_build_object('sub',v_auth::text,'email',v_email,'email_verified',true,'phone_verified',false),
    'email',now(),now(),now()
  ) ON CONFLICT(provider_id,provider) DO UPDATE SET
    user_id=EXCLUDED.user_id,identity_data=EXCLUDED.identity_data,updated_at=now();

  INSERT INTO public.profiles(id,role,onboarding_done)
  VALUES(v_auth,'worker',true)
  ON CONFLICT(id) DO UPDATE SET role='worker',onboarding_done=true,updated_at=now();

  INSERT INTO public.workers(
    id,auth_user_id,kakao_id,name,phone,email,birth_date,role,
    activity_center,activity_radius_meters,activity_address_text,
    verification_status,verified_at,is_demo,created_at,updated_at
  ) VALUES (
    v_worker,v_auth,'gig_demo_worker_2026','긱워커 데모',NULL,v_email,'1995-01-01','other',
    public.ST_SetSRID(public.ST_MakePoint(127.0286,37.2636),4326)::public.geography,
    5000,'수원시청역 팝업 행사장','approved',now(),true,now(),now()
  ) ON CONFLICT(kakao_id) DO UPDATE SET
    auth_user_id=EXCLUDED.auth_user_id,name=EXCLUDED.name,phone=NULL,email=EXCLUDED.email,
    role='other',activity_center=EXCLUDED.activity_center,
    activity_radius_meters=EXCLUDED.activity_radius_meters,
    activity_address_text=EXCLUDED.activity_address_text,
    verification_status='approved',verified_at=COALESCE(public.workers.verified_at,now()),
    is_demo=true,deleted_at=NULL,updated_at=now()
  RETURNING id INTO v_worker;

  -- 전용 계정에는 의료 워커 데이터가 절대 붙지 않게 한다.
  DELETE FROM public.shift_applications WHERE worker_id=v_worker;
  DELETE FROM public.facility_staff fs
  USING public.facilities f
  WHERE fs.worker_id=v_worker AND f.id=fs.facility_id
    AND NOT (f.facility_type='gigworker' OR f.registration_source='gigworker_trial');

  -- 정산 시연용 가상 계좌. 전체 번호는 운영 키로 암호화하며 실제 송금용이 아니다.
  UPDATE public.worker_bank_accounts SET
    bank_code='090',bank_name='카카오뱅크',
    account_number_encrypted=extensions.pgp_sym_encrypt('000012345678',public.bank_encryption_key()),
    account_number_last4='5678',account_holder_name='긱워커 데모',
    verification_status='verified',verified_at=now(),is_primary=true,deleted_at=NULL
  WHERE worker_id=v_worker AND is_primary=true;
  IF NOT FOUND THEN
    INSERT INTO public.worker_bank_accounts(
      worker_id,bank_code,bank_name,account_number_encrypted,account_number_last4,
      account_holder_name,verification_status,verified_at,is_primary
    ) VALUES (
      v_worker,'090','카카오뱅크',
      extensions.pgp_sym_encrypt('000012345678',public.bank_encryption_key()),
      '5678','긱워커 데모','verified',now(),true
    );
  END IF;

  SELECT id INTO v_facility FROM public.facilities
  WHERE business_registration_number='DEMO-GIGWORKER-2026'
    AND is_demo=true AND is_active=true AND deleted_at IS NULL;
  SELECT id INTO v_admin FROM auth.users WHERE email='sales-demo-1@demo.atman.co.kr';
  IF v_facility IS NULL OR v_admin IS NULL THEN
    RAISE EXCEPTION '긱워커 데모 근무지 또는 관리자가 준비되지 않았습니다';
  END IF;

  -- 기존 RN 데모 연결과 반복 시연 결과를 끊고 전용 계정의 초대 대기 상태로 돌린다.
  DELETE FROM public.gig_payouts WHERE staff_id=v_staff;
  DELETE FROM public.gig_bank_account_shares WHERE staff_id=v_staff;
  DELETE FROM public.staff_attendances WHERE staff_id=v_staff;
  DELETE FROM public.attendance_auth_logs WHERE staff_id=v_staff;
  DELETE FROM public.notification_outbox WHERE worker_auth_user_id=v_auth;

  UPDATE public.facility_staff SET
    facility_id=v_facility,worker_id=NULL,name='긱워커 데모',phone=NULL,
    role='other',department='팝업 행사 운영·고객 안내',source='direct',
    engagement_type='temporary',contract_start=v_today-30,contract_end=v_today+365,
    default_start_time='10:00',default_end_time='18:00',default_break_minutes=60,
    pay_basis='hourly',pay_rate=15000,status='active',
    work_weekdays=ARRAY[1,2,3,4,5,6,7]::smallint[],updated_at=now()
  WHERE id=v_staff;

  UPDATE public.facility_staff_invites SET status='cancelled'
  WHERE staff_id=v_staff AND status='pending' AND id<>v_invite;
  INSERT INTO public.facility_staff_invites(
    id,facility_id,staff_id,token,phone_normalized,status,
    expires_at,accepted_by,accepted_at,created_by
  ) VALUES (
    v_invite,v_facility,v_staff,v_token,NULL,'pending',now()+interval '30 days',NULL,NULL,v_admin
  ) ON CONFLICT(id) DO UPDATE SET
    facility_id=EXCLUDED.facility_id,staff_id=EXCLUDED.staff_id,token=EXCLUDED.token,
    phone_normalized=NULL,status='pending',expires_at=now()+interval '30 days',
    accepted_by=NULL,accepted_at=NULL,created_by=EXCLUDED.created_by;
END
$setup_gig_demo$;

CREATE OR REPLACE FUNCTION public.reset_gigworker_invite_demo()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=''
AS $$
DECLARE
  v_worker public.workers%ROWTYPE;
  v_facility uuid;
  v_staff constant uuid := '20260922-0000-4000-8000-000000000004';
  v_invite constant uuid := '20260922-0000-4000-8000-000000000005';
  v_token constant uuid := '20260922-0000-4000-8000-000000000006';
  v_today date := (timezone('Asia/Seoul',now()))::date;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION '로그인이 필요해요.'; END IF;
  SELECT w.* INTO v_worker
  FROM public.workers w JOIN auth.users u ON u.id=w.auth_user_id
  WHERE w.auth_user_id=auth.uid()
    AND u.email='worker-gig-demo@demo.atman.co.kr'
    AND w.role='other' AND w.is_demo=true AND w.deleted_at IS NULL;
  IF v_worker.id IS NULL THEN RAISE EXCEPTION '긱워커 전용 데모 계정만 사용할 수 있어요.'; END IF;

  SELECT id INTO v_facility FROM public.facilities
  WHERE business_registration_number='DEMO-GIGWORKER-2026'
    AND is_demo=true AND is_active=true AND deleted_at IS NULL;
  IF v_facility IS NULL THEN RAISE EXCEPTION '긱워커 데모 근무지를 찾지 못했어요.'; END IF;

  -- 반복 시연마다 초대 전 상태로 완전히 초기화한다.
  DELETE FROM public.gig_payouts WHERE staff_id=v_staff;
  DELETE FROM public.gig_bank_account_shares WHERE staff_id=v_staff;
  DELETE FROM public.staff_attendances WHERE staff_id=v_staff;
  DELETE FROM public.attendance_auth_logs WHERE staff_id=v_staff;
  DELETE FROM public.notification_outbox WHERE worker_auth_user_id=auth.uid();

  UPDATE public.facility_staff SET
    worker_id=NULL,name=v_worker.name,phone=NULL,status='active',
    contract_start=v_today-30,contract_end=v_today+365,
    pay_basis='hourly',pay_rate=15000,updated_at=now()
  WHERE id=v_staff AND facility_id=v_facility;
  IF NOT FOUND THEN RAISE EXCEPTION '긱워커 데모 근무자를 찾지 못했어요.'; END IF;

  UPDATE public.facility_staff_invites SET status='cancelled'
  WHERE staff_id=v_staff AND status='pending' AND id<>v_invite;
  INSERT INTO public.facility_staff_invites(
    id,facility_id,staff_id,token,phone_normalized,status,expires_at,accepted_by,accepted_at
  ) VALUES (
    v_invite,v_facility,v_staff,v_token,NULL,'pending',now()+interval '30 days',NULL,NULL
  ) ON CONFLICT(id) DO UPDATE SET
    facility_id=EXCLUDED.facility_id,staff_id=EXCLUDED.staff_id,token=EXCLUDED.token,
    phone_normalized=NULL,status='pending',expires_at=now()+interval '30 days',
    accepted_by=NULL,accepted_at=NULL;
  RETURN v_token;
END;
$$;

REVOKE ALL ON FUNCTION public.reset_gigworker_invite_demo() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.reset_gigworker_invite_demo() TO authenticated;

SELECT
  (SELECT count(*) FROM auth.users WHERE email='worker-gig-demo@demo.atman.co.kr') AS gig_auth_1,
  (SELECT count(*) FROM public.workers WHERE kakao_id='gig_demo_worker_2026' AND role='other' AND is_demo=true) AS gig_worker_1,
  (SELECT count(*) FROM public.shift_applications a JOIN public.workers w ON w.id=a.worker_id WHERE w.kakao_id='gig_demo_worker_2026') AS medical_shift_rows_0;
