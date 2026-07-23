'use client';

export function PrintButton(){
  return <button type="button" onClick={()=>window.print()} className="mt-5 w-full h-12 rounded-xl bg-primary text-white font-bold print:hidden">인쇄하기</button>;
}
