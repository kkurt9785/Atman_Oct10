'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { ApplySheet } from '@/components/shifts/ApplySheet';
import { supabase } from '@/lib/supabase';
import type { Shift } from '@/app/shifts/page';
import { dateLabel, facilityName, timeLabel } from '@/lib/shift-display';

declare global {
  interface Window { kakao?: any }
}

type Point = { shift_id:string; lat:number; lng:number };
type Position = { lat:number; lng:number };

function getPosition():Promise<Position|null>{
  return new Promise((resolve)=>{
    if(!navigator.geolocation){ resolve(null); return; }
    navigator.geolocation.getCurrentPosition(
      p=>resolve({lat:p.coords.latitude,lng:p.coords.longitude}),
      ()=>resolve(null),
      {enableHighAccuracy:true,timeout:8000,maximumAge:30000},
    );
  });
}

export default function ShiftMapPage(){
  const mapEl=useRef<HTMLDivElement>(null);
  const mapRef=useRef<any>(null);
  const [shifts,setShifts]=useState<Shift[]>([]);
  const [points,setPoints]=useState<Point[]>([]);
  const [position,setPosition]=useState<Position|null>(null);
  const [selected,setSelected]=useState<Shift|null>(null);
  const [applyTarget,setApplyTarget]=useState<Shift|null>(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');

  useEffect(()=>{void (async()=>{
    const {data:{user}}=await supabase.auth.getUser();
    if(!user){window.location.href='/?next=/map';return;}
    const pos=await getPosition();
    setPosition(pos);
    const {data:rows,error:shiftError}=await supabase.rpc('get_nearby_open_shifts_secure',{
      p_lat:pos?.lat??null,p_lng:pos?.lng??null,p_pref_labels:null,
    });
    if(shiftError){setError('지도에 표시할 공고를 불러오지 못했어요.');setLoading(false);return;}
    const mapped=((rows??[]) as Record<string,unknown>[]).map(row=>({
      ...row,
      facilities:{name:row.facility_name as string,address_text:row.address_text as string|null},
      distance_km:typeof row.distance_m==='number'?row.distance_m/1000:null,
    })) as unknown as Shift[];
    setShifts(mapped);
    if(mapped.length){
      const {data:coords,error:pointError}=await supabase.rpc('get_shift_map_points_secure',{p_shift_ids:mapped.slice(0,100).map(s=>s.id)});
      if(pointError)setError('병원 위치를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.');
      else setPoints((coords??[]) as Point[]);
    }
    setLoading(false);
  })();},[]);

  useEffect(()=>{
    if(loading||!mapEl.current)return;
    const key=process.env.NEXT_PUBLIC_KAKAO_JS_KEY;
    if(!key){setError('지도 서비스 키가 설정되지 않았어요.');return;}
    const draw=()=>{
      window.kakao.maps.load(()=>{
        if(!mapEl.current)return;
        const center=position??points[0]??{lat:37.5665,lng:126.9780};
        const map=new window.kakao.maps.Map(mapEl.current,{center:new window.kakao.maps.LatLng(center.lat,center.lng),level:6});
        mapRef.current=map;
        if(position){
          const content='<div style="width:18px;height:18px;border:4px solid white;border-radius:50%;background:#3182F6;box-shadow:0 1px 5px #555"></div>';
          new window.kakao.maps.CustomOverlay({map,position:new window.kakao.maps.LatLng(position.lat,position.lng),content,yAnchor:.5,xAnchor:.5});
        }
        points.forEach(point=>{
          const shift=shifts.find(s=>s.id===point.shift_id);
          if(!shift)return;
          const marker=new window.kakao.maps.Marker({map,position:new window.kakao.maps.LatLng(point.lat,point.lng)});
          window.kakao.maps.event.addListener(marker,'click',()=>setSelected(shift));
        });
      });
    };
    if(window.kakao?.maps){draw();return;}
    const existing=document.querySelector<HTMLScriptElement>('script[data-atman-kakao-map]');
    if(existing){existing.addEventListener('load',draw,{once:true});return;}
    const script=document.createElement('script');
    script.dataset.atmanKakaoMap='true';
    script.src=`https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(key)}&autoload=false`;
    script.async=true;script.onload=draw;script.onerror=()=>setError('지도를 불러오지 못했어요.');
    document.head.appendChild(script);
  },[loading,points,position,shifts]);

  function moveToMe(){
    if(position&&mapRef.current)mapRef.current.panTo(new window.kakao.maps.LatLng(position.lat,position.lng));
  }

  return <main className="min-h-screen bg-bg pb-24">
    <header className="px-5 pt-10 pb-4 bg-white flex items-end justify-between"><div><p className="text-[13px] font-bold text-primary">내 주변 병원</p><h1 className="text-[26px] font-extrabold">공고 지도</h1></div><Link href="/shifts" className="h-10 px-4 rounded-xl border border-line flex items-center text-[13px] font-bold">목록 보기</Link></header>
    <div className="relative">
      <div ref={mapEl} className="h-[calc(100vh-190px)] min-h-[480px] bg-[#eef2f5]"/>
      {loading&&<div className="absolute inset-0 bg-white/80 flex items-center justify-center text-sub">지도를 준비하고 있어요...</div>}
      {position&&<button onClick={moveToMe} className="absolute right-4 top-4 w-11 h-11 rounded-full bg-white shadow-card text-xl" aria-label="현재 위치">◎</button>}
      <div className="absolute left-4 top-4 rounded-full bg-white/95 shadow px-3 py-2 text-[12px] font-bold">공고 {shifts.length}건</div>
    </div>
    {error&&<p role="alert" className="mx-4 mt-3 rounded-xl bg-red-50 text-red-600 p-3 text-[13px] font-bold">{error}</p>}
    {selected&&<section className="fixed bottom-[72px] inset-x-4 mx-auto max-w-[440px] z-20 bg-white rounded-2xl shadow-xl p-4"><button onClick={()=>setSelected(null)} className="absolute right-4 top-3 text-sub">✕</button><p className="text-[12px] text-primary font-bold">{dateLabel(selected.shift_date)} · {timeLabel(selected)}</p><h2 className="text-[17px] font-extrabold mt-1 pr-6">{facilityName(selected)}</h2><p className="text-[13px] text-sub mt-1">{selected.department??'부서 협의'} · 약 {selected.distance_km?.toFixed(1)??'-'}km</p><div className="flex items-center justify-between mt-3 pt-3 border-t border-line"><b className="text-[18px]">₩{selected.estimated_total_pay.toLocaleString('ko-KR')}</b><button onClick={()=>setApplyTarget(selected)} className="h-11 px-5 rounded-xl bg-primary text-white font-bold">지원하기</button></div></section>}
    {applyTarget&&<ApplySheet shift={applyTarget} onClose={()=>setApplyTarget(null)} onApplied={()=>{setShifts(v=>v.filter(s=>s.id!==applyTarget.id));setPoints(v=>v.filter(p=>p.shift_id!==applyTarget.id));setApplyTarget(null);setSelected(null);}}/>}
  </main>;
}
