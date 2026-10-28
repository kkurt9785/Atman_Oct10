/** @type {import('next').NextConfig} */
export default {
  reactStrictMode: true,
  devIndicators: false, // the dev badge sits on the mobile bottom nav and blocks taps during local QA
  allowedDevOrigins: ['127.0.0.1', 'localhost'],
  async headers() {
    return [{ source: '/:path*', headers: [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'X-Frame-Options', value: 'DENY' },
    ] }, { source: '/sw.js', headers: [{ key: 'Cache-Control', value: 'no-cache' }] },
    // Signed Shortcuts file (built by scripts/build-shortcut.py). The Korean filename becomes the shortcut's name on import.
    { source: '/haraguri-collect.shortcut', headers: [
      { key: 'Content-Type', value: 'application/octet-stream' },
      { key: 'Content-Disposition', value: "attachment; filename=\"haraguri-collect.shortcut\"; filename*=UTF-8''%ED%95%98%EB%9D%BC%EA%B5%AC%EB%A6%AC%20%EC%88%98%EC%A7%91.shortcut" },
      { key: 'Cache-Control', value: 'public, max-age=300' },
    ] }];
  },
};
