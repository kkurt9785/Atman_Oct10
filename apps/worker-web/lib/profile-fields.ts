import { WORKER_ROLE_LABEL, type WorkerRole } from './roles';

// 내 프로필 카드(/settings/profile)의 직군별 칸 — 제목·안내·선택 칩·입력 예시.
// 예전에는 약사·약국 사무만 따로 있고 나머지는 전부 간호 기준이라, 초대로 들어온 치과 직원(직군 'other')에게
// '면허증 *'(필수 표시)과 '일반병동·중환자실·응급실' 칩, '○○병원 중환자실' 예시가 보였다(2026-11-10 치과 QA P1-15).
// 프로필 저장은 어떤 직군에도 면허를 강제하지 않는다(자격 확인은 사업장이 한다) — 여기 required 는 '완성' 표시에만 쓴다.
export type CredentialSection = {
  // 'resume' 는 약국 전산·사무직의 이력서 — 파일만 받는다(번호 입력 없음)
  kind: 'license' | 'resume';
  title: string;
  hint: string | null;
  uploadLabel: string;
  previewAlt: string;
  // 번호 입력 칸의 예시. null 이면 번호 입력 탭을 숨긴다
  numberPlaceholder: string | null;
  // 내 정보의 '프로필 n/4 완료'에 이 칸을 세는지
  required: boolean;
};

export type ProfileFields = {
  credential: CredentialSection;
  workplacePlaceholder: string;
  departmentTitle: string;
  departmentHint: string;
  departmentTags: readonly string[];
};

const WARD_TAGS = ['일반병동', '중환자실', '응급실', '수술실', '외래', '소아과', '정신과', '신생아실', '요양원', '요양병원', '재활병원', '의원·클리닉'] as const;
const PHARMACIST_TAGS = ['조제실', '대체약사', '병원약국', '문전약국', '주말근무', '야간약국'] as const;
const PHARMACY_STAFF_TAGS = ['전산·접수', '서류관리', '재고관리', '매대관리', '고객 안내', '사무보조'] as const;
const CARE_TAGS = ['요양원', '요양병원', '주야간보호', '방문요양', '재활병원', '병원 간병'] as const;
const DENTAL_TAGS = ['진료실', '데스크·접수', '상담', '예방·스케일링', '소독·기구 관리', '교정', '임플란트·수술 보조', '방사선 촬영'] as const;
// 직군을 모르는 사람(초대 간편 가입 'other')에게는 병동도 약국도 아닌, 의원 어디에나 있는 자리만 보여 준다
const NEUTRAL_TAGS = ['진료실', '데스크·접수', '상담', '행정·사무', '소독·기구 관리', '시설·환경', '조리·영양', '기타'] as const;

const OPTIONAL_HINT = '미리 등록하면 사업장 확인이 빨라져요. 등록하지 않아도 지원할 수 있어요.';

const NURSING: ProfileFields = {
  credential: { kind: 'license', title: '면허·자격 (선택)', hint: OPTIONAL_HINT, uploadLabel: '면허증 사진 업로드', previewAlt: '면허증 미리보기', numberPlaceholder: '면허번호 입력', required: false },
  workplacePlaceholder: '예: ○○병원 중환자실',
  departmentTitle: '주요 부서',
  departmentHint: '경험 있는 부서를 모두 선택해 주세요',
  departmentTags: WARD_TAGS,
};

const FIELDS: Record<WorkerRole, ProfileFields> = {
  rn: NURSING,
  na: NURSING,
  pharmacist: {
    credential: { kind: 'license', title: '면허증 *', hint: null, uploadLabel: '면허증 사진 업로드', previewAlt: '면허증 미리보기', numberPlaceholder: '면허번호 입력', required: true },
    workplacePlaceholder: '예: ○○약국 대체약사',
    departmentTitle: '주요 부서',
    departmentHint: '경험 있는 부서를 모두 선택해 주세요',
    departmentTags: PHARMACIST_TAGS,
  },
  pharmacy_staff: {
    credential: { kind: 'resume', title: '이력서', hint: null, uploadLabel: '이력서 업로드', previewAlt: '이력서 미리보기', numberPlaceholder: null, required: false },
    workplacePlaceholder: '예: ○○약국 전산·접수',
    departmentTitle: '주요 부서',
    departmentHint: '경험 있는 부서를 모두 선택해 주세요',
    departmentTags: PHARMACY_STAFF_TAGS,
  },
  care_worker: {
    credential: { kind: 'license', title: '자격증 (선택)', hint: '요양보호사 자격증을 미리 등록하면 사업장 확인이 빨라져요. 등록하지 않아도 돼요.', uploadLabel: '자격증 사진 업로드', previewAlt: '자격증 미리보기', numberPlaceholder: '자격증 번호 입력', required: false },
    workplacePlaceholder: '예: ○○요양원',
    departmentTitle: '주요 근무처',
    departmentHint: '일해 본 곳을 모두 선택해 주세요',
    departmentTags: CARE_TAGS,
  },
  dental_hygienist: {
    credential: { kind: 'license', title: '면허·자격 (선택)', hint: '치과위생사 면허를 미리 등록하면 사업장 확인이 빨라져요. 등록하지 않아도 돼요.', uploadLabel: '면허증 사진 업로드', previewAlt: '면허증 미리보기', numberPlaceholder: '면허번호 입력', required: false },
    workplacePlaceholder: '예: ○○치과의원 진료실',
    departmentTitle: '주요 업무',
    departmentHint: '해 본 업무를 모두 선택해 주세요',
    departmentTags: DENTAL_TAGS,
  },
  other: {
    credential: { kind: 'license', title: '자격증 (선택)', hint: '일에 필요한 자격증이 있으면 등록해요. 없으면 비워 둬도 돼요.', uploadLabel: '자격증 사진 업로드', previewAlt: '자격증 미리보기', numberPlaceholder: '자격증 번호 입력', required: false },
    workplacePlaceholder: '예: ○○의원 데스크',
    departmentTitle: '주요 업무',
    departmentHint: '해 본 업무를 모두 선택해 주세요',
    departmentTags: NEUTRAL_TAGS,
  },
};

const isWorkerRole = (value: string | null | undefined): value is WorkerRole => Boolean(value) && Object.prototype.hasOwnProperty.call(WORKER_ROLE_LABEL, value as string);

/**
 * 프로필 칸을 고를 직군. 초대로 간편 가입한 직원은 근무자 직군이 'other' 로 고정이라,
 * 사업장이 명부(facility_staff.role)에 적은 직종이 근무자 직군 중 하나면 그쪽 칸을 보여 준다(치과위생사 → 치과 칩).
 * 모르는 값·빈 값은 'other'(중립 칸)다 — 간호 기준으로 떨어지지 않게 한다.
 */
export function profileRole(workerRole: string | null | undefined, staffRole?: string | null): WorkerRole {
  if (isWorkerRole(workerRole) && workerRole !== 'other') return workerRole;
  if (isWorkerRole(staffRole)) return staffRole;
  return 'other';
}

export function profileFieldsFor(workerRole: string | null | undefined, staffRole?: string | null): ProfileFields {
  return FIELDS[profileRole(workerRole, staffRole)];
}

export const PROFILE_TOTAL = 4;

/**
 * 내 정보의 '프로필 n/4 완료'. 면허·자격 칸은 그 직군에서 필수일 때만 비어 있음을 센다.
 * 예전에는 간호·약국 사무만 면제라, 요양보호사·치과위생사·기타 직군은 면허가 없다는 이유로 영영 3/4 이었다.
 * 면제 판단은 근무자 직군 그대로 한다(명부 직종으로 바꿔 보지 않는다) — 어느 쪽이든 면허가 필수인 직군은 약사뿐이다.
 */
export function profileFilledCount(worker: {
  role?: string | null; license_number?: string | null; license_photo_url?: string | null;
  experience_years?: string | null; last_workplace?: string | null; department_tags?: string[] | null;
}): number {
  const credential = profileFieldsFor(worker.role).credential;
  return [
    !credential.required || Boolean(worker.license_number || worker.license_photo_url),
    Boolean(worker.experience_years),
    Boolean(worker.last_workplace),
    Boolean(worker.department_tags?.length),
  ].filter(Boolean).length;
}

/**
 * 회원 탈퇴 화면에서 '면허번호·면허 사진' 삭제 안내를 보여 줄지.
 * 면허·자격을 올릴 일이 없는 직군(치과위생사·요양보호사·기타)이고 실제로 올린 것도 없으면 그 문구를 뺀다 — 낸 적 없는 면허를 지운다고 하면 헷갈린다.
 * 아직 못 읽었으면(null) 보여 준다: 지워지는 것을 덜 알리는 쪽으로 틀리면 안 된다.
 */
export function withdrawMentionsLicense(worker: { role?: string | null; license_number?: string | null; license_photo_url?: string | null } | null | undefined): boolean {
  if (!worker) return true;
  if (worker.license_number || worker.license_photo_url) return true;
  return ['rn', 'na', 'pharmacist', 'pharmacy_staff'].includes(worker.role ?? '');
}
