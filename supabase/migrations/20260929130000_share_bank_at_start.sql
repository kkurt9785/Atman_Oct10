-- 지급 계좌 전달 시점을 "근무 완료 후"에서 "근무 시작(초대 수락) 때"로.
-- 워커 입장에선 시작할 때 이미 전달돼 있는 게 안심이고, 관리자는 지급 준비를 미리 한다.
-- 전달 자체는 여전히 워커가 RPC 를 불러야 일어난다(초대 수락 화면에 명시하고 호출). 관리자 열람 권한·긱 근무자 조건은 그대로.
DO $patch$
DECLARE
  fn regprocedure := 'public.share_my_gig_bank_account(uuid)'::regprocedure;
  def text := pg_get_functiondef('public.share_my_gig_bank_account(uuid)'::regprocedure);
  gate text := $g$  IF NOT EXISTS (
    SELECT 1 FROM public.staff_attendances a
    WHERE a.staff_id = v_staff.id
      AND a.facility_id = v_staff.facility_id
      AND a.status = 'completed'
      AND a.check_in_at IS NOT NULL
      AND a.check_out_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION '근무가 완료된 뒤 계좌를 전달할 수 있어요';
  END IF;
$g$;
  patched text;
BEGIN
  patched := replace(def, gate, '');
  IF patched = def THEN
    IF position('근무가 완료된 뒤' in def) = 0 THEN RAISE NOTICE '이미 완료 조건이 없습니다'; RETURN; END IF;
    RAISE EXCEPTION '계좌 전달 함수의 완료 조건 블록을 찾지 못했습니다';
  END IF;
  EXECUTE patched;
END
$patch$;

SELECT position('근무가 완료된 뒤' in pg_get_functiondef('public.share_my_gig_bank_account(uuid)'::regprocedure)) = 0 AS share_anytime_t;
