-- 같은 근무자·같은 기간을 두 번 지급 기록하지 못하게 한다.
-- 클라이언트의 pending 상태만으로는 두 탭·두 관리자·네트워크 재시도를 막을 수 없으므로
-- 최종 방어선은 DB의 부분 유니크 인덱스가 맡는다. 취소한 기록은 다시 생성할 수 있다.
DO $check$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.gig_payouts
    WHERE status <> 'cancelled'
    GROUP BY staff_id, period_start, period_end
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION '중복된 활성 긱워커 지급 기간이 있어 인덱스를 만들 수 없습니다';
  END IF;
END
$check$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_gig_payouts_active_staff_period
  ON public.gig_payouts(staff_id, period_start, period_end)
  WHERE status <> 'cancelled';

COMMENT ON INDEX public.uq_gig_payouts_active_staff_period IS
  '동일 근무자·동일 기간의 지급 예정/완료 중복 생성 방지. cancelled는 재생성 허용.';
