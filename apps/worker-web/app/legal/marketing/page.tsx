import { LegalDoc, COMPANY } from '@/components/legal/LegalDoc';

export const metadata = { title: '마케팅 정보 수신 동의 | 잇닿' };

export default function MarketingPage() {
  return (
    <LegalDoc
      title="마케팅 정보 수신 동의 (선택)"
      intro={<p>동의하지 않아도 공고 확인·지원, 출퇴근, 지급 확인 등 서비스는 그대로 이용할 수 있습니다.</p>}
      sections={[
        {
          title: '목적',
          body: <p>회원 혜택, 이벤트, 새 기능 안내를 보내기 위해 아래 정보를 이용합니다.</p>,
        },
        {
          title: '이용 항목과 방법',
          body: (
            <ul>
              <li>이용 항목: 이름, 휴대전화번호, 직군, 활동 지역, 앱 알림 수신 기기 정보</li>
              <li>보내는 방법: 앱 알림</li>
              <li>밤 9시부터 다음 날 오전 8시까지는 광고성 알림을 보내지 않습니다.</li>
            </ul>
          ),
        },
        {
          title: '보유 기간과 철회',
          body: <p>동의를 철회할 때까지 이용합니다. 철회는 고객센터({COMPANY.phone})로 요청하면 지체 없이 처리하며, 철회 후에는 광고성 알림을 보내지 않습니다.</p>,
        },
        {
          title: '광고가 아닌 알림',
          body: <p>지원 결과, 근무 확정, 출근 안내, 대타 요청, 지급 상태 등 서비스 이용에 꼭 필요한 알림은 마케팅 동의와 관계없이 보냅니다.</p>,
        },
      ]}
    />
  );
}
