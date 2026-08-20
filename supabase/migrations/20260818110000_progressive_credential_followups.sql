-- 간호직 단계적 자격검증 후속 정리 (2026-08-18)
-- 플랫폼 사전 서류 제출은 선택적으로 두되, 채용 확정 전 사업장 확인과
-- 감사 로그는 유지한다. 간호직 리워드 프로필 마일스톤은 경력/최근 근무지로 달성한다.

DO $$
DECLARE
  fn regprocedure := to_regprocedure('public.confirm_application_credential(uuid)');
  def text; patched text;
BEGIN
  IF fn IS NULL THEN RAISE EXCEPTION 'confirm_application_credential not found'; END IF;
  SELECT pg_get_functiondef(fn) INTO def;
  IF def LIKE '%verified_by_facility%' THEN
    RAISE NOTICE '① already patched - skip';
  ELSE
    patched := replace(def, '''original_checked_by_facility''', '''verified_by_facility''');
    IF patched = def THEN RAISE EXCEPTION 'audit method anchor not found'; END IF;
    patched := replace(patched, '면허·자격 원본 확인 후 채용을 확정해 주세요', '자격 확인 후 채용을 확정해 주세요');
    EXECUTE patched;
  END IF;
END $$;

DO $$
DECLARE
  fn regprocedure := to_regprocedure('public.accept_shift_application(uuid)');
  def text; patched text;
BEGIN
  SELECT pg_get_functiondef(fn) INTO def;
  patched := replace(def, '면허·자격 원본 확인 후 채용을 확정해 주세요', '자격 확인 후 채용을 확정해 주세요');
  IF patched <> def THEN EXECUTE patched; ELSE RAISE NOTICE 'accept message already aligned - skip'; END IF;
END $$;

CREATE OR REPLACE FUNCTION public.get_my_launch_reward_status()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  v_me public.workers%ROWTYPE; v_code text; v_profile boolean:=false; v_applied boolean:=false;
  v_completed boolean:=false; v_attendance_id uuid; v_ref public.worker_referrals%ROWTYPE; v_eligible boolean:=false;
BEGIN
  SELECT * INTO v_me FROM public.workers WHERE auth_user_id=auth.uid() AND deleted_at IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'message','워커 정보를 찾을 수 없어요.'); END IF;
  v_eligible:=v_me.created_at>=timestamptz '2026-07-27 00:00:00+09' AND NOT COALESCE(v_me.is_demo,false);
  v_profile:=((v_me.role IN ('rn','na') AND v_me.experience_years IS NOT NULL AND NULLIF(trim(COALESCE(v_me.last_workplace,'')),'') IS NOT NULL)
    OR (v_me.verification_status='approved' AND (v_me.license_number IS NOT NULL OR v_me.license_photo_url IS NOT NULL)
      AND EXISTS(SELECT 1 FROM public.worker_location_prefs p WHERE p.worker_id=v_me.auth_user_id)));
  SELECT EXISTS(SELECT 1 FROM public.shift_applications a WHERE a.worker_id=v_me.id) INTO v_applied;
  SELECT a.id INTO v_attendance_id FROM public.shift_attendances a
    JOIN public.shifts rs ON rs.id=a.shift_id
    JOIN public.facilities rf ON rf.id=rs.facility_id
    WHERE a.worker_id=v_me.id AND a.check_out_at IS NOT NULL AND NOT COALESCE(a.has_dispute,false)
      AND COALESCE(rf.is_demo,false)=false
    ORDER BY a.check_out_at LIMIT 1;
  v_completed:=v_attendance_id IS NOT NULL;
  INSERT INTO public.worker_referral_codes(worker_id,code) VALUES(v_me.id,upper(substr(replace(v_me.id::text,'-',''),1,12))) ON CONFLICT(worker_id) DO NOTHING;
  SELECT code INTO v_code FROM public.worker_referral_codes WHERE worker_id=v_me.id;
  IF v_eligible AND v_profile THEN INSERT INTO public.marketing_reward_ledger(worker_id,reward_kind,amount,reference_type,reference_id,idempotency_key,available_at,note) VALUES(v_me.id,'profile_verified',5000,'worker',v_me.id,'launch-profile:'||v_me.id,now(),'커피 쿠폰') ON CONFLICT(idempotency_key) DO NOTHING; END IF;
  SELECT * INTO v_ref FROM public.worker_referrals WHERE referred_worker_id=v_me.id;
  IF FOUND AND v_profile AND v_ref.status='joined' THEN UPDATE public.worker_referrals SET status='profile_verified' WHERE id=v_ref.id; END IF;
  IF v_eligible AND v_completed THEN
    INSERT INTO public.marketing_reward_ledger(worker_id,reward_kind,amount,reference_type,reference_id,idempotency_key,available_at,note)
      VALUES(v_me.id,'first_shift',20000,'attendance',v_attendance_id,'launch-first-shift:'||v_me.id,now()+interval '7 days','첫 근무 완료') ON CONFLICT(idempotency_key) DO NOTHING;
    IF v_ref.id IS NOT NULL THEN
      UPDATE public.worker_referrals SET status='first_shift_completed',qualified_at=COALESCE(qualified_at,now()) WHERE id=v_ref.id;
      INSERT INTO public.marketing_reward_ledger(worker_id,reward_kind,amount,reference_type,reference_id,idempotency_key,available_at,note)
        VALUES(v_me.id,'referral_invitee',5000,'referral',v_ref.id,'launch-referral-invitee:'||v_ref.id,now()+interval '7 days','친구 초대 추가 혜택') ON CONFLICT(idempotency_key) DO NOTHING;
      INSERT INTO public.marketing_reward_ledger(worker_id,reward_kind,amount,reference_type,reference_id,idempotency_key,available_at,note)
        VALUES(v_ref.referrer_worker_id,'referral_referrer',10000,'referral',v_ref.id,'launch-referral-referrer:'||v_ref.id,now()+interval '7 days','친구 첫 근무 완료') ON CONFLICT(idempotency_key) DO NOTHING;
    END IF;
  END IF;
  RETURN jsonb_build_object('ok',true,'eligible',v_eligible,'isDemo',COALESCE(v_me.is_demo,false),'code',v_code,'milestones',jsonb_build_object('profileVerified',v_profile,'firstApplied',v_applied,'firstShiftCompleted',v_completed),'rewards',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',r.id,'kind',r.reward_kind,'amount',r.amount,'status',r.status,'availableAt',r.available_at,'note',r.note) ORDER BY r.created_at) FROM public.marketing_reward_ledger r WHERE r.worker_id=v_me.id),'[]'::jsonb));
END; $$;
REVOKE ALL ON FUNCTION public.get_my_launch_reward_status() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_my_launch_reward_status() TO authenticated;

SELECT
  strpos(pg_get_functiondef('public.confirm_application_credential(uuid)'::regprocedure), 'verified_by_facility') > 0 AS audit_method_aligned,
  strpos(pg_get_functiondef('public.accept_shift_application(uuid)'::regprocedure), '자격 확인 후 채용을 확정') > 0 AS accept_message_aligned,
  strpos(pg_get_functiondef('public.get_my_launch_reward_status()'::regprocedure), 'v_me.role IN (''rn'',''na'')') > 0 AS reward_unlocked_for_nursing;
