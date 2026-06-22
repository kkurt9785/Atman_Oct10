import type { Config } from 'tailwindcss';

// 40대+ 시니어 친화 토큰: 큰 글씨·고대비·넉넉한 여백 (토스 시니어 UX 참고)
export default {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: '#3182F6',     // 토스 블루
        ink: '#191F28',         // 본문 (고대비)
        sub: '#4E5968',         // 보조 텍스트
        line: '#E5E8EB',
        bg: '#F2F4F6',
        success: '#00C471',
        warn: '#FF6B6B',
      },
      fontSize: {
        // rem 기반 → 큰글씨 토글(root 16→20px) 시 전체 ×1.25 확대
        label: ['0.875rem', '1.4'],
        body: ['1rem', '1.6'],
        title: ['1.25rem', '1.35'],
        display: ['1.75rem', '1.25'],
        money: ['1.75rem', '1.2'],
      },
      borderRadius: { xl: '16px', '2xl': '22px', '3xl': '28px' },
      minHeight: { tap: '56px' },   // 최소 터치 영역
      maxWidth: { app: '480px' },   // 모바일 우선 폭
    },
  },
  plugins: [],
} satisfies Config;
