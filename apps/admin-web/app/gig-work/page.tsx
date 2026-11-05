import { redirect } from 'next/navigation';

// 근무 건 목록은 홈(운영) 화면에 있다. 상세의 뒤로가기·주소 직접 입력이 404로 막히지 않게 홈으로 보낸다.
export default function GigWorkIndexPage() {
  redirect('/');
}
