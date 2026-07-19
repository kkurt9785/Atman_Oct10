// 서버 페이지 전환 중 즉시 표시되는 로딩 화면 — 체감 전환 속도 개선
export default function Loading() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3">
      <div className="w-8 h-8 rounded-full border-[3px] border-line border-t-primary animate-spin" />
      <p className="text-label text-sub">불러오는 중…</p>
    </div>
  );
}
