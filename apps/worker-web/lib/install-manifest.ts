import type { Metadata } from 'next';
import manifest from '@/public/manifest.json';

// 홈 화면 앱의 시작 주소를 초대 화면으로 바꾼 manifest.
// 아이폰 홈 화면 앱은 사파리 로그인을 넘겨받지 못한다 — 초대 화면을 연 채 '홈 화면에 추가'하면 앱이 그 초대에서 열려
// 앱 안에서 한 번만 로그인하고 바로 수락한다. 시작 주소는 초대 화면만 허용하고, 앱 정체성(id)은 그대로 '잇닿 근무자' 하나다.
const INVITE_START = /^\/(workplace|gig)\/join\?token=[0-9a-fA-F-]{36}$/;

export function installStartUrl(start: string | null | undefined) {
  return start && INVITE_START.test(start) ? start : '/';
}

export function installManifest(start: string | null | undefined) {
  return { ...manifest, start_url: installStartUrl(start) };
}

/** 초대 화면에 붙일 manifest 주소 */
export function inviteManifestHref(variant: 'workplace' | 'gig', token: string | null | undefined) {
  const start = token ? `/${variant}/join?token=${token}` : null;
  return installStartUrl(start) === '/' ? '/manifest.json' : `/api/install-manifest?start=${encodeURIComponent(start!)}`;
}

/** 초대 링크의 카톡 미리보기와 홈 화면 앱 시작 주소 */
export function inviteMetadata(variant: 'workplace' | 'gig', token: string | null | undefined): Metadata {
  return {
    manifest: inviteManifestHref(variant, token),
    openGraph: {
      title: '근무 초대가 왔어요 · 잇닿',
      description: '눌러서 근무 조건을 확인하고 수락해 주세요.',
      type: 'website',
      images: [{ url: 'https://itdot.co.kr/og/invite.png', width: 1200, height: 630, alt: '잇닿 근무 초대' }],
    },
  };
}
