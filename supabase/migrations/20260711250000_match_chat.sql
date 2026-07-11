-- ============================================================================
-- 매칭 한시적 채팅
--   * 매칭 수락 시 채팅방 자동 개설(시스템 안내 첫 메시지)
--   * 전화번호·계좌 마스킹(직거래·개인정보 방어)
--   * 체크아웃 +24시간 후 읽기 전용 잠금 (기록은 분쟁 증빙으로 보존)
--   * 쓰기는 RPC 전용, 조회는 RLS (당사자 + 해당 병원 관리자)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.shift_applications(id) ON DELETE CASCADE,
  sender_type text NOT NULL CHECK (sender_type IN ('worker','facility','system')),
  sender_id uuid,
  body text NOT NULL CHECK (length(body) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_chat_messages_app ON public.chat_messages(application_id, created_at);

ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;
REVOKE INSERT, UPDATE, DELETE ON public.chat_messages FROM anon, authenticated;
GRANT SELECT ON public.chat_messages TO authenticated;

DROP POLICY IF EXISTS chat_select_worker ON public.chat_messages;
CREATE POLICY chat_select_worker ON public.chat_messages
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.shift_applications a
      WHERE a.id = application_id AND a.worker_id = public.current_worker_id()
    )
  );
DROP POLICY IF EXISTS chat_select_facility ON public.chat_messages;
CREATE POLICY chat_select_facility ON public.chat_messages
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.shift_applications a
      JOIN public.shifts s ON s.id = a.shift_id
      WHERE a.id = application_id
        AND public.facility_access_role(s.facility_id) IS NOT NULL
    )
  );

-- Realtime 발행 (이미 추가돼 있으면 무시)
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_messages;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- 채팅 가능 여부: 수락됨 ~ 체크아웃 +24h
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.chat_is_open(p_application_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.shift_applications a
    WHERE a.id = p_application_id
      AND a.status IN ('accepted','completed')
      AND (a.checked_out_at IS NULL OR a.checked_out_at > now() - interval '24 hours')
  );
$$;
GRANT EXECUTE ON FUNCTION public.chat_is_open(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 메시지 전송 — 당사자 검증 + 마스킹 + 잠금 + 상대방 푸시(outbox)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.send_chat_message(
  p_application_id uuid,
  p_body text
)
RETURNS public.chat_messages
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_app public.shift_applications%ROWTYPE;
  v_shift public.shifts%ROWTYPE;
  v_worker public.workers%ROWTYPE;
  v_sender_type text;
  v_body text;
  v_row public.chat_messages%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION '로그인이 필요해요'; END IF;
  IF length(trim(COALESCE(p_body, ''))) < 1 THEN RAISE EXCEPTION '메시지를 입력해 주세요'; END IF;

  SELECT * INTO v_app FROM public.shift_applications WHERE id = p_application_id;
  IF NOT FOUND THEN RAISE EXCEPTION '채팅방을 찾을 수 없어요'; END IF;
  SELECT * INTO v_shift FROM public.shifts WHERE id = v_app.shift_id;
  SELECT * INTO v_worker FROM public.workers WHERE id = v_app.worker_id;

  -- 발신자 판별: 해당 매칭의 워커이거나, 해당 병원의 관리자
  IF v_worker.auth_user_id = auth.uid() THEN
    v_sender_type := 'worker';
  ELSIF public.facility_access_role(v_shift.facility_id) IS NOT NULL THEN
    v_sender_type := 'facility';
  ELSE
    RAISE EXCEPTION '이 채팅에 참여할 수 없어요';
  END IF;

  IF NOT public.chat_is_open(p_application_id) THEN
    RAISE EXCEPTION '종료된 채팅이에요. 근무 종료 24시간 후에는 메시지를 보낼 수 없어요';
  END IF;

  -- 마스킹: 전화번호·8자리 이상 숫자열(계좌 추정) — 직거래·개인정보 방어
  v_body := regexp_replace(trim(p_body), '01[016789][ .-]?[0-9]{3,4}[ .-]?[0-9]{4}', '01*-****-****', 'g');
  v_body := regexp_replace(v_body, '[0-9]{8,}', '********', 'g');

  INSERT INTO public.chat_messages (application_id, sender_type, sender_id, body)
  VALUES (p_application_id, v_sender_type, auth.uid(), v_body)
  RETURNING * INTO v_row;

  -- 병원 → 워커 메시지는 푸시 (outbox 재사용). 워커 → 병원은 대시보드에서 확인
  IF v_sender_type = 'facility' THEN
    INSERT INTO public.notification_outbox (
      worker_auth_user_id, event_type, dedupe_key, title, body, data
    ) VALUES (
      v_worker.auth_user_id,
      'chat.message',
      'chat:' || v_row.id::text,
      '💬 병원에서 메시지가 왔어요',
      left(v_body, 80),
      jsonb_build_object('type','chat','applicationId',p_application_id)
    ) ON CONFLICT (dedupe_key) DO NOTHING;
  END IF;

  RETURN v_row;
END;
$$;
REVOKE ALL ON FUNCTION public.send_chat_message(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.send_chat_message(uuid, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 수락 시 채팅방 자동 개설: accept RPC 확장 — 시스템 안내 첫 메시지
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.seed_chat_on_accept()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_facility public.facilities%ROWTYPE;
  v_shift public.shifts%ROWTYPE;
BEGIN
  IF NEW.status = 'accepted' AND (OLD.status IS DISTINCT FROM 'accepted') THEN
    SELECT * INTO v_shift FROM public.shifts WHERE id = NEW.shift_id;
    SELECT * INTO v_facility FROM public.facilities WHERE id = v_shift.facility_id;

    INSERT INTO public.chat_messages (application_id, sender_type, sender_id, body)
    VALUES (
      NEW.id, 'system', NULL,
      format(
        E'매칭이 확정됐어요! 🎉\n\n📍 근무지: %s\n👤 담당자: %s\n🕐 근무: %s %s~%s\n\n문의사항은 이 채팅으로 남겨주세요. 근무 종료 24시간 후 채팅이 잠기며, 기록은 분쟁 대비를 위해 보관됩니다.',
        COALESCE(v_facility.address_text, v_facility.name),
        COALESCE(v_facility.contact_name, '병원 담당자'),
        v_shift.shift_date,
        to_char(v_shift.start_time, 'HH24:MI'),
        to_char(v_shift.end_time, 'HH24:MI')
      )
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_seed_chat_on_accept ON public.shift_applications;
CREATE TRIGGER trg_seed_chat_on_accept
  AFTER UPDATE OF status ON public.shift_applications
  FOR EACH ROW
  EXECUTE FUNCTION public.seed_chat_on_accept();
