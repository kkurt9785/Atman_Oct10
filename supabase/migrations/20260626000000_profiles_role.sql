-- ============================================================================
-- profiles — auth.users 1:1, 역할(worker|admin) + 온보딩 완료 여부
-- 역할은 온보딩 화면(역할 선택)에서 명시적으로 저장.
-- 앱 진입 시 profiles.role 로 라우팅 결정.
-- ============================================================================

CREATE TABLE IF NOT EXISTS profiles (
  id            UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role          TEXT CHECK (role IN ('worker', 'admin')),  -- NULL = 온보딩 미완료
  onboarding_done BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- updated_at 자동 갱신
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- 회원가입 즉시 빈 프로필 자동 생성 (role은 온보딩에서 채움)
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO profiles (id) VALUES (NEW.id) ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- RLS
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- 본인 프로필만 읽기/수정 (anon 불가)
CREATE POLICY "profiles: 본인 읽기" ON profiles
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "profiles: 본인 수정" ON profiles
  FOR UPDATE USING (auth.uid() = id);

-- service_role은 RLS 우회 (admin-web 서버사이드 쿼리)
