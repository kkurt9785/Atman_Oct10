-- ============================================================================
-- 전면 리뷰 후속 수정 (2026-08-18) — 알림·단계적 자격검증 정합성 5건
-- ① 알림 수신자 RPC 데모 격리 — 데모 시설 공고 알림이 반경 내 실제 워커에게
--    발송되던 문제 (시연 리셋마다 실사용자 스팸)
-- ② 지도 핀 RPC progressive 직군 개방 — 목록엔 보이는데 지도엔 핀 0개
-- ③ 워커→관리자 채팅 트리거 시드 무음 가드 — 데모 시드가 관리자 푸시 유발
-- ④ 자격확인 RPC 멱등 가드 — 재호출 시 감사로그 중복·확인자 덮어쓰기 방지
-- ⑤ payment.reconciliation 관리자 푸시 구현 + checkout 딥링크 /earnings
-- 전부 fail-loud 문자열 패치. 재실행 시 이미 적용분은 NOTICE 후 skip.
-- ============================================================================

-- ① get_shift_notification_recipients: 데모 시설 공고는 데모 워커에게만
DO $$
DECLARE def text; patched text;
BEGIN
  SELECT pg_get_functiondef('public.get_shift_notification_recipients(uuid)'::regprocedure) INTO def;
  IF def LIKE '%is_demo%' THEN RAISE NOTICE '① already patched'; RETURN; END IF;
  patched := replace(def,
    'AND f.is_active = true',
    'AND f.is_active = true
    AND (COALESCE(f.is_demo, false) = false OR COALESCE(w.is_demo, false) = true)');
  IF patched = def THEN RAISE EXCEPTION '① recipients anchor not found'; END IF;
  EXECUTE patched;
END $$;

-- ② get_shift_map_points_secure: progressive 직군(rn/na/pharmacist) 개방
DO $$
DECLARE def text; patched text;
BEGIN
  SELECT pg_get_functiondef('public.get_shift_map_points_secure(uuid[])'::regprocedure) INTO def;
  IF def LIKE '%''rn'', ''na'', ''pharmacist''%' THEN RAISE NOTICE '② already patched'; RETURN; END IF;
  patched := replace(def,
    'AND w.verification_status = ''approved''',
    'AND (w.role IN (''rn'', ''na'', ''pharmacist'') OR w.verification_status = ''approved'')');
  IF patched = def THEN RAISE EXCEPTION '② map anchor not found'; END IF;
  EXECUTE patched;
END $$;

-- ③ enqueue_admin_worker_chat_message: 시드/서비스롤 삽입은 무음
DO $$
DECLARE def text; patched text;
BEGIN
  SELECT pg_get_functiondef('public.enqueue_admin_worker_chat_message()'::regprocedure) INTO def;
  IF def LIKE '%auth.uid() IS NULL%' THEN RAISE NOTICE '③ already patched'; RETURN; END IF;
  patched := replace(def,
    'IF NEW.sender_type<>''worker'' THEN RETURN NEW; END IF;',
    'IF NEW.sender_type<>''worker'' THEN RETURN NEW; END IF;
  -- 크론 시드·서비스롤 배치는 실사용자 액션이 아니므로 알림 없음
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;');
  IF patched = def THEN RAISE EXCEPTION '③ chat trigger anchor not found'; END IF;
  EXECUTE patched;
END $$;

-- ④ confirm_application_credential: 이미 확인된 지원은 no-op (멱등)
DO $$
DECLARE def text; patched text;
BEGIN
  SELECT pg_get_functiondef('public.confirm_application_credential(uuid)'::regprocedure) INTO def;
  IF def LIKE '%already confirmed - noop%' THEN RAISE NOTICE '④ already patched'; RETURN; END IF;
  patched := replace(def,
    'IF NOT FOUND OR v_app.status <> ''applied'' THEN
    RAISE EXCEPTION ''확인할 수 없는 지원이에요'';
  END IF;',
    'IF NOT FOUND OR v_app.status <> ''applied'' THEN
    RAISE EXCEPTION ''확인할 수 없는 지원이에요'';
  END IF;
  -- already confirmed - noop: 감사로그 중복·확인자 덮어쓰기 방지
  IF v_app.credential_review_status IN (''facility_confirmed'', ''platform_verified'') THEN
    RETURN true;
  END IF;');
  IF patched = def THEN RAISE EXCEPTION '④ confirm anchor not found'; END IF;
  EXECUTE patched;
END $$;

-- ⑤-a record_payment_reconciliation: reconcile_required 시 관리자 푸시
DO $$
DECLARE def text; patched text;
BEGIN
  SELECT pg_get_functiondef('public.record_payment_reconciliation(text,text,jsonb,text,text)'::regprocedure) INTO def;
  IF def LIKE '%payment.reconciliation:%' THEN RAISE NOTICE '⑤a already patched'; RETURN; END IF;
  patched := replace(def,
    '  INSERT INTO public.audit_logs (
    actor_type, actor_id, action, entity_type, entity_id, after_data
  ) VALUES (
    ''system'', v_order.requested_by, ''payment.reconciliation''',
    '  IF v_next_status = ''reconcile_required'' THEN
    INSERT INTO public.notification_outbox (worker_auth_user_id, event_type, dedupe_key, title, body, data)
    SELECT r.uid, ''payment.reconciliation'',
           ''payment.reconciliation:'' || v_order.id::text || '':'' || r.uid::text,
           ''결제 확인이 필요해요'',
           ''결제 상태가 변경되어 확인이 필요합니다. 요금·청구 화면에서 확인해 주세요.'',
           jsonb_build_object(''url'', ''/membership'', ''orderId'', v_order.order_id)
    FROM (
      SELECT f.admin_user_id AS uid FROM public.facilities f
      WHERE f.id = v_order.facility_id AND f.admin_user_id IS NOT NULL
      UNION
      SELECT fa.user_id FROM public.facility_admin_access fa
      WHERE fa.facility_id = v_order.facility_id AND fa.access_role IN (''operator'', ''super'')
    ) r
    ON CONFLICT (dedupe_key) DO NOTHING;
  END IF;

  INSERT INTO public.audit_logs (
    actor_type, actor_id, action, entity_type, entity_id, after_data
  ) VALUES (
    ''system'', v_order.requested_by, ''payment.reconciliation''');
  IF patched = def THEN RAISE EXCEPTION '⑤a reconciliation anchor not found'; END IF;
  EXECUTE patched;
END $$;

-- ⑤-b shift.checkout 딥링크: 알림 탭 시 /earnings로
DO $$
DECLARE fn regprocedure; def text; patched text;
BEGIN
  -- checkout 인큐는 정산 RPC 안에 있다 — 이벤트 문자열로 소유 함수를 찾는다
  SELECT p.oid::regprocedure INTO fn
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.prokind = 'f'  -- 집계·윈도우 함수는 pg_get_functiondef가 에러를 낸다
    AND pg_get_functiondef(p.oid) LIKE '%''shift.checkout''%'
  LIMIT 1;
  IF fn IS NULL THEN RAISE EXCEPTION '⑤b checkout enqueue function not found'; END IF;
  SELECT pg_get_functiondef(fn) INTO def;
  IF def LIKE '%''url'',''/earnings''%' THEN RAISE NOTICE '⑤b already patched'; RETURN; END IF;
  patched := replace(def,
    'jsonb_build_object(''type'',''checkout''',
    'jsonb_build_object(''url'',''/earnings'',''type'',''checkout''');
  IF patched = def THEN RAISE EXCEPTION '⑤b checkout data anchor not found'; END IF;
  EXECUTE patched;
END $$;

-- 검증 (6개 모두 true면 성공)
SELECT
  strpos(pg_get_functiondef('public.get_shift_notification_recipients(uuid)'::regprocedure), 'is_demo') > 0 AS demo_isolated,
  strpos(pg_get_functiondef('public.get_shift_map_points_secure(uuid[])'::regprocedure), '''rn'', ''na'', ''pharmacist''') > 0 AS map_progressive,
  strpos(pg_get_functiondef('public.enqueue_admin_worker_chat_message()'::regprocedure), 'auth.uid() IS NULL') > 0 AS chat_seed_muted,
  strpos(pg_get_functiondef('public.confirm_application_credential(uuid)'::regprocedure), 'already confirmed - noop') > 0 AS confirm_idempotent,
  strpos(pg_get_functiondef('public.record_payment_reconciliation(text,text,jsonb,text,text)'::regprocedure), 'payment.reconciliation:') > 0 AS reconciliation_push,
  EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind = 'f'
      AND pg_get_functiondef(p.oid) LIKE '%''url'',''/earnings''%'
  ) AS checkout_deeplink;
