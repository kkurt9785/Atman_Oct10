export default function Loading() {
  return (
    <main className="px-4 pb-28" aria-busy="true" aria-label="화면을 불러오는 중">
      <div className="mt-3 px-1">
        <div className="h-3 w-24 animate-pulse rounded-full bg-primary/10" />
        <div className="mt-2 h-8 w-36 animate-pulse rounded-xl bg-line" />
        <div className="mt-2 h-3 w-64 max-w-full animate-pulse rounded-full bg-line/80" />
      </div>
      <div className="mt-5 grid grid-cols-3 gap-2">
        {[0, 1, 2].map((item) => (
          <div key={item} className="h-20 animate-pulse rounded-2xl bg-white shadow-sm" />
        ))}
      </div>
      <div className="mt-4 space-y-3">
        {[0, 1, 2].map((item) => (
          <div key={item} className="rounded-2xl bg-white p-4 shadow-sm">
            <div className="h-4 w-28 animate-pulse rounded-full bg-line" />
            <div className="mt-3 h-3 w-full animate-pulse rounded-full bg-line/70" />
            <div className="mt-2 h-3 w-2/3 animate-pulse rounded-full bg-line/70" />
          </div>
        ))}
      </div>
      <span className="sr-only">불러오는 중…</span>
    </main>
  );
}
