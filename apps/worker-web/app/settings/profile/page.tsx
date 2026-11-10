'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { BackButton } from '@/components/BackButton';
import { validateLicenseFile } from '@/components/onboarding/LicenseUpload';
import { profileFieldsFor } from '@/lib/profile-fields';
import { isGigLink } from '@/lib/worker-mode';

type LicenseMode = 'photo' | 'text';

const EXPERIENCE_OPTIONS = [
  { value: '1년미만', label: '1년 미만' },
  { value: '1~3년',   label: '1 ~ 3년' },
  { value: '3~5년',   label: '3 ~ 5년' },
  { value: '5년이상', label: '5년 이상' },
];

// 직군별 칸(면허 제목·선택 칩·입력 예시)은 lib/profile-fields.ts — 치과·기타 직군에 병동 칩과 '면허증 *'이 보이지 않게 한다

export default function ProfileEditPage() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  const [licenseMode,    setLicenseMode]    = useState<LicenseMode>('photo');
  const [licenseNumber,  setLicenseNumber]  = useState('');
  const [licenseFile,    setLicenseFile]    = useState<File | null>(null);
  const [licensePreview, setLicensePreview] = useState<string | null>(null);
  const [licensePhotoPath, setLicensePhotoPath] = useState<string | null>(null);
  const [experience,     setExperience]     = useState('');
  const [lastWorkplace,  setLastWorkplace]  = useState('');
  const [deptTags,       setDeptTags]       = useState<string[]>([]);
  const [saving,         setSaving]         = useState(false);
  const [error,          setError]          = useState<string | null>(null);
  const [role,           setRole]           = useState('');
  // 초대로 간편 가입한 직원은 직군이 'other' 라, 사업장이 명부에 적은 직종으로 칸을 고른다
  const [staffRole,      setStaffRole]      = useState<string | null>(null);
  // 직군을 알기 전에는 칸을 그리지 않는다 — 미리 그리면 치과 직원에게도 간호 기준 칸('면허증 *'·병동 칩)이 먼저 비친다.
  // 서버가 미리 만든 화면에 입력칸이 없어져, 입력칸을 건드리는 브라우저 기능과 화면 맞추기(hydration)가 어긋날 일도 줄어든다(2026-11-10 QA React #418)
  const [loaded,         setLoaded]         = useState(false);

  // Private bucket stores an object path. Preview uses a short-lived signed URL.
  useEffect(() => {
    let active = true;
    async function load() {
      const { data, error: loadError } = await supabase.from('workers')
        .select('id, role, license_number, license_photo_url, experience_years, last_workplace, department_tags')
        .maybeSingle();
      if (!active) return;
      // 못 읽어도 칸은 연다(중립 칸) — 저장할 때 서버가 다시 알려 준다
      if (loadError || !data) { setLoaded(true); return; }
      setRole(data.role ?? '');
      if (!data.role || data.role === 'other') {
        const { data: links } = await supabase.from('facility_staff').select('role,worker_kind').eq('worker_id', data.id).neq('status', 'ended');
        if (!active) return;
        setStaffRole(((links ?? []) as Array<{ role: string | null; worker_kind?: string | null }>).find((link) => !isGigLink(link) && link.role && link.role !== 'other')?.role ?? null);
      }
      if (data.license_photo_url) {
        setLicenseMode('photo');
        setLicensePhotoPath(data.license_photo_url);
        const { data: signed } = await supabase.storage.from('license-photos').createSignedUrl(data.license_photo_url, 300);
        if (active) setLicensePreview(signed?.signedUrl ?? null);
      } else if (data.license_number) {
        setLicenseMode('text');
        setLicenseNumber(data.license_number);
      }
      setExperience(data.experience_years ?? '');
      setLastWorkplace(data.last_workplace ?? '');
      setDeptTags(data.department_tags ?? []);
      setLoaded(true);
    }
    void load().catch(() => { if (active) setLoaded(true); });
    return () => { active = false; };
  }, []);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const validation = validateLicenseFile(file);
    if (validation) {
      setError(validation);
      e.target.value = '';
      return;
    }
    setError(null);
    setLicenseFile(file);
    setLicensePreview(URL.createObjectURL(file));
  }

  function toggleTag(tag: string) {
    setDeptTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  }

  const fields = profileFieldsFor(role, staffRole);
  const credential = fields.credential;
  // 이력서(약국 전산·사무직)는 파일만 받는다
  const resumeOnly = credential.kind === 'resume';
  // 예전에 고른 칩이 지금 직군 목록에 없어도 보여 준다 — 안 보이면 지울 수도 없다
  const tagOptions = [...fields.departmentTags, ...deptTags.filter((tag) => !fields.departmentTags.includes(tag))];

  async function handleSave() {
    setError(null);
    // 자격 확인은 사업장이 채용 확정 전에 수행한다 — 프로필 저장은 어떤 직군도 면허를 강제하지 않는다
  const requiresLicense = false;
    if (requiresLicense && licenseMode === 'text' && !licenseNumber.trim()) { setError('면허 번호를 입력해 주세요.'); return; }
    if (requiresLicense && licenseMode === 'photo' && !licenseFile && !licensePhotoPath) { setError('면허 사진을 등록해 주세요.'); return; }
    if (!experience) { setError('경력을 선택해 주세요.'); return; }
    if (!lastWorkplace.trim()) { setError('최근 근무지를 입력해 주세요.'); return; }
    if (deptTags.length === 0) { setError(`${fields.departmentTitle}를 최소 1개 선택해 주세요.`); return; }

    setSaving(true);
    let uploadedPath: string | null = null;
    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) throw new Error('로그인이 만료됐어요.');

      let nextPath = licenseMode === 'photo' || resumeOnly ? licensePhotoPath : null;
      if ((licenseMode === 'photo' || resumeOnly) && licenseFile) {
        const extByType: Record<string, string> = {
          'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
          'image/heic': 'heic', 'image/heif': 'heif', 'application/pdf': 'pdf',
        };
        const ext = extByType[licenseFile.type];
        if (!ext) throw new Error('지원하지 않는 파일 형식이에요.');
        uploadedPath = `${user.id}/${crypto.randomUUID()}.${ext}`;
        const { error: uploadError } = await supabase.storage.from('license-photos').upload(uploadedPath, licenseFile, {
          upsert: false,
          cacheControl: '3600',
          contentType: licenseFile.type,
        });
        if (uploadError) throw uploadError;
        nextPath = uploadedPath;
      }

      const { error: updateError } = await supabase.rpc('update_my_worker_profile', {
        p_license_number: !resumeOnly && licenseMode === 'text' ? licenseNumber.trim() : null,
        p_license_path: nextPath,
        p_experience_years: experience,
        p_last_workplace: lastWorkplace.trim(),
        p_department_tags: deptTags,
      });
      if (updateError) throw new Error(updateError.message.replace(/^.*?: /, ''));

      if (uploadedPath && licensePhotoPath && uploadedPath !== licensePhotoPath) {
        await supabase.storage.from('license-photos').remove([licensePhotoPath]).catch(() => undefined);
      }
      // 온보딩 Approval CTA 경유 시 back()이 온보딩 스플래시로 떨어짐 — 홈으로 명시 이동
      router.replace('/home');
    } catch (saveError: unknown) {
      if (uploadedPath) await supabase.storage.from('license-photos').remove([uploadedPath]).catch(() => undefined);
      setError(saveError instanceof Error ? saveError.message : '저장 중 오류가 발생했어요.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="px-4 pb-32 pt-[max(16px,env(safe-area-inset-top))]">
      {/* 헤더 — 설치 앱엔 브라우저 뒤로가기가 없다. 알림·링크로 바로 열려도 내 정보로 돌아간다 */}
      <div className="mb-6 px-1">
        <BackButton href="/settings" label="내 정보" />
        <h1 className="mt-2 text-[24px] font-extrabold text-ink">내 프로필 카드</h1>
      </div>

      {!loaded ? <p role="status" className="rounded-2xl bg-white p-5 text-[13px] text-sub shadow-sm">내 프로필을 불러오고 있어요…</p> : <div className="flex flex-col gap-5">
        {/* 면허·자격 — 제목과 필수 표시는 직군마다 다르다 */}
        <section className="bg-white rounded-2xl p-5 shadow-sm">
          <p className="text-[13px] font-bold text-sub mb-1">{credential.title}</p>
          {credential.hint && <p className="mb-3 text-[12px] text-sub">{credential.hint}</p>}

          {/* 탭 토글 — 이력서(전산·사무직)는 파일 업로드만 */}
          {!resumeOnly && <div className="flex bg-bg rounded-xl p-1 mb-4">
            {(['photo', 'text'] as LicenseMode[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setLicenseMode(m)}
                className={`flex-1 py-2.5 rounded-lg text-[13px] font-bold transition-all ${
                  licenseMode === m ? 'bg-white text-ink shadow-sm' : 'text-sub'
                }`}
              >
                {m === 'photo' ? '📷  사진 업로드' : '✏️  번호 입력'}
              </button>
            ))}
          </div>}

          {licenseMode === 'photo' || resumeOnly ? (
            // 버튼 안에는 글자 요소(span)만 둔다 — 버튼 안의 div·p·input 은 HTML 규칙에 어긋나, 브라우저가 고쳐 읽으면 화면 맞추기가 어긋난다
            <>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="block w-full"
            >
              {licensePreview && (licenseFile?.type === 'application/pdf' || licensePhotoPath?.endsWith('.pdf')) ? (
                <span className="flex w-full items-center gap-3 rounded-xl border border-line bg-bg px-4 py-4">
                  <span className="text-3xl" aria-hidden="true">📄</span>
                  <span className="flex-1 text-left"><b className="block text-[13px] text-ink">PDF 문서 등록됨</b><span className="text-[11px] text-sub">탭하여 변경</span></span>
                </span>
              ) : licensePreview ? (
                <span className="relative block w-full rounded-xl overflow-hidden border border-line">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={licensePreview}
                    alt={credential.previewAlt}
                    className="w-full object-cover max-h-52"
                  />
                  <span className="absolute bottom-2 right-2 text-[11px] font-semibold bg-black/50 text-white px-2 py-1 rounded-full">
                    탭하여 변경
                  </span>
                </span>
              ) : (
                <span className="w-full h-36 rounded-xl border-2 border-dashed border-line flex flex-col items-center justify-center gap-2 bg-bg active:bg-line/50">
                  <span className="text-3xl" aria-hidden="true">📋</span>
                  <span className="text-[13px] font-semibold text-sub">{credential.uploadLabel}</span>
                  <span className="text-[11px] text-tertiary">PDF, JPG, PNG, HEIC 가능</span>
                </span>
              )}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,application/pdf"
              className="hidden"
              onChange={handleFileChange}
            />
            </>
          ) : (
            <div className="flex items-center gap-2 bg-bg rounded-xl px-4 py-3.5">
              <span className="text-[15px] text-sub whitespace-nowrap">제</span>
              <input
                type="text"
                inputMode="numeric"
                placeholder={credential.numberPlaceholder ?? '번호 입력'}
                value={licenseNumber}
                onChange={(e) => setLicenseNumber(e.target.value)}
                className="flex-1 bg-transparent text-[16px] text-ink focus:outline-none"
              />
              <span className="text-[15px] text-sub whitespace-nowrap">호</span>
            </div>
          )}
        </section>

        {/* 경력 */}
        <section className="bg-white rounded-2xl p-5 shadow-sm">
          <p className="text-[13px] font-bold text-sub mb-3">경력 *</p>
          <div className="grid grid-cols-2 gap-2">
            {EXPERIENCE_OPTIONS.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => setExperience(o.value)}
                className={`py-3 rounded-xl text-[14px] font-bold transition-colors ${
                  experience === o.value
                    ? 'bg-primary text-white'
                    : 'bg-bg text-sub'
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
        </section>

        {/* 최근 근무지 */}
        <section className="bg-white rounded-2xl p-5 shadow-sm">
          <p className="text-[13px] font-bold text-sub mb-3">최근 근무지 *</p>
          <input
            type="text"
            placeholder={fields.workplacePlaceholder}
            value={lastWorkplace}
            onChange={(e) => setLastWorkplace(e.target.value)}
            className="w-full bg-bg rounded-xl px-4 py-3.5 text-[16px] text-ink placeholder:text-tertiary focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </section>

        {/* 주요 부서 */}
        <section className="bg-white rounded-2xl p-5 shadow-sm">
          <p className="text-[13px] font-bold text-sub mb-1">{fields.departmentTitle} <span className="font-normal">(복수 선택)</span> *</p>
          <p className="text-[11px] text-tertiary mb-3">{fields.departmentHint}</p>
          <div className="flex flex-wrap gap-2">
            {tagOptions.map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => toggleTag(tag)}
                className={`px-3.5 py-2 rounded-full text-[13px] font-semibold transition-colors ${
                  deptTags.includes(tag)
                    ? 'bg-primary text-white'
                    : 'bg-bg text-sub'
                }`}
              >
                {tag}
              </button>
            ))}
          </div>
        </section>

        {error && (
          <div className="bg-warn/10 rounded-xl px-4 py-3">
            <p className="text-[14px] text-warn font-bold">{error}</p>
          </div>
        )}

        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="w-full h-14 bg-primary text-white text-[15px] font-bold rounded-xl disabled:opacity-50 active:opacity-90 transition-opacity"
        >
          {saving ? '저장 중...' : '저장하기'}
        </button>
      </div>}
    </main>
  );
}
