export default function LegalPage() {
  return (
    <main className="min-h-screen bg-white px-6 py-12">
      <p className="text-[12px] font-bold text-amber-700 bg-amber-50 rounded-lg px-3 py-2 mb-5">QA용 초안 · 공개 출시 전 법률 검토 및 최종 버전 확정 필요</p>
      <h1 className="text-[24px] font-extrabold text-ink">개인정보 처리 안내</h1>
      <p className="text-[13px] text-sub mt-2">버전: 2026-07-draft-1</p>
      <ul className="mt-6 list-disc pl-5 space-y-3 text-[14px] text-ink"><li>수집 항목: 이름, 연락처, 생년월일, 면허, 계좌, 위치</li><li>이용 목적: 본인 확인, 매칭, 출퇴근, 정산, 고객지원</li><li>보관 기간과 파기 기준은 공개 출시 전 확정</li><li>민감 문서는 비공개 저장소와 제한시간 링크로 제공</li></ul>
      <p className="mt-8 text-[12px] text-tertiary">이 문서는 테스트용 요약이며 법률 자문을 대체하지 않습니다.</p>
    </main>
  );
}
