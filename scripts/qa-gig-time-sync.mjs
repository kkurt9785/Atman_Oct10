// 근무 건 시간 ↔ 근무자 기본 시간 맞추기 판단(planStaffTimeSync) 순수 함수 점검. DB 접속 없음.
// 실행: node scripts/qa-gig-time-sync.mjs   (Node 22.6+ 타입 제거로 .ts 를 바로 읽는다)
import assert from 'node:assert/strict';
import { planStaffTimeSync, timeSyncNotice } from '../apps/admin-web/lib/gig-time-sync.ts';

const T = (start, end) => ({ start_time: start, end_time: end });
const S = (id, name, start, end) => ({ id, name, default_start_time: start, default_end_time: end });
let n = 0; const ok = (label) => { n += 1; console.log(`PASS ${label}`); };

// 1) 시간 수정: 예전 시간 그대로 쓰던 사람은 새 시간으로, DB 의 HH:MM:SS 형식도 같게 본다
let r = planStaffTimeSync({ staff: [S('a', '김하늘', '10:00:00', '19:00:00'), S('b', '박구름', '10:00:00', '19:00:00')], others: [], activeOtherProjects: [], times: T('14:00', '22:00'), previous: T('10:00:00', '19:00:00') });
assert.deepEqual(r, { ids: ['a', 'b'], otherProject: [], custom: [] }); ok('시간 수정 → 예전 시간 쓰던 2명 모두 맞춤');

// 2) 시간 수정: 따로 정한 시간(18~22 마감조)은 지킨다
r = planStaffTimeSync({ staff: [S('a', '김하늘', '10:00', '19:00'), S('c', '이마감', '18:00', '22:00')], others: [], activeOtherProjects: [], times: T('14:00', '22:00'), previous: T('10:00', '19:00') });
assert.deepEqual(r, { ids: ['a'], otherProject: [], custom: ['이마감'] }); ok('따로 정한 시간은 그대로 + 안내 대상');

// 3) 시간이 다른 진행 중 근무 건이 또 있으면 건드리지 않는다
r = planStaffTimeSync({ staff: [S('a', '김하늘', '10:00', '19:00')], others: [{ staff_id: 'a', project_id: 'p2' }], activeOtherProjects: [{ id: 'p2', start_time: '10:00:00', end_time: '19:00:00' }], times: T('14:00', '22:00'), previous: T('10:00', '19:00') });
assert.deepEqual(r, { ids: [], otherProject: ['김하늘'], custom: [] }); ok('시간 다른 진행 중 근무 → 그대로 + 안내');

// 4) 다른 근무 건이 끝났거나 취소됐으면(activeOtherProjects 에 없음) 맞춘다
r = planStaffTimeSync({ staff: [S('a', '김하늘', '10:00', '19:00')], others: [{ staff_id: 'a', project_id: 'old' }], activeOtherProjects: [], times: T('18:00', '23:00') });
assert.deepEqual(r.ids, ['a']); ok('끝난 근무 건은 무시하고 새 근무 시간으로 맞춤(근무에 넣기)');

// 5) 다른 진행 중 근무 건과 시간이 같으면 맞춘다
r = planStaffTimeSync({ staff: [S('a', '김하늘', '10:00', '19:00')], others: [{ staff_id: 'a', project_id: 'p2' }], activeOtherProjects: [{ id: 'p2', start_time: '18:00:00', end_time: '23:00:00' }], times: T('18:00', '23:00') });
assert.deepEqual(r.ids, ['a']); ok('같은 시간대 다른 근무는 충돌 아님');

// 6) 근무에 넣기(previous 없음): 기본 시간이 달라도 맞춘다(오전조 → 저녁 행사)
r = planStaffTimeSync({ staff: [S('a', '김하늘', '09:00', '13:00')], others: [], activeOtherProjects: [], times: T('18:00', '23:00') });
assert.deepEqual(r, { ids: ['a'], otherProject: [], custom: [] }); ok('근무에 넣기 → 새 근무 시간으로');

// 7) 휴게만 바뀐 수정도 대상에 넣는다(시간 같아도 ids 에 포함)
r = planStaffTimeSync({ staff: [S('a', '김하늘', '10:00', '19:00')], others: [], activeOtherProjects: [], times: T('10:00', '19:00'), previous: T('10:00', '19:00') });
assert.deepEqual(r.ids, ['a']); ok('휴게만 바뀐 수정도 갱신 대상');

// 8) 안내 문구: 없으면 undefined, 4명 넘으면 '외 N명'
assert.equal(timeSyncNotice({ otherProject: [], custom: [] }, '14:00', '22:00'), undefined);
const note = timeSyncNotice({ otherProject: ['가', '나', '다', '라'], custom: ['마'] }, '14:00:00', '22:00:00');
assert.match(note, /가, 나, 다 외 1명님은 시간이 다른 근무에도/); assert.match(note, /마님은 따로 정한/); assert.match(note, /14:00~22:00에 출근하려면/);
ok('안내 문구(없음·외 N명·시간 표기)');

console.log(`\nALL PASS (${n})`);
