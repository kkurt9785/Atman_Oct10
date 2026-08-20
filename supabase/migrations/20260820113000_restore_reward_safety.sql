-- 단계적 프로필 마일스톤을 적용하면서도 데모 사업장 근태가
-- 첫 근무 보상으로 집계되지 않도록 원래의 안전 필터를 복원한다.
CREATE OR REPLACE FUNCTION public.get_my_launch_reward_status()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  v_me public.workers%ROWTYPE; v_code text; v_profile boolean:=false; v_applied boolean:=false;
  v_completed boolean:=false; v_attendance_id uuid; v_ref public.worker_referrals%ROWTYPE; v_eligible boolean:=false;
BEGIN
  SELECT * INTO v_me FROM public.workers WHERE auth_user_id=auth.uid() AND deleted_at IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'message','워커 정보를 찾을 수 없어요.'); END IF;
  v_eligible:=v_me.created_at>=timestamptz '2026-07-27 00:00:00+09' AND NOT COALESCE(v_me.is_demo,false);
  v_profile:=((v_me.role IN ('rn','na','pharmacist') AND v_me.experience_years IS NOT NULL AND NULLIF(trim(COALESCE(v_me.last_workplace,'')),'') IS NOT NULL)
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
  IF v_eligible AND v_profile THEN
    INSERT INTO public.marketing_reward_ledger(worker_id,reward_kind,amount,reference_type,reference_id,idempotency_key,available_at,note) VALUES(v_me.id,'profile_verified',5000,'worker',v_me.id,'launch-profile:'||v_me.id,now(),'커피 쿠폰') ON CONFLICT(idempotency_key) DO NOTHING;
  END IF;
  SELECT * INTO v_ref FROM public.worker_referrals WHERE referred_worker_id=v_me.id;
  IF FOUND AND v_profile AND v_ref.status='joined' THEN UPDATE public.worker_referrals SET status='profile_verified' WHERE id=v_ref.id; END IF;
  IF v_eligible AND v_completed THEN
    INSERT INTO public.marketing_reward_ledger(worker_id,reward_kind,amount,reference_type,reference_id,idempotency_key,available_at,note) VALUES(v_me.id,'first_shift',20000,'attendance',v_attendance_id,'launch-first-shift:'||v_me.id,now()+interval '7 days','첫 근무 완료') ON CONFLICT(idempotency_key) DO NOTHING;
    IF v_ref.id IS NOT NULL THEN
      UPDATE public.worker_referrals SET status='first_shift_completed',qualified_at=COALESCE(qualified_at,now()) WHERE id=v_ref.id;
      INSERT INTO public.marketing_reward_ledger(worker_id,reward_kind,amount,reference_type,reference_id,idempotency_key,available_at,note) VALUES(v_me.id,'referral_invitee',5000,'referral',v_ref.id,'launch-referral-invitee:'||v_ref.id,now()+interval '7 days','친구 초대 추가 혜택') ON CONFLICT(idempotency_key) DO NOTHING;
      INSERT INTO public.marketing_reward_ledger(worker_id,reward_kind,amount,reference_type,reference_id,idempotency_key,available_at,note) VALUES(v_ref.referrer_worker_id,'referral_referrer',10000,'referral',v_ref.id,'launch-referral-referrer:'||v_ref.id,now()+interval '7 days','친구 첫 근무 완료') ON CONFLICT(idempotency_key) DO NOTHING;
    END IF;
  END IF;
  RETURN jsonb_build_object('ok',true,'eligible',v_eligible,'isDemo',COALESCE(v_me.is_demo,false),'code',v_code,
    'milestones',jsonb_build_object('profileVerified',v_profile,'firstApplied',v_applied,'firstShiftCompleted',v_completed),
    'referredBy',CASE WHEN v_ref.id IS NULL THEN NULL ELSE true END,
    'rewards',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',r.id,'kind',r.reward_kind,'amount',r.amount,'status',r.status,'availableAt',r.available_at,'note',r.note) ORDER BY r.created_at) FROM public.marketing_reward_ledger r WHERE r.worker_id=v_me.id),'[]'::jsonb),
    'referrals',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',x.id,'name',left(w.name,1)||'**','status',x.status,'createdAt',x.created_at) ORDER BY x.created_at DESC) FROM public.worker_referrals x JOIN public.workers w ON w.id=x.referred_worker_id WHERE x.referrer_worker_id=v_me.id),'[]'::jsonb));
END; $$;
REVOKE ALL ON FUNCTION public.get_my_launch_reward_status() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_my_launch_reward_status() TO authenticated;
