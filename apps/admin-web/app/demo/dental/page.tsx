import type { Metadata } from 'next';
import { DemoLanding } from '../DemoLanding';
import { DENTAL_DEMO_NAME, isValidDentalDemoKey } from '@/lib/demo/private-dental';

// 영업용 비공개 치과 시연 링크: admin.itdot.co.kr/demo/dental?key=…
// 받은 사람이 ① 바로 시연을 보거나 ② 관리자 앱을 설치한다. 설치한 앱은 이 주소(키 포함)로 열려 곧장 치과 시연으로 들어간다
// — 아이폰 홈 화면 앱은 사파리와 로그인 상태를 나눠 쓰지 않아서, 앱이 열릴 때마다 키로 다시 들어가야 한다.
type Params = Promise<{ key?: string | string[] }>;
const keyOf = (value: unknown) => String(Array.isArray(value) ? value[0] ?? '' : value ?? '').trim();

export async function generateMetadata({ searchParams }: { searchParams: Params }): Promise<Metadata> {
  const key = keyOf((await searchParams).key);
  const valid = isValidDentalDemoKey(key);
  return {
    title: valid ? `${DENTAL_DEMO_NAME} 시연 — 잇닿 관리자` : '잇닿 관리자',
    description: '치과 직원 출퇴근·연차·급여를 잇닿 관리자 앱으로 미리 보세요.',
    // 설치 정보도 이 링크 전용 — 설치한 앱의 시작 주소가 이 치과 시연이 된다
    ...(valid ? { manifest: `/demo/dental/manifest?key=${encodeURIComponent(key)}` } : {}),
    // 카카오톡 미리보기(썸네일·제목). og:url 은 넣지 않는다 — 미리보기가 키 없는 주소로 열리면 '링크 만료' 화면이 된다
    ...(valid ? {
      openGraph: {
        title: `${DENTAL_DEMO_NAME} 시연 — 잇닿 관리자`,
        description: '원장님 화면 1분 영상 보고 관리자 앱을 바로 설치하세요.',
        type: 'website',
        images: [{ url: 'https://admin.itdot.co.kr/og/demo.png', width: 1200, height: 630, alt: '잇닿 관리자 앱 — 영상 보고 바로 설치' }],
      },
    } : {}),
    robots: { index: false, follow: false },
    referrer: 'no-referrer',
  };
}

export default async function DentalDemoPage({ searchParams }: { searchParams: Params }) {
  const key = keyOf((await searchParams).key);
  if (!isValidDentalDemoKey(key)) {
    return <main className="flex min-h-screen items-center justify-center bg-white px-6 text-center">
      <div>
        <p className="text-[1.125rem] font-extrabold text-ink">시연 링크가 만료됐거나 올바르지 않아요</p>
        <p className="mt-2 text-[0.875rem] leading-6 text-sub">링크를 보낸 담당자에게 새 링크를 받아 주세요.</p>
      </div>
    </main>;
  }
  return <DemoLanding kind="dental" demoKey={key} />;
}
