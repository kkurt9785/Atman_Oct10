import type { MetadataRoute } from 'next';

// 공개 영역(/intro, /jobs)만 색인. 로그인 이후 개인 화면은 전부 차단한다.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/intro', '/jobs'],
        disallow: [
          '/home', '/shifts', '/applications', '/workplace', '/earnings',
          '/rewards', '/settings', '/chat', '/onboarding', '/auth', '/api', '/map', '/store',
        ],
      },
    ],
    sitemap: 'https://itdot.co.kr/sitemap.xml',
  };
}
