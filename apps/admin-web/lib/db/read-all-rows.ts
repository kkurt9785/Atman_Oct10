type PageQuery<T> = PromiseLike<{ data: T[] | null; error: unknown }> & {
  order(column: string, options?: { ascending: boolean }): PageQuery<T>;
  limit(count: number): PageQuery<T>;
  gt(column: string, value: string): PageQuery<T>;
};

/** Stable ID cursor avoids the API row cap and offset shifts. Never return partial financial data. */
export async function readAllRows<T extends { id: string }>(query: () => PageQuery<T>) {
  const data: T[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 2000; page++) {
    let request = query().order('id', { ascending: true }).limit(500);
    if (cursor !== null) request = request.gt('id', cursor);
    const result = await request;
    if (result.error) throw new Error('전체 운영 데이터를 불러오지 못했어요. 다시 시도해 주세요.');
    const rows = result.data ?? [];
    if (rows.length === 0) return { data, error: null };
    for (const row of rows) {
      if (!row.id || (cursor !== null && row.id <= cursor)) throw new Error('조회 순서가 변경됐어요. 새로고침 후 다시 시도해 주세요.');
      data.push(row);
      cursor = row.id;
    }
  }
  throw new Error('조회 범위가 너무 커 전체 데이터를 확인하지 못했어요. 운영자에게 문의해 주세요.');
}
