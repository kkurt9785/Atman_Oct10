'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { validateLicenseFile } from '@/components/onboarding/LicenseUpload';

type LicenseMode = 'photo' | 'text';

const EXPERIENCE_OPTIONS = [
  { value: '1년미만', label: '1년 미만' },
  { value: '1~3년',   label: '1 ~ 3년' },
  { value: '3~5년',   label: '3 ~ 5년' },
  { value: '5년이상', label: '5년 이상' },
];

const DEPT_TAGS = [
  '일반병동', '중환자실', '응급실', '수술실',
  '외래', '소아과', '정신과', '신생아실',
  '요양원', '요양병원', '재활병원', '의원·클리닉',
];

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

  // Private bucket stores an object path. Preview uses a short-lived signed URL.
  useEffect(() => {
    let active = true;
    async function load() {
      const { data, error: loadError } = await supabase.from('workers')
        .select('license_number, license_photo_url, experience_years, last_workplace, department_tags')
        .maybeSingle();
      if (!active || loadError || !data) return;
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
    }
    void load();
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

  async function handleSave() {
    setError(null);
    if (licenseMode === 'text' && !licenseNumber.trim()) { setError('면허 번호를 입력해주세요.'); return; }
    if (licenseMode === 'photo' && !licenseFile && !licensePhotoPath) { setError('면허 사진을 등록해주세요.'); return; }
    if (!experience) { setError('경력을 선택해주세요.'); return; }
    if (!lastWorkplace.trim()) { setError('최근 근무지를 입력해주세요.'); return; }
    if (deptTags.length === 0) { setError('부서 태그를 최소 1개 선택해주세요.'); return; }

    setSaving(true);
    let uploadedPath: string | null = null;
    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) throw new Error('로그인이 만료됐어요.');

      let nextPath = licenseMode === 'photo' ? licensePhotoPath : null;
      if (licenseMode === 'photo' && licenseFile) {
        const extByType: Record<string, string> = {
          'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
          'image/heic': 'heic', 'image/heif': 'heif',
        };
        const ext = extByType[licenseFile.type];
        if (!ext) throw new Error('지원하지 않는 면허 파일 형식이에요.');
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
        p_license_number: licenseMode === 'text' ? licenseNumber.trim() : null,
        p_license_path: nextPath,
        p_experience_years: experience,
        p_last_workplace: lastWorkplace.trim(),
        p_department_tags: deptTags,
      });
      if (updateError) throw new Error(updateError.message.replace(/^.*?: /, ''));

      if (uploadedPath && licensePhotoPath && uploadedPath !== licensePhotoPath) {
        await supabase.storage.from('license-photos').remove([licensePhotoPath]).catch(() => undefined);
      }
      router.back();
    } catch (saveError: unknown) {
      if (uploadedPath) await supabase.storage.from('license-photos').remove([uploadedPath]).catch(() => undefined);
      setError(saveError instanceof Error ? saveError.message : '저장 중 오류가 발생했어요.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="px-4 pb-32">
      {/* 헤더 */}
      <div className="flex items-center gap-3 mt-2 mb-6 px-1">
        <button
          type="button"
          onClick={() => router.back()}
          className="text-2xl text-sub leading-none"
          aria-label="뒤로"
        >
          ←
        </button>
        <h1 className="text-[22px] font-extrabold text-ink">내 프로필 카드</h1>
      </div>

      <div className="flex flex-col gap-5">
        {/* 면허증 */}
        <section className="bg-white rounded-2xl p-5 shadow-sm">
          <p className="text-[13px] font-bold text-sub mb-3">면허증 *</p>

          {/* 탭 토글 */}
          <div className="flex bg-bg rounded-xl p-1 mb-4">
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
          </div>

          {licenseMode === 'photo' ? (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="w-full"
            >
              {licensePreview ? (
                <div className="relative w-full rounded-xl overflow-hidden border border-line">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={licensePreview}
                    alt="면허증 미리보기"
                    className="w-full object-cover max-h-52"
                  />
                  <span className="absolute bottom-2 right-2 text-[11px] font-semibold bg-black/50 text-white px-2 py-1 rounded-full">
                    탭하여 변경
                  </span>
                </div>
              ) : (
                <div className="w-full h-36 rounded-xl border-2 border-dashed border-line flex flex-col items-center justify-center gap-2 bg-bg active:bg-line/50">
                  <span className="text-3xl">📋</span>
                  <p className="text-[13px] font-semibold text-sub">면허증 사진 업로드</p>
                  <p className="text-[11px] text-tertiary">JPG, PNG, HEIC 가능</p>
                </div>
              )}
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
                className="hidden"
                onChange={handleFileChange}
              />
            </button>
          ) : (
            <div className="flex items-center gap-2 bg-bg rounded-xl px-4 py-3.5">
              <span className="text-[15px] text-sub whitespace-nowrap">제</span>
              <input
                type="text"
                inputMode="numeric"
                placeholder="면허번호 입력"
                value={licenseNumber}
                onChange={(e) => setLicenseNumber(e.target.value)}
                className="flex-1 bg-transparent text-[15px] text-ink focus:outline-none"
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
            placeholder="예: ○○병원 중환자실"
            value={lastWorkplace}
            onChange={(e) => setLastWorkplace(e.target.value)}
            className="w-full bg-bg rounded-xl px-4 py-3.5 text-[15px] text-ink placeholder:text-tertiary focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </section>

        {/* 주요 부서 */}
        <section className="bg-white rounded-2xl p-5 shadow-sm">
          <p className="text-[13px] font-bold text-sub mb-1">주요 부서 <span className="font-normal">(복수 선택)</span> *</p>
          <p className="text-[11px] text-tertiary mb-3">경험 있는 부서를 모두 선택해주세요</p>
          <div className="flex flex-wrap gap-2">
            {DEPT_TAGS.map((tag) => (
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
      </div>
    </main>
  );
}
