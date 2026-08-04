-- Final pharmacy demo account contract:
-- worker-demo-2 = 박하늘 (pharmacy_staff)
-- worker-demo-6 = 김서현 (pharmacist)
DO $$
DECLARE
  v_demo2 uuid;
  v_demo6 uuid;
  v_staff uuid;
  v_pharmacist uuid;
BEGIN
  SELECT id INTO v_demo2 FROM auth.users WHERE email = 'worker-demo-2@demo.atman.co.kr';
  SELECT id INTO v_demo6 FROM auth.users WHERE email = 'worker-demo-6@demo.atman.co.kr';
  SELECT id INTO v_staff FROM public.workers
    WHERE kakao_id = 'demo_pharmacy_staff_2' AND deleted_at IS NULL;
  SELECT id INTO v_pharmacist FROM public.workers
    WHERE kakao_id = 'demo_pharmacist_1' AND deleted_at IS NULL;

  IF v_demo2 IS NULL OR v_demo6 IS NULL OR v_staff IS NULL OR v_pharmacist IS NULL THEN
    RAISE EXCEPTION 'required pharmacy demo account or worker is missing';
  END IF;

  UPDATE public.workers SET auth_user_id = NULL, email = NULL, updated_at = now()
  WHERE auth_user_id IN (v_demo2, v_demo6) AND id NOT IN (v_staff, v_pharmacist);
  UPDATE public.workers SET auth_user_id = NULL, email = NULL, updated_at = now()
  WHERE id IN (v_staff, v_pharmacist) AND auth_user_id NOT IN (v_demo2, v_demo6);

  UPDATE public.workers SET
    auth_user_id = v_demo2,
    email = 'worker-demo-2@demo.atman.co.kr',
    role = 'pharmacy_staff',
    verification_status = 'approved',
    activity_address_text = '수원 권선구',
    updated_at = now()
  WHERE id = v_staff;

  UPDATE public.workers SET
    auth_user_id = v_demo6,
    email = 'worker-demo-6@demo.atman.co.kr',
    role = 'pharmacist',
    verification_status = 'approved',
    activity_address_text = '수원 권선구',
    updated_at = now()
  WHERE id = v_pharmacist;

  INSERT INTO public.profiles (id, role, onboarding_done)
  VALUES (v_demo2, 'worker', true), (v_demo6, 'worker', true)
  ON CONFLICT (id) DO UPDATE SET role = 'worker', onboarding_done = true;
END $$;

SELECT * FROM public.refresh_demo_pharmacy_workforce();
