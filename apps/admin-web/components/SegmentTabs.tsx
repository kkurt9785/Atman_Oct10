import Link from 'next/link';

// 긴 화면을 위아래로 늘어놓지 않고 화면 위 탭으로 나눈다(토스 등 요즘 앱 방식) — 하단 탭은 5개 그대로 둔다.
// 탭은 주소(?tab=)로 바뀌어 새로고침·링크 공유에도 같은 탭이 열린다. 상단 헤더(h-16) 바로 아래에 붙어 있는다.
export type SegmentTab = { key: string; label: string; count?: number; warn?: boolean };

export function SegmentTabs({ tabs, active, basePath, params = {} }: { tabs: SegmentTab[]; active: string; basePath: string; params?: Record<string, string | undefined> }) {
  return (
    <nav aria-label="화면 구분" className="sticky top-16 z-[9] -mx-4 mb-3 bg-bg/95 px-4 py-2 backdrop-blur">
      <div className="grid gap-1 rounded-2xl bg-white p-1 shadow-sm" style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}>
        {tabs.map((tab) => {
          const query = new URLSearchParams();
          for (const [key, value] of Object.entries(params)) if (value) query.set(key, value);
          query.set('tab', tab.key);
          const on = tab.key === active;
          return (
            <Link key={tab.key} href={`${basePath}?${query.toString()}`} scroll={false} aria-current={on ? 'page' : undefined}
              className={`flex h-10 min-w-0 items-center justify-center gap-1 rounded-xl px-1 text-label font-extrabold ${on ? 'bg-primary text-white' : 'text-sub active:bg-bg'}`}>
              <span className="truncate">{tab.label}</span>
              {typeof tab.count === 'number' && tab.count > 0 && (
                <span className={`shrink-0 rounded-full px-1.5 text-[0.6875rem] ${on ? 'bg-white/25 text-white' : tab.warn ? 'bg-amber-100 text-warn' : 'bg-bg text-sub'}`}>{tab.count}</span>
              )}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
