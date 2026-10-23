import { NextRequest, NextResponse } from 'next/server';
import { requireAdminContext } from '@/lib/admin-auth';
import { getAttendanceHistory } from '@/lib/db/attendance-history';
const q=(v:unknown)=>`"${String(v??'').replaceAll('"','""')}"`;
export async function GET(req:NextRequest){
  await requireAdminContext(['owner','operator','super']);
  const month=req.nextUrl.searchParams.get('month')??'';
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))return NextResponse.json({error:'month required'},{status:400});
  const {rows}=await getAttendanceHistory(month);
  const lines=[['근무일','이름','구분','상태','예정출근','예정퇴근','실제출근','실제퇴근','휴게분','인정근무분','인증방식','수정사유','시간 기준','근무자ID'].map(q).join(','),
    ...rows.map(r=>[r.workDate,r.name,r.kind==='staff'?'등록직원':'공고근무',r.status,r.scheduledStart,r.scheduledEnd,r.checkInAt,r.checkOutAt,r.recognitionPending?'':r.breakMinutes,r.recognitionPending?'':r.workedMinutes,r.method,r.correctionReason,r.recognitionPending?'정산 전 · 인정시간 미확정':r.kind==='shift'?'저장된 급여 정산 기준':'근태 기록 기준',r.staffId??r.workerId??''].map(q).join(','))];
  return new NextResponse(`\uFEFF${lines.join('\r\n')}`,{headers:{'content-type':'text/csv; charset=utf-8','content-disposition':`attachment; filename="attendance-${month}.csv"`}});
}
