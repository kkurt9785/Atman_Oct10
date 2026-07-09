import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: '#3182F6',
        'primary-light': '#EBF3FF',
        bg: '#F2F4F6',
        card: '#FFFFFF',
        ink: '#191F28',
        sub: '#4E5968',
        tertiary: '#8B95A1',
        warn: '#FF8B00',
        success: '#00C896',
        'success-light': '#E5FAF4',
        kakao: '#FEE500',
        line: '#E5E8EB',
      },
      fontFamily: {
        sans: ['Pretendard', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
      },
      borderRadius: {
        card: '16px',
        btn: '12px',
      },
      boxShadow: {
        card: '0 4px 16px rgba(0,0,0,0.04)',
        btn: '0 4px 12px rgba(49,130,246,0.25)',
      },
      maxWidth: {
        app: '390px',
      },
    },
  },
  plugins: [],
};
export default config;
