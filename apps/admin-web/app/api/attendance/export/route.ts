import { NextRequest, NextResponse } from 'next/server';
import { requireAdminContext } from '@/lib/admin-auth';
import { getAttendanceHistory } from '@/lib/db/attendance-history';
const q=(v:unknown)=>`"${String(v??'').replaceAll('"','""')}"`;
export async function GET(req:NextRequest){
  await requireAdminContext(['owner','operator','super']);
  const month=req.nextUrl.searchParams.get('month')??'';
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))return NextResponse.json({error:'month required'},{status:400});
  const {rows}=await getAttendanceHistory(month);
  const lines=[['근무일','이름','구분','상태','예정출근','예정퇴근','실제출근','실제퇴근','휴게분','인정근무분','인증방식','수정사유'].map(q).join(','),
    ...rows.map(r=>[r.workDate,r.name,r.kind==='staff'?'등록직원':'공고시프트',r.status,r.scheduledStart,r.scheduledEnd,r.checkInAt,r.checkOutAt,r.breakMinutes,r.workedMinutes,r.method,r.correctionReason].map(q).join(','))];
  return new NextResponse(`\uFEFF${lines.join('\r\n')}`,{headers:{'content-type':'text/csv; charset=utf-8','content-disposition':`attachment; filename="attendance-${month}.csv"`}});
}
