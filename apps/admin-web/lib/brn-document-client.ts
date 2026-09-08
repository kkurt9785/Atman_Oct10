'use client';

import { supabase } from './supabase-browser';

// 사업자등록증 업로드(브라우저 → 비공개 버킷 facility-documents, 본인 폴더). 서버는 경로만 저장한다.
export const BRN_DOC_MIME_EXT: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'image/heif': 'heif', 'application/pdf': 'pdf',
};
export const BRN_DOC_ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf';
const MAX_BYTES = 10 * 1024 * 1024;

export function formatBrnInput(v: string): string {
  const d = v.replace(/\D/g, '').slice(0, 10);
  return d.length > 5 ? `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}` : d.length > 3 ? `${d.slice(0, 3)}-${d.slice(3)}` : d;
}

const EXT_MIME: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic', heif: 'image/heif', pdf: 'application/pdf' };
// 모바일 카메라·HEIC는 file.type이 비어 오는 경우가 있어 확장자로 보정한다
export function resolveBrnMime(file: File): string | null {
  if (BRN_DOC_MIME_EXT[file.type]) return file.type;
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  return EXT_MIME[ext] ?? null;
}

export function validateBrnDocument(file: File): string | null {
  if (!resolveBrnMime(file)) return '사진(JPG·PNG·HEIC) 또는 PDF만 올릴 수 있어요.';
  if (file.size > MAX_BYTES) return '파일이 10MB를 넘어요. 사진 크기를 줄여 주세요.';
  return null;
}

export async function uploadBrnDocument(file: File, facilityId: string): Promise<string> {
  const invalid = validateBrnDocument(file);
  if (invalid) throw new Error(invalid);
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) throw new Error('로그인이 만료됐어요. 다시 로그인해 주세요.');
  const mime = resolveBrnMime(file) as string;
  const path = `${user.id}/${facilityId}/brn-${Date.now()}.${BRN_DOC_MIME_EXT[mime]}`;
  const { error: uploadError } = await supabase.storage.from('facility-documents').upload(path, file, { cacheControl: '3600', upsert: false, contentType: mime });
  if (uploadError) throw new Error(`서류 업로드 실패: ${uploadError.message}`);
  return path;
}
