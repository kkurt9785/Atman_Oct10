-- 운영 리워드에 시연 계정이 추천인으로 섞이지 않도록 서버에서 차단한다.
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
REVOKE ALL ON FUNCTION public.accept_my_worker_referral(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.accept_my_worker_referral(text) TO authenticated;
