export default function LegalPage() {
  return (
    <main className="min-h-screen bg-white px-6 py-12">
      <p className="text-[12px] font-bold text-amber-700 bg-amber-50 rounded-lg px-3 py-2 mb-5">QA용 초안 · 공개 출시 전 법률 검토 및 최종 버전 확정 필요</p>
      <h1 className="text-[24px] font-extrabold text-ink">위치정보 이용 안내</h1>
      <p className="text-[13px] text-sub mt-2">버전: 2026-07-draft-1</p>
      <ul className="mt-6 list-disc pl-5 space-y-3 text-[14px] text-ink"><li>근처 시프트 검색과 출퇴근 거리 검증에 사용</li><li>GPS 거부 시 등록 활동지역을 사용할 수 있음</li><li>출퇴근 검증에 사용된 거리 결과와 감사기록 보관 기준은 출시 전 확정</li><li>공개 출시 전 위치기반서비스 관련 신고·약관 검토 필요</li></ul>
      <p className="mt-8 text-[12px] text-tertiary">이 문서는 테스트용 요약이며 법률 자문을 대체하지 않습니다.</p>
    </main>
  );
}
