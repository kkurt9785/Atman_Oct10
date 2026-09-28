-- 긱 여부의 축을 "사업장"에서 "근무자"로 옮긴다.
-- 병원·약국·요양병원은 사업장 유형이고, 고정 직원·단기(긱) 근무자는 고용 형태다. 한 사업장에 둘이 같이 있을 수 있다.
-- 지금까지 긱 기능(근무 건 동기화·비공개 워크룸·근태 알림·계좌 전달)은 facility_type='gigworker' 로만 열려
-- 병원이 '외부 단기근로자 초대'로 만든 근무자는 초대·출퇴근까지만 되고 지급·계좌·비공개 대화가 없었다.
--
-- facility_staff.worker_kind  'staff' | 'gig'
--   백필: 긱 사업장(facility_type='gigworker' 또는 registration_source='gigworker_trial') 소속만 'gig'.
--   병원의 기존 계약직·일용직은 '직원'이므로 그대로 'staff' 다 (연결된 워커의 셸이 바뀌면 안 된다).
--   이후 관리자 앱이 '단기근로자 초대'로 만드는 행은 'gig' 로 들어온다.

ALTER TABLE public.facility_staff
  ADD COLUMN IF NOT EXISTS worker_kind text NOT NULL DEFAULT 'staff'
  CHECK (worker_kind IN ('staff','gig'));
CREATE INDEX IF NOT EXISTS idx_facility_staff_kind ON public.facility_staff(facility_id, worker_kind);

UPDATE public.facility_staff fs SET worker_kind='gig'
FROM public.facilities f
WHERE f.id=fs.facility_id AND fs.worker_kind<>'gig'
  AND (f.facility_type='gigworker' OR f.registration_source='gigworker_trial');

-- 워커 앱이 자기 연결의 종류를 읽는다 (행 RLS 는 기존 facility_staff_worker_read 그대로)
GRANT SELECT (worker_kind) ON public.facility_staff TO authenticated;

-- ── 1) 출퇴근 NOT_SCHEDULED(계약기간·요일) 검증: 긱 근무자에게만 ─────────────
DO $scope$
DECLARE
  fn regprocedure := to_regprocedure('public.record_unified_attendance(text,uuid,text,double precision,double precision,double precision,text)');
  def text; patched text;
BEGIN
  IF fn IS NULL THEN RAISE EXCEPTION 'record_unified_attendance not found'; END IF;
  def := pg_get_functiondef(fn);
  patched := replace(def, $n$v_facility.registration_source = 'gigworker_trial' AND ($n$, $r$v_staff.worker_kind = 'gig' AND ($r$);
  IF patched = def THEN
    IF position($c$v_staff.worker_kind = 'gig' AND ($c$ in def) > 0 THEN RAISE NOTICE 'NOT_SCHEDULED 이미 근무자 기준'; RETURN; END IF;
    RAISE EXCEPTION 'NOT_SCHEDULED 게이트 지점을 찾지 못했습니다';
  END IF;
  EXECUTE patched;
END
$scope$;

-- ── 2) 초대 미리보기: 어느 셸에서 수락할지는 근무자 종류가 정한다 ────────────
CREATE OR REPLACE FUNCTION public.get_facility_staff_invite_preview(p_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_invite public.facility_staff_invites%ROWTYPE;
  v_staff public.facility_staff%ROWTYPE;
  v_facility public.facilities%ROWTYPE;
  v_signed_in boolean := auth.uid() IS NOT NULL;
BEGIN
  SELECT * INTO v_invite FROM public.facility_staff_invites WHERE token=p_token;
  IF NOT FOUND OR v_invite.status IN ('cancelled','accepted') THEN
    RETURN jsonb_build_object('ok',false,'reason','INVALID','message','유효하지 않거나 이미 사용한 초대예요.');
  END IF;
  IF v_invite.status='expired' OR v_invite.expires_at<=now() THEN
    RETURN jsonb_build_object('ok',false,'reason','EXPIRED','message','초대가 만료됐어요. 관리자에게 새 링크를 요청해 주세요.');
  END IF;
  SELECT * INTO v_staff FROM public.facility_staff
  WHERE id=v_invite.staff_id AND facility_id=v_invite.facility_id AND status<>'ended';
  SELECT * INTO v_facility FROM public.facilities
  WHERE id=v_invite.facility_id AND is_active=true AND deleted_at IS NULL;
  IF v_staff.id IS NULL OR v_facility.id IS NULL THEN
    RETURN jsonb_build_object('ok',false,'reason','INVALID','message','연결할 근무 정보를 찾지 못했어요.');
  END IF;
  RETURN jsonb_build_object(
    'ok',true,'isGigworker',v_staff.worker_kind='gig',
    'facilityName',v_facility.name,'facilityAddress',v_facility.address_text,
    'workerName',v_staff.name,'role',v_staff.role,'workDescription',v_staff.department,
    'contractStart',v_staff.contract_start,'contractEnd',v_staff.contract_end,
    'workWeekdays',v_staff.work_weekdays,'startTime',v_staff.default_start_time,
    'endTime',v_staff.default_end_time,'breakMinutes',v_staff.default_break_minutes,
    'payBasis',CASE WHEN v_signed_in THEN v_staff.pay_basis END,
    'payRate',CASE WHEN v_signed_in THEN v_staff.pay_rate END,
    'payHidden',(NOT v_signed_in) AND v_staff.pay_rate IS NOT NULL,
    'phoneLast4',CASE WHEN v_invite.phone_normalized IS NOT NULL THEN right(v_invite.phone_normalized,4) END,
    'phoneRequired',false,'expiresAt',v_invite.expires_at
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_facility_staff_invite_preview(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_facility_staff_invite_preview(uuid) TO anon, authenticated;

-- ── 3) 계좌 전달: 긱 근무자면 사업장 종류와 무관 ──────────────────────────────
CREATE OR REPLACE FUNCTION public.share_my_gig_bank_account(p_staff_id uuid)
RETURNS TABLE (
  staff_id uuid,
  bank_account_id uuid,
  bank_name text,
  account_last4 text,
  shared_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_worker_id uuid := public.current_worker_id();
  v_staff public.facility_staff%ROWTYPE;
  v_bank public.worker_bank_accounts%ROWTYPE;
  v_share public.gig_bank_account_shares%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR v_worker_id IS NULL THEN
    RAISE EXCEPTION '로그인이 필요해요';
  END IF;

  SELECT fs.* INTO v_staff
  FROM public.facility_staff fs
  JOIN public.facilities f ON f.id = fs.facility_id
  WHERE fs.id = p_staff_id
    AND fs.worker_id = v_worker_id
    AND f.is_active = true
    AND f.deleted_at IS NULL
    AND fs.worker_kind = 'gig';
  IF NOT FOUND THEN
    RAISE EXCEPTION '연결된 긱 근무를 찾을 수 없어요';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.staff_attendances a
    WHERE a.staff_id = v_staff.id
      AND a.facility_id = v_staff.facility_id
      AND a.status = 'completed'
      AND a.check_in_at IS NOT NULL
      AND a.check_out_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION '근무가 완료된 뒤 계좌를 전달할 수 있어요';
  END IF;

  SELECT b.* INTO v_bank
  FROM public.worker_bank_accounts b
  WHERE b.worker_id = v_worker_id
    AND b.is_primary = true
    AND b.deleted_at IS NULL
  ORDER BY b.created_at DESC
  LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION '먼저 지급 계좌를 등록해 주세요';
  END IF;

  INSERT INTO public.gig_bank_account_shares(
    facility_id, staff_id, worker_id, bank_account_id, shared_at, updated_at
  ) VALUES (
    v_staff.facility_id, v_staff.id, v_worker_id, v_bank.id, now(), now()
  )
  ON CONFLICT ON CONSTRAINT gig_bank_account_shares_staff_id_key DO UPDATE SET
    facility_id = EXCLUDED.facility_id,
    worker_id = EXCLUDED.worker_id,
    bank_account_id = EXCLUDED.bank_account_id,
    shared_at = now(),
    updated_at = now()
  RETURNING * INTO v_share;

  RETURN QUERY SELECT
    v_share.staff_id,
    v_share.bank_account_id,
    v_bank.bank_name,
    v_bank.account_number_last4,
    v_share.shared_at;
END;
$$;
REVOKE ALL ON FUNCTION public.share_my_gig_bank_account(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.share_my_gig_bank_account(uuid) TO authenticated;

-- ── 4) gig_assignments 검증·동기화: 근무자 기준. worker_kind 가 바뀌어도 따라간다 ──
CREATE OR REPLACE FUNCTION public.validate_gig_assignment_staff()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
BEGIN
  IF NOT EXISTS(
    SELECT 1 FROM public.facility_staff fs
    WHERE fs.id=NEW.staff_id AND fs.facility_id=NEW.facility_id AND fs.worker_kind='gig'
  ) THEN RAISE EXCEPTION '긱 근무자가 아니거나 근무지가 일치하지 않아요'; END IF;
  RETURN NEW;
END;
$$;
CREATE OR REPLACE FUNCTION public.sync_staff_compat_gig_assignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=''
AS $$
DECLARE
  v_is_gig boolean;
  v_start date;
  v_end date;
BEGIN
  v_is_gig := NEW.worker_kind='gig';
  IF NOT v_is_gig THEN RETURN NEW; END IF;
  v_start:=COALESCE(NEW.contract_start,(timezone('Asia/Seoul',NEW.created_at))::date,(timezone('Asia/Seoul',now()))::date);
  v_end:=COALESCE(NEW.contract_end,v_start+365);

  UPDATE public.gig_assignments SET
    title=COALESCE(NULLIF(NEW.department,''),'단기 근무'),starts_on=v_start,ends_on=v_end,
    work_weekdays=COALESCE(NEW.work_weekdays,ARRAY[1,2,3,4,5]::smallint[]),
    start_time=NEW.default_start_time,end_time=NEW.default_end_time,
    break_minutes=NEW.default_break_minutes,pay_basis=NEW.pay_basis,pay_rate=NEW.pay_rate,
    status=CASE WHEN NEW.status='ended' THEN 'completed' ELSE 'active' END,updated_at=now()
  WHERE id=(SELECT ga.id FROM public.gig_assignments ga
    WHERE ga.staff_id=NEW.id AND ga.source='staff_compat'
    ORDER BY ga.created_at DESC LIMIT 1);

  IF NOT FOUND THEN
    INSERT INTO public.gig_assignments(
      facility_id,staff_id,title,starts_on,ends_on,work_weekdays,start_time,end_time,
      break_minutes,pay_basis,pay_rate,status,source,created_by
    ) VALUES(
      NEW.facility_id,NEW.id,COALESCE(NULLIF(NEW.department,''),'단기 근무'),v_start,v_end,
      COALESCE(NEW.work_weekdays,ARRAY[1,2,3,4,5]::smallint[]),NEW.default_start_time,NEW.default_end_time,
      NEW.default_break_minutes,NEW.pay_basis,NEW.pay_rate,
      CASE WHEN NEW.status='ended' THEN 'completed' ELSE 'active' END,'staff_compat',NEW.created_by
    );
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_sync_staff_compat_gig_assignment ON public.facility_staff;
CREATE TRIGGER trg_sync_staff_compat_gig_assignment
AFTER INSERT OR UPDATE OF worker_kind,department,contract_start,contract_end,work_weekdays,
  default_start_time,default_end_time,default_break_minutes,pay_basis,pay_rate,status
ON public.facility_staff FOR EACH ROW EXECUTE FUNCTION public.sync_staff_compat_gig_assignment();
REVOKE ALL ON FUNCTION public.validate_gig_assignment_staff() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.sync_staff_compat_gig_assignment() FROM PUBLIC,anon,authenticated;

-- 병원 안의 긱 근무자에게도 호환 근무 건을 만들어 둔다 (백필로 gig 가 된 행 포함)
INSERT INTO public.gig_assignments(
  facility_id,staff_id,title,starts_on,ends_on,work_weekdays,start_time,end_time,
  break_minutes,pay_basis,pay_rate,status,source,created_by,created_at,updated_at
)
SELECT fs.facility_id,fs.id,COALESCE(NULLIF(fs.department,''),'단기 근무'),
  COALESCE(fs.contract_start,(timezone('Asia/Seoul',fs.created_at))::date),
  COALESCE(fs.contract_end,(timezone('Asia/Seoul',now()))::date+365),
  COALESCE(fs.work_weekdays,ARRAY[1,2,3,4,5]::smallint[]),
  fs.default_start_time,fs.default_end_time,fs.default_break_minutes,
  fs.pay_basis,fs.pay_rate,CASE WHEN fs.status='ended' THEN 'completed' ELSE 'active' END,
  'staff_compat',fs.created_by,fs.created_at,fs.updated_at
FROM public.facility_staff fs
WHERE fs.worker_kind='gig' AND NOT EXISTS (SELECT 1 FROM public.gig_assignments ga WHERE ga.staff_id=fs.id);

-- ── 5) 근태 → 워크룸 시스템 메시지: 긱 근무자만 ──────────────────────────────
CREATE OR REPLACE FUNCTION public.publish_staff_attendance_to_workroom()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE v_name text;v_body text;v_event text;
BEGIN
  SELECT name INTO v_name FROM public.facility_staff WHERE id=NEW.staff_id AND worker_kind='gig';
  IF v_name IS NULL THEN RETURN NEW; END IF;
  IF NEW.check_out_at IS NOT NULL AND (TG_OP='INSERT' OR OLD.check_out_at IS NULL) THEN v_event:='checkout';v_body:=v_name||'님이 '||to_char(NEW.check_out_at AT TIME ZONE 'Asia/Seoul','HH24:MI')||'에 퇴근했어요.';
  ELSIF NEW.checkout_requested_at IS NOT NULL AND NEW.check_out_at IS NULL AND (TG_OP='INSERT' OR OLD.checkout_requested_at IS NULL) THEN v_event:='checkout_request';v_body:=v_name||'님이 조기 퇴근 확인을 요청했어요.';
  ELSIF NEW.check_in_at IS NOT NULL AND (TG_OP='INSERT' OR OLD.check_in_at IS NULL) THEN v_event:='checkin';v_body:=v_name||'님이 '||to_char(NEW.check_in_at AT TIME ZONE 'Asia/Seoul','HH24:MI')||CASE WHEN NEW.status='late' THEN '에 지각 출근했어요.' ELSE '에 출근했어요.' END;
  ELSIF NEW.status='absent' AND (TG_OP='INSERT' OR OLD.status IS DISTINCT FROM 'absent') THEN v_event:='absent';v_body:=v_name||'님이 결근으로 처리됐어요.';
  ELSE RETURN NEW; END IF;
  INSERT INTO public.facility_workroom_messages(facility_id,staff_id,sender_type,sender_name,message_type,body,event_key,metadata)
  VALUES(NEW.facility_id,NEW.staff_id,'system','근태 알림','attendance',v_body,'attendance:'||NEW.id::text||':'||v_event,
    jsonb_build_object('attendanceId',NEW.id,'staffId',NEW.staff_id,'workDate',NEW.work_date,'event',v_event))
  ON CONFLICT(event_key) WHERE event_key IS NOT NULL DO NOTHING;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.publish_staff_attendance_to_workroom() FROM PUBLIC,anon,authenticated;

-- ── 6) 워크룸 전체방 글쓰기 금지: '긱 근무자로만' 연결된 워커 ────────────────
CREATE OR REPLACE FUNCTION public.enforce_workroom_message_scope()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE v_is_gig boolean;
BEGIN
  IF NEW.staff_id IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM public.facility_staff fs
    WHERE fs.id=NEW.staff_id AND fs.facility_id=NEW.facility_id
  ) THEN RAISE EXCEPTION '대화 근무자와 근무지가 일치하지 않아요'; END IF;

  IF NEW.sender_type='worker' AND NEW.staff_id IS NULL THEN
    -- 같은 근무지에 긱 근무자로만 연결된 워커는 전체방에 쓸 수 없다 (직원 겸직이면 허용)
    SELECT bool_and(fs.worker_kind='gig') INTO v_is_gig
    FROM public.facility_staff fs
    WHERE fs.facility_id=NEW.facility_id AND fs.worker_id=public.current_worker_id() AND fs.status<>'ended';
    IF COALESCE(v_is_gig,false) THEN
      RAISE EXCEPTION '긱워커 메시지는 관리자와의 비공개 대화에만 보낼 수 있어요';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.enforce_workroom_message_scope() FROM PUBLIC,anon,authenticated;

-- ── 7) 워커 워크룸 목록에 worker_kind 노출 (반환 타입 변경) ─────────────────
DROP FUNCTION IF EXISTS public.get_my_workrooms_v2();
CREATE OR REPLACE FUNCTION public.get_my_workrooms_v2()
RETURNS TABLE(facility_id uuid,facility_name text,address_text text,registration_source text,staff_id uuid,worker_kind text,member_count integer,unread_count bigint,last_message_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $$
  WITH rooms AS (
    SELECT f.id,f.name,f.address_text,f.registration_source,fs.id staff_id,fs.worker_kind
    FROM public.facility_staff fs JOIN public.facilities f ON f.id=fs.facility_id
    WHERE fs.worker_id=public.current_worker_id() AND fs.status<>'ended' AND f.is_active=true AND f.deleted_at IS NULL
  )
  SELECT r.id,r.name,r.address_text,r.registration_source,r.staff_id,r.worker_kind,
    (SELECT count(*)::integer FROM public.facility_staff fs WHERE fs.facility_id=r.id AND fs.status<>'ended' AND fs.worker_id IS NOT NULL),
    (SELECT count(*) FROM public.facility_workroom_messages m
      WHERE m.facility_id=r.id AND (m.staff_id IS NULL OR m.staff_id=r.staff_id)
        AND m.sender_user_id IS DISTINCT FROM auth.uid()
        AND m.created_at>CASE WHEN m.staff_id IS NULL THEN COALESCE((SELECT rd.last_read_at FROM public.facility_workroom_reads rd WHERE rd.facility_id=r.id AND rd.user_id=auth.uid()),'-infinity'::timestamptz)
          ELSE COALESCE((SELECT tr.last_read_at FROM public.facility_workroom_thread_reads tr WHERE tr.facility_id=r.id AND tr.staff_id=r.staff_id AND tr.user_id=auth.uid()),'-infinity'::timestamptz) END),
    (SELECT max(m.created_at) FROM public.facility_workroom_messages m WHERE m.facility_id=r.id AND (m.staff_id IS NULL OR m.staff_id=r.staff_id))
  FROM rooms r ORDER BY 9 DESC NULLS LAST,r.name;
$$;
REVOKE ALL ON FUNCTION public.get_my_workrooms_v2() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_my_workrooms_v2() TO authenticated;

-- ── 검증 ─────────────────────────────────────────────────────────────────────
SELECT
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='facility_staff' AND column_name='worker_kind') AS worker_kind_col_t,
  position($c$v_staff.worker_kind = 'gig' AND ($c$ in pg_get_functiondef('public.record_unified_attendance(text,uuid,text,double precision,double precision,double precision,text)'::regprocedure)) > 0 AS not_scheduled_by_kind_t,
  position($c$v_staff.worker_kind='gig'$c$ in pg_get_functiondef('public.get_facility_staff_invite_preview(uuid)'::regprocedure)) > 0 AS preview_by_kind_t,
  position('worker_kind' in pg_get_functiondef('public.share_my_gig_bank_account(uuid)'::regprocedure)) > 0 AS share_by_kind_t,
  position('worker_kind' in pg_get_functiondef('public.enforce_workroom_message_scope()'::regprocedure)) > 0 AS scope_by_kind_t,
  position('worker_kind' in pg_get_functiondef('public.get_my_workrooms_v2()'::regprocedure)) > 0 AS rooms_expose_kind_t,
  (SELECT count(*) FROM public.facility_staff WHERE worker_kind='gig') AS gig_rows,
  (SELECT count(*) FROM public.facility_staff fs WHERE fs.worker_kind='gig' AND NOT EXISTS(SELECT 1 FROM public.gig_assignments ga WHERE ga.staff_id=fs.id)) AS gig_without_assignment_0;
