'use client';

import type { ReactNode } from 'react';
import { useDemoSelection } from './DemoSelection';

// /intro 에서 고른 유형이 단기·행사면 gig 를, 아니면 서버가 넘긴 기존 마크업(other)을 그대로 그린다.
// 병원·약국·요양병원 출력은 바뀌지 않는다(래퍼가 DOM 을 더하지 않음). ?kind=gigworker 는 서버 초기값이라 첫 HTML 부터 단기 내용이 나온다.
export function ForGigKind({ gig, other }: { gig: ReactNode; other: ReactNode }) {
  const { kind } = useDemoSelection();
  return <>{kind === 'gigworker' ? gig : other}</>;
}
