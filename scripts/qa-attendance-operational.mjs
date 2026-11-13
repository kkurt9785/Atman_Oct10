import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const read = (path) => readFile(resolve(root, path), 'utf8');
const failures = [];

function expect(source, condition, name) {
  if (condition) console.log(`PASS ${name}`);
  else failures.push(name);
}

const [attendanceRpc, qrIssuer, workerPage, actionButton, staffActions, retirementMigration, rulesMigration, payrollMigration] = await Promise.all([
  read('supabase/migrations/20260916160000_early_leave_grace.sql'),
  read('supabase/migrations/20260908170000_qr_grace_and_window_copy.sql'),
  read('apps/worker-web/app/workplace/page.tsx'),
  read('apps/worker-web/components/attendance/AttendanceActionButton.tsx'),
  read('apps/admin-web/lib/actions/clinic-workforce.ts'),
  read('supabase/migrations/20260921113000_retire_legacy_static_attendance_qr.sql'),
  // 20261113: GPS 판정식은 이 파일이 런타임 패치로 바꾼다 — 0916 본문만 보면 옛 식을 검사하게 된다
  read('supabase/migrations/20261113100000_attendance_missing_checkout_and_gps_rules.sql'),
  read('supabase/migrations/20261113110000_attendance_ip_shift_correction_payroll.sql'),
]);

expect(qrIssuer, qrIssuer.includes("interval '5 minutes'") && qrIssuer.includes('token_hash'), '동적 QR은 원문 저장 없이 5분 만료된다');
expect(attendanceRpc, attendanceRpc.includes('expires_at>v_now') && attendanceRpc.includes('v_qr_other_facility'), '만료·타 사업장 QR을 구분해 차단한다');
expect(attendanceRpc, attendanceRpc.includes('v_distance<=v_setting.gps_radius_meters') && attendanceRpc.includes('v_accuracy<=v_setting.max_gps_accuracy_meters'), 'GPS 반경과 정확도를 함께 검증한다');
expect(rulesMigration, rulesMigration.includes('v_gps_valid:=v_distance-LEAST(COALESCE(v_accuracy,0),v_setting.gps_radius_meters,100)<=v_setting.gps_radius_meters') && rulesMigration.includes("position('v_accuracy<=v_setting.max_gps_accuracy_meters' in def) = 0"), 'GPS 오차는 반경·100m 중 작은 값까지만 빼고(최대 반경 2배), 정확도 상한 검사는 유지한다(D3)');
expect(rulesMigration, rulesMigration.includes("'RATE_LIMITED'") && rulesMigration.includes("user_id=auth.uid() AND created_at>v_now-interval '1 minute')>=10"), '계정(기기)당 1분 10회 요청 제한, IP 기준 아님(D4)');
expect(rulesMigration, rulesMigration.includes("cron.schedule('attendance-missing-checkout-hourly'") && rulesMigration.includes('a.checkout_requested_at IS NULL') && rulesMigration.includes('check_out_after_minutes'), '퇴근 가능 시간이 지난 미퇴근을 매시간 표시한다(D1)');
expect(payrollMigration, payrollMigration.includes("v_headers->>'cf-connecting-ip'") && payrollMigration.includes('v_parts[array_length(v_parts, 1)]') && payrollMigration.includes("position('x-forwarded-for' in def) > 0 THEN RAISE"), '네트워크 인증 IP 는 꾸밀 수 없는 값만 쓴다(D6)');
expect(payrollMigration, payrollMigration.includes('FUNCTION public.correct_shift_attendance') && payrollMigration.includes("status IN ('draft', 'disputed')") && payrollMigration.includes("'attendance.shift_correct'"), '공고 근무 정정은 사유·이력·임금 재계산, 승인·지급 건은 그대로(D7)');
expect(payrollMigration, payrollMigration.includes('trg_fill_wage_instruction_bank') && !/IF v_bank_id IS NOT NULL THEN\s+INSERT INTO public\.wage_payment_instructions/.test(payrollMigration), '계좌 없이도 지급 지시를 만들고 계좌 등록 때 채운다(D8)');
expect(attendanceRpc, attendanceRpc.includes("v_failure:='TIME_NOT_ALLOWED'"), '출·퇴근 허용 시간창 밖 요청을 차단한다');
expect(attendanceRpc, attendanceRpc.includes('late_grace_minutes') && attendanceRpc.includes('early_leave_grace_minutes') && attendanceRpc.includes('v_early_grace'), '시설별 지각·조퇴 유예를 모두 적용한다');
expect(attendanceRpc, attendanceRpc.includes("v_failure:='DUPLICATE_ATTENDANCE'") && attendanceRpc.includes("status='checkout_pending'"), '중복 기록과 조기 퇴근 승인 대기를 구분한다');
expect(actionButton, actionButton.includes("supabase.rpc('record_unified_attendance'") && !actionButton.includes('record_staff_qr_attendance'), '워커 버튼은 통합 근태 RPC만 호출한다');
expect(workerPage, !workerPage.includes("supabase.rpc('record_staff_qr_attendance'") && workerPage.includes('이전 정적 QR은 운영 종료'), '정적 QR 링크는 자동 기록하지 않고 동적 QR로 안내한다');
expect(staffActions, staffActions.includes('decideEarlyCheckoutAction') && staffActions.includes('decideShiftEarlyCheckoutAction'), '직원·단기근로자 조기 퇴근 모두 승인/반려 경로가 있다');
expect(retirementMigration, retirementMigration.includes('REVOKE ALL ON FUNCTION public.record_staff_qr_attendance') && retirementMigration.includes('has_function_privilege'), 'DB에서도 정적 QR RPC 실행 권한을 회수한다');

if (failures.length) {
  console.error(`\nFAIL ${failures.length}건: ${failures.join(', ')}`);
  process.exit(1);
}

console.log('\n근태 운영 QA 정적 시나리오 통과');
