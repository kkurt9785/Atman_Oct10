import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const read = (path) => readFile(resolve(root, path), 'utf8');
const failures = [];

function expect(source, condition, name) {
  if (condition) console.log(`PASS ${name}`);
  else failures.push(name);
}

const [attendanceRpc, qrIssuer, workerPage, actionButton, staffActions, retirementMigration] = await Promise.all([
  read('supabase/migrations/20260916160000_early_leave_grace.sql'),
  read('supabase/migrations/20260908170000_qr_grace_and_window_copy.sql'),
  read('apps/worker-web/app/workplace/page.tsx'),
  read('apps/worker-web/components/attendance/AttendanceActionButton.tsx'),
  read('apps/admin-web/lib/actions/clinic-workforce.ts'),
  read('supabase/migrations/20260921113000_retire_legacy_static_attendance_qr.sql'),
]);

expect(qrIssuer, qrIssuer.includes("interval '5 minutes'") && qrIssuer.includes('token_hash'), '동적 QR은 원문 저장 없이 5분 만료된다');
expect(attendanceRpc, attendanceRpc.includes('expires_at>v_now') && attendanceRpc.includes('v_qr_other_facility'), '만료·타 사업장 QR을 구분해 차단한다');
expect(attendanceRpc, attendanceRpc.includes('v_distance<=v_setting.gps_radius_meters') && attendanceRpc.includes('v_accuracy<=v_setting.max_gps_accuracy_meters'), 'GPS 반경과 정확도를 함께 검증한다');
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
