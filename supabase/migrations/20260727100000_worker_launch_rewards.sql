-- 워커 런칭 리워드: 임금/병원 결제 레거시 크레딧과 분리된 마케팅 보상 원장.
CREATE TABLE IF NOT EXISTS public.worker_referral_codes (
  worker_id uuid PRIMARY KEY REFERENCES public.workers(id) ON DELETE CASCADE,
  code text NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9]{12}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.worker_referrals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_worker_id uuid NOT NULL REFERENCES public.workers(id) ON DELETE CASCADE,
  referred_worker_id uuid NOT NULL UNIQUE REFERENCES public.workers(id) ON DELETE CASCADE,
  referral_code text NOT NULL REFERENCES public.worker_referral_codes(code),
  status text NOT NULL DEFAULT 'joined' CHECK (status IN ('joined','profile_verified','first_shift_completed','cancelled')),
  qualified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (referrer_worker_id <> referred_worker_id)
);
CREATE INDEX IF NOT EXISTS idx_worker_referrals_referrer ON public.worker_referrals(referrer_worker_id,created_at DESC);
CREATE TABLE IF NOT EXISTS public.marketing_reward_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_id uuid NOT NULL REFERENCES public.workers(id) ON DELETE CASCADE,
  reward_kind text NOT NULL CHECK (reward_kind IN ('profile_verified','first_shift','referral_referrer','referral_invitee','retention')),
  amount integer NOT NULL CHECK (amount > 0),
  status text NOT NULL DEFAULT 'qualified' CHECK (status IN ('qualified','approved','fulfilled','cancelled')),
  reference_type text NOT NULL,
  reference_id uuid,
  idempotency_key text NOT NULL UNIQUE,
  available_at timestamptz NOT NULL DEFAULT now(),
  fulfilled_at timestamptz,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_marketing_rewards_worker ON public.marketing_reward_ledger(worker_id,created_at DESC);
ALTER TABLE public.worker_referral_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.worker_referrals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_reward_ledger ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.worker_referral_codes,public.worker_referrals,public.marketing_reward_ledger FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.accept_my_worker_referral(p_code text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_me public.workers%ROWTYPE; v_referrer public.workers%ROWTYPE; v_code text:=upper(trim(COALESCE(p_code,'')));
BEGIN
  SELECT * INTO v_me FROM public.workers WHERE auth_user_id=auth.uid() AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION '온보딩을 먼저 완료해 주세요.'; END IF;
  SELECT w.* INTO v_referrer FROM public.worker_referral_codes c JOIN public.workers w ON w.id=c.worker_id
    WHERE c.code=v_code AND w.deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION '유효하지 않은 초대 코드예요.'; END IF;
  IF COALESCE(v_referrer.is_demo,false) THEN RAISE EXCEPTION '시연 계정의 초대 코드는 사용할 수 없어요.'; END IF;
  IF v_referrer.id=v_me.id THEN RAISE EXCEPTION '본인의 초대 코드는 사용할 수 없어요.'; END IF;
  IF public.normalize_phone(v_referrer.phone)=public.normalize_phone(v_me.phone) THEN RAISE EXCEPTION '동일한 휴대전화 정보로 추천할 수 없어요.'; END IF;
  IF v_me.created_at<timestamptz '2026-07-27 00:00:00+09' THEN RAISE EXCEPTION '런칭 이후 신규 가입자만 초대 혜택을 받을 수 있어요.'; END IF;
  IF EXISTS(SELECT 1 FROM public.shift_attendances WHERE worker_id=v_me.id AND check_out_at IS NOT NULL) THEN RAISE EXCEPTION '첫 근무를 완료하기 전에 입력한 초대만 인정돼요.'; END IF;
  INSERT INTO public.worker_referrals(referrer_worker_id,referred_worker_id,referral_code)
    VALUES(v_referrer.id,v_me.id,v_code) ON CONFLICT(referred_worker_id) DO NOTHING;
  RETURN jsonb_build_object('ok',true);
END; $$;

CREATE OR REPLACE FUNCTION public.get_my_launch_reward_status()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  v_me public.workers%ROWTYPE; v_code text; v_profile boolean:=false; v_applied boolean:=false;
  v_completed boolean:=false; v_attendance_id uuid; v_ref public.worker_referrals%ROWTYPE; v_eligible boolean:=false;
BEGIN
  SELECT * INTO v_me FROM public.workers WHERE auth_user_id=auth.uid() AND deleted_at IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'message','워커 정보를 찾을 수 없어요.'); END IF;
  v_eligible:=v_me.created_at>=timestamptz '2026-07-27 00:00:00+09' AND NOT COALESCE(v_me.is_demo,false);
  v_profile:=v_me.verification_status='approved'
    AND (v_me.license_number IS NOT NULL OR v_me.license_photo_url IS NOT NULL)
    AND EXISTS(SELECT 1 FROM public.worker_location_prefs p WHERE p.worker_id=v_me.auth_user_id);
  SELECT EXISTS(SELECT 1 FROM public.shift_applications a WHERE a.worker_id=v_me.id) INTO v_applied;
  SELECT a.id INTO v_attendance_id FROM public.shift_attendances a
    WHERE a.worker_id=v_me.id AND a.check_out_at IS NOT NULL AND NOT COALESCE(a.has_dispute,false)
    ORDER BY a.check_out_at LIMIT 1;
  v_completed:=v_attendance_id IS NOT NULL;
  INSERT INTO public.worker_referral_codes(worker_id,code)
    VALUES(v_me.id,upper(substr(replace(v_me.id::text,'-',''),1,12))) ON CONFLICT(worker_id) DO NOTHING;
  SELECT code INTO v_code FROM public.worker_referral_codes WHERE worker_id=v_me.id;
  IF v_eligible AND v_profile THEN
    INSERT INTO public.marketing_reward_ledger(worker_id,reward_kind,amount,reference_type,reference_id,idempotency_key,available_at,note)
      VALUES(v_me.id,'profile_verified',5000,'worker',v_me.id,'launch-profile:'||v_me.id,now(),'커피 쿠폰')
      ON CONFLICT(idempotency_key) DO NOTHING;
  END IF;
  SELECT * INTO v_ref FROM public.worker_referrals WHERE referred_worker_id=v_me.id;
  IF FOUND AND v_profile AND v_ref.status='joined' THEN UPDATE public.worker_referrals SET status='profile_verified' WHERE id=v_ref.id; END IF;
  IF v_eligible AND v_completed THEN
    INSERT INTO public.marketing_reward_ledger(worker_id,reward_kind,amount,reference_type,reference_id,idempotency_key,available_at,note)
      VALUES(v_me.id,'first_shift',20000,'attendance',v_attendance_id,'launch-first-shift:'||v_me.id,now()+interval '7 days','첫 근무 완료')
      ON CONFLICT(idempotency_key) DO NOTHING;
    IF v_ref.id IS NOT NULL THEN
      UPDATE public.worker_referrals SET status='first_shift_completed',qualified_at=COALESCE(qualified_at,now()) WHERE id=v_ref.id;
      INSERT INTO public.marketing_reward_ledger(worker_id,reward_kind,amount,reference_type,reference_id,idempotency_key,available_at,note)
        VALUES(v_me.id,'referral_invitee',5000,'referral',v_ref.id,'launch-referral-invitee:'||v_ref.id,now()+interval '7 days','친구 초대 추가 혜택')
        ON CONFLICT(idempotency_key) DO NOTHING;
      INSERT INTO public.marketing_reward_ledger(worker_id,reward_kind,amount,reference_type,reference_id,idempotency_key,available_at,note)
        VALUES(v_ref.referrer_worker_id,'referral_referrer',10000,'referral',v_ref.id,'launch-referral-referrer:'||v_ref.id,now()+interval '7 days','친구 첫 근무 완료')
        ON CONFLICT(idempotency_key) DO NOTHING;
    END IF;
  END IF;
  RETURN jsonb_build_object(
    'ok',true,'eligible',v_eligible,'isDemo',COALESCE(v_me.is_demo,false),'code',v_code,
    'milestones',jsonb_build_object('profileVerified',v_profile,'firstApplied',v_applied,'firstShiftCompleted',v_completed),
    'referredBy',CASE WHEN v_ref.id IS NULL THEN NULL ELSE true END,
    'rewards',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',r.id,'kind',r.reward_kind,'amount',r.amount,'status',r.status,'availableAt',r.available_at,'note',r.note) ORDER BY r.created_at) FROM public.marketing_reward_ledger r WHERE r.worker_id=v_me.id),'[]'::jsonb),
    'referrals',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',x.id,'name',left(w.name,1)||'**','status',x.status,'createdAt',x.created_at) ORDER BY x.created_at DESC)
      FROM public.worker_referrals x JOIN public.workers w ON w.id=x.referred_worker_id WHERE x.referrer_worker_id=v_me.id),'[]'::jsonb)
  );
END; $$;
REVOKE ALL ON FUNCTION public.accept_my_worker_referral(text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.get_my_launch_reward_status() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.accept_my_worker_referral(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_launch_reward_status() TO authenticated;
