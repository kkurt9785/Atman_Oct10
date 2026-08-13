import type { MetadataRoute } from 'next';

// 공개 영역(/intro, /jobs)과 렌더링 자산만 크롤링한다.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/intro', '/jobs', '/_next/', '/icon-', '/apple-touch-icon.png', '/manifest.json'],
        disallow: ['/'],
      },
    ],
    sitemap: 'https://itdot.co.kr/sitemap.xml',
  };
}
