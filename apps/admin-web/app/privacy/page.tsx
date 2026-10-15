import Link from 'next/link';
export const metadata={title:'관리자 개인정보 처리방침 | 잇닿'};
export default function PrivacyPage(){return <main className="mx-auto min-h-screen max-w-3xl bg-white px-6 py-6 text-ink">
  <Link href="/login" className="inline-flex min-h-11 items-center font-bold text-primary">← 관리자 앱</Link>
  <h1 className="mt-4 text-2xl font-extrabold">관리자 개인정보 처리방침</h1>
  <p className="mt-2 text-sm text-sub">시행일 2026년 10월 15일 · 케셰르 / 잇닿</p>
  <div className="mt-6 space-y-6 text-sm leading-7 [&_h2]:text-base [&_h2]:font-bold">
    <section><h2>수집 항목과 목적</h2><p>관리자 가입·인증을 위해 로그인 식별값, 제공에 동의한 이름·이메일과 연락처를 처리합니다. 사업장 운영을 위해 사업장명, 주소·위치, 사업자등록번호·제출 서류, 담당자와 관리자 권한을 처리합니다.</p><p>인력·근태·급여 관리에는 등록한 근무자의 이름·연락처·직군, 계약·일정·출퇴근·임금 및 지급 기록, 공유에 동의한 지급 계좌, 워크룸 대화와 출석 응답을 사용합니다. 요금제 이용 시 주문·결제 식별값과 결제 상태를 처리하며 카드번호 전체를 직접 저장하지 않습니다.</p><p>서비스 운영과 부정 이용 방지를 위해 접속 기록, 로그인 쿠키, 알림 기기 정보, 동의 기록을 처리합니다. 신고 시 신고자·상대방 식별값, 메시지 사본, 사유·설명과 운영자 처리 기록을 보관합니다.</p></section>
    <section><h2>접근과 제공</h2><p>사업장 자료는 해당 사업장의 권한 있는 관리자와 관련 근무자에게 업무상 필요한 범위로 제공됩니다. 급여·계좌 등은 권한에 따라 접근이 제한됩니다. 사업장은 직접 등록한 기존 인력 정보에 대해 적법한 수집·이용 근거를 확보해야 합니다. 운영자는 신고 처리와 고객지원에 필요한 자료를 확인할 수 있습니다.</p></section>
    <section><h2>보관과 삭제</h2><p>이용 목적을 달성하거나 계정 탈퇴·사업장 종료가 승인되면 삭제 또는 익명화 절차를 진행합니다. 근로·거래 관련 기록 등 법령상 보존이 필요한 정보는 즉시 삭제되지 않을 수 있습니다. 출퇴근 위치 좌표는 근무일로부터 90일, 위치 인증 기록과 거리는 3년 보관합니다. 탈퇴한 근무자의 근무·출퇴근·지급·근무 대화와 동의 기록은 탈퇴 후 3년 보관합니다.</p><p>대화 신고와 처리 기록은 접수 후 1년 보관합니다. 차단 설정은 해제 또는 해당 계정 삭제 시 삭제됩니다. 근무자 계정의 면허 사진은 탈퇴 승인 후 서버에서 삭제하며, 저장소 장애가 있으면 재시도합니다.</p></section>
    <section><h2>처리 위탁</h2><p>Supabase(서울 리전)는 데이터베이스·인증·파일 저장, Vercel은 웹 호스팅, 카카오는 계정 로그인, 토스페이먼츠는 결제 처리를 제공합니다. 알림을 켠 경우 Google·Apple 등 브라우저 알림 서비스에 알림 내용과 기기 알림 주소가 전달됩니다. Vercel·브라우저 알림 처리 과정에서 접속 기록 및 알림 정보가 국외에서 처리될 수 있습니다.</p></section>
    <section><h2>권리 행사와 문의</h2><p>설정에서 사업장 정보를 수정하고 계정·사업장 종료를 요청할 수 있습니다. 진행 중인 근무·정산이나 소유 사업장이 있으면 정리·권한 이전이 먼저 필요할 수 있습니다. 개인정보 열람·정정·삭제·처리정지는 고객센터로 요청할 수 있습니다.</p><p><a href="https://itdot.co.kr/account-deletion" className="font-bold text-primary underline">앱 없이 계정·개인정보 삭제 안내 보기</a></p><p>개인정보 보호 담당: 김기한 · 010-9045-5699<br/>사업자: 케셰르 · 481-44-01177<br/>주소: 경기도 수원시 권선구 경수대로 202</p></section>
    <p>근무자 서비스의 자세한 내용은 <a href="https://itdot.co.kr/legal/privacy" className="font-bold text-primary underline">근무자 개인정보 처리방침</a>에서 확인할 수 있습니다.</p>
  </div>
</main>;}
