-- Normalize direct demo auth rows for the current GoTrue token expectations,
-- then restore worker links if an interrupted provisioning attempt cleared one.
WITH demo_workers(email, display_name, kakao_id) AS (
  VALUES
    ('worker-demo-pharmacist@demo.atman.co.kr', '수원 데모 약사', 'demo_pharmacist_1'),
    ('worker-demo-pharmacy-staff@demo.atman.co.kr', '수원 데모 약국 전산직', 'demo_pharmacy_staff_1')
),
upsert_users AS (
  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, phone_change, phone_change_token,
    reauthentication_token, raw_app_meta_data, raw_user_meta_data,
    is_sso_user, is_anonymous, created_at, updated_at
  )
  SELECT
    '00000000-0000-0000-0000-000000000000', gen_random_uuid(),
    'authenticated', 'authenticated', email,
    extensions.crypt('Atman-demo-2026!', extensions.gen_salt('bf')), now(),
    '', '', '', '', '', '', '', '',
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('profile_nickname', display_name),
    false, false, now(), now()
  FROM demo_workers
  ON CONFLICT (email) WHERE is_sso_user = false DO UPDATE SET
    encrypted_password = EXCLUDED.encrypted_password,
    email_confirmed_at = COALESCE(auth.users.email_confirmed_at, now()),
    confirmation_token = '', recovery_token = '', email_change_token_new = '',
    email_change = '', email_change_token_current = '', phone_change = '',
    phone_change_token = '', reauthentication_token = '',
    raw_app_meta_data = EXCLUDED.raw_app_meta_data,
    raw_user_meta_data = EXCLUDED.raw_user_meta_data,
    is_anonymous = false, updated_at = now()
  RETURNING id, email
),
profile_rows AS (
  INSERT INTO public.profiles (id, role, onboarding_done)
  SELECT id, 'worker', true FROM upsert_users
  ON CONFLICT (id) DO UPDATE SET role = 'worker', onboarding_done = true, updated_at = now()
)
UPDATE public.workers w
SET auth_user_id = u.id, email = u.email, verification_status = 'approved',
    verified_at = COALESCE(w.verified_at, now()), is_demo = true,
    deleted_at = NULL, updated_at = now()
FROM upsert_users u
JOIN demo_workers d ON d.email = u.email
WHERE w.kakao_id = d.kakao_id;

INSERT INTO auth.identities (
  provider_id, user_id, identity_data, provider,
  last_sign_in_at, created_at, updated_at
)
SELECT
  u.id::text, u.id,
  jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true, 'phone_verified', false),
  'email', now(), now(), now()
FROM auth.users u
WHERE u.email IN (
  'worker-demo-pharmacist@demo.atman.co.kr',
  'worker-demo-pharmacy-staff@demo.atman.co.kr'
)
ON CONFLICT (provider_id, provider) DO UPDATE SET
  user_id = EXCLUDED.user_id, identity_data = EXCLUDED.identity_data, updated_at = now();
