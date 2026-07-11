export function won(value: number) {
  return `₩${Math.abs(Math.round(value)).toLocaleString('ko-KR')}`;
}
