import type { MetadataRoute } from 'next';
// share_target lets Android Chrome list HARAGURI in the system share sheet (photos from KakaoTalk, Line, the gallery; card SMS text).
// iOS Safari does not support it; the service worker receives the POST and hands the items to the page.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'HARAGURI', short_name: 'HARAGURI', description: '우리 가족의 하루를 함께',
    start_url: '/', scope: '/', display: 'standalone', background_color: '#f7f6f2', theme_color: '#f7f6f2',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    share_target: {
      action: '/share', method: 'POST', enctype: 'multipart/form-data',
      params: { title: 'title', text: 'text', url: 'url', files: [{ name: 'files', accept: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] }] },
    },
  } as MetadataRoute.Manifest;
}
