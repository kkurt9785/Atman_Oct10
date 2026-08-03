-- auth.users inserted by the reproducible demo seed also need email identities
-- for GoTrue password sign-in.
INSERT INTO auth.identities (
  provider_id, user_id, identity_data, provider,
  last_sign_in_at, created_at, updated_at
)
SELECT
  u.id::text,
  u.id,
  jsonb_build_object(
    'sub', u.id::text,
    'email', u.email,
    'email_verified', true,
    'phone_verified', false
  ),
  'email',
  now(),
  now(),
  now()
FROM auth.users u
WHERE u.email IN (
  'worker-demo-pharmacist@demo.atman.co.kr',
  'worker-demo-pharmacy-staff@demo.atman.co.kr'
)
ON CONFLICT (provider_id, provider) DO UPDATE SET
  user_id = EXCLUDED.user_id,
  identity_data = EXCLUDED.identity_data,
  updated_at = now();
