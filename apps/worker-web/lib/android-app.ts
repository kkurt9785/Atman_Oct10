// Play 스토어 앱(apps/worker-android — 이 사이트를 감싼 TWA). packageId 는 스토어에 올린 뒤 바꿀 수 없다.
// 스토어 공개가 끝나면 live 를 true 로 바꾼다 — 안드로이드 설치 안내가 'Play 스토어에서 받기'로 바뀐다.
export const ANDROID_APP = { packageId: 'kr.co.itdot.worker', live: false } as const;
export const PLAY_STORE_URL = `https://play.google.com/store/apps/details?id=${ANDROID_APP.packageId}`;
