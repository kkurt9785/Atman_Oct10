'use client';
import {useEffect,useState} from 'react';
export type InstallPrompt=Event&{prompt:()=>Promise<void>;userChoice:Promise<{outcome:'accepted'|'dismissed'}>};
export function installPlatform(userAgent:string,maxTouchPoints=0){return {ios:/iphone|ipad|ipod/i.test(userAgent)||(/Macintosh/i.test(userAgent)&&maxTouchPoints>1),inApp:/KAKAOTALK|Instagram|FBAN|FBAV|NAVER\(inapp|; wv\)/i.test(userAgent)};}
export function createInstallController(){
  let prompt:InstallPrompt|null=null;
  let state={available:false,busy:false,pending:false,installed:false,error:''};
  const listeners=new Set<()=>void>();
  const update=(patch:Partial<typeof state>)=>{state={...state,...patch};listeners.forEach(listener=>listener());};
  return {
    snapshot:()=>state,
    subscribe:(listener:()=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener);};},
    offer:(event:InstallPrompt)=>{event.preventDefault();prompt=event;update({available:true,pending:false,error:''});},
    installed:()=>{prompt=null;update({installed:true,pending:false,available:false,busy:false,error:''});},
    async install(){
      if(state.busy||!prompt)return;
      const event=prompt;prompt=null;update({busy:true,available:false,error:''});
      try{await event.prompt();const {outcome}=await event.userChoice;if(!state.installed)update({pending:outcome==='accepted'});}
      catch{if(!state.installed)update({error:'설치 창을 열지 못했어요. 브라우저 메뉴의 설치 기능을 이용해 주세요.'});}
      finally{update({busy:false});}
    },
  };
}
const controller=createInstallController();
let initialized=false;
export function usePwaInstall(){
  const [state,setState]=useState(controller.snapshot),[platform,setPlatform]=useState({ios:false,inApp:false}),[ready,setReady]=useState(false);
  useEffect(()=>{
    const unsubscribe=controller.subscribe(()=>setState(controller.snapshot()));
    setPlatform(installPlatform(navigator.userAgent,navigator.maxTouchPoints));
    if(!initialized){initialized=true;window.addEventListener('beforeinstallprompt',event=>controller.offer(event as InstallPrompt));window.addEventListener('appinstalled',()=>controller.installed());}
    if(window.matchMedia('(display-mode: standalone)').matches||(navigator as Navigator&{standalone?:boolean}).standalone)controller.installed();
    setState(controller.snapshot());setReady(true);return unsubscribe;
  },[]);
  return {...state,...platform,ready,install:controller.install};
}
