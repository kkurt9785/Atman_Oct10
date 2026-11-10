import { NextRequest, NextResponse } from 'next/server';
import { requireAdminContext } from '@/lib/admin-auth';
import { getAttendanceHistory } from '@/lib/db/attendance-history';
import { csvAttachment, csvCell } from '@/lib/csv';
import { ATTENDANCE_EXPORT_HEADER, attendanceExportRows } from '@/lib/attendance-export';
const q=csvCell; // 이름·수정 사유가 = + - @ 로 시작해도 수식으로 열리지 않게
export async function GET(req:NextRequest){
  await requireAdminContext(['owner','operator','super']);
  const month=req.nextUrl.searchParams.get('month')??'';
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))return NextResponse.json({error:'month required'},{status:400});
  const {rows}=await getAttendanceHistory(month);
  // 시각은 한국 시간, 상태·인증 방식은 한글, 내부 ID 열은 뺀다(2026-11-10 치과원장 QA)
  const lines=[ATTENDANCE_EXPORT_HEADER,...attendanceExportRows(rows)].map(line=>line.map(q).join(','));
  return new NextResponse(`\uFEFF${lines.join('\r\n')}`,{headers:{'content-type':'text/csv; charset=utf-8','content-disposition':csvAttachment(`attendance-${month}.csv`,`근태기록_${month}.csv`)}});
}
