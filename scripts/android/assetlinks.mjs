#!/usr/bin/env node
// 잇닿 근무자 앱 — Digital Asset Links 파일(assetlinks.json)을 만들어요. 의존성 없음.
//
// 사용법: node scripts/android/assetlinks.mjs <SHA256> [<SHA256> ...] [--out <경로>]
//
//   <SHA256>  앱 서명 인증서의 SHA-256 지문. 보통 두 개를 넣어요.
//             1) Play Console '앱 서명 키' 지문 — Play 에서 받은 앱용 (꼭 필요해요)
//             2) 업로드 키 지문 — 직접 만든 APK 를 설치해 테스트할 때용
//             AB:CD:… / abcd… / "SHA256: AB:CD:…" 어떤 모양이든 받아서 대문자·콜론 형식으로 바꿔요.
//   --out     저장할 경로. 기본은 apps/worker-web/public/.well-known/assetlinks.json 이에요.
//
// 패키지 이름은 apps/worker-android/twa-manifest.json 의 packageId 에서 읽어요(그곳 한 곳에서만 정해요).
// 같은 경로에 파일이 있으면 이번에 넣은 지문으로 새로 써요(합치지 않아요).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..', '..');
const twaManifestPath = resolve(repoRoot, 'apps/worker-android/twa-manifest.json');
const workerPublicDir = resolve(repoRoot, 'apps/worker-web/public');
const defaultOut = resolve(workerPublicDir, '.well-known/assetlinks.json');

function usage() {
  console.log(`사용법: node scripts/android/assetlinks.mjs <SHA256> [<SHA256> ...] [--out <경로>]

  <SHA256>  앱 서명 인증서 SHA-256 지문 (Play '앱 서명 키' 지문은 꼭 넣어야 해요)
  --out     저장할 경로 (기본: ${relative(process.cwd(), defaultOut) || defaultOut})`);
}

function fail(message) {
  console.error(`[오류] ${message}`);
  process.exit(1);
}

// "SHA256: AB:CD:…", "ab cd …", "abcd…(64자)" → "AB:CD:…"
export function normalizeFingerprint(input) {
  const text = String(input).trim().replace(/^sha-?256\s*(fingerprint)?\s*[:=]?\s*/i, '');
  const parts = text.split(/[\s:]+/).filter(Boolean);
  let hex;
  if (parts.length === 1) {
    hex = parts[0];
  } else {
    if (!parts.every((p) => /^[0-9a-fA-F]{2}$/.test(p))) {
      throw new Error(`두 글자씩 끊긴 16진수가 아니에요: ${input}`);
    }
    hex = parts.join('');
  }
  if (!/^[0-9a-fA-F]+$/.test(hex)) throw new Error(`16진수가 아닌 글자가 있어요: ${input}`);
  if (hex.length === 40) throw new Error(`SHA-1 지문(20바이트) 같아요. SHA-256 지문(32바이트)을 넣어 주세요: ${input}`);
  if (hex.length !== 64) {
    throw new Error(`SHA-256 지문은 32바이트(16진수 64자리)여야 해요. 지금은 16진수 ${hex.length}자리예요: ${input}`);
  }
  return hex.toUpperCase().match(/../g).join(':');
}

function readPackageId() {
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(twaManifestPath, 'utf8'));
  } catch (error) {
    fail(`twa-manifest.json 을 읽지 못했어요: ${twaManifestPath} (${error.message})`);
  }
  const packageId = manifest.packageId;
  if (typeof packageId !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/.test(packageId)) {
    fail(`twa-manifest.json 의 packageId 가 올바르지 않아요: ${packageId}`);
  }
  return packageId;
}

function main(argv) {
  let out = null;
  const rawFingerprints = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') {
      usage();
      return;
    }
    if (arg === '--out') {
      out = argv[i + 1];
      i += 1;
      if (!out) fail('--out 다음에 저장할 경로를 적어 주세요.');
      continue;
    }
    if (arg.startsWith('--out=')) {
      out = arg.slice('--out='.length);
      if (!out) fail('--out= 다음에 저장할 경로를 적어 주세요.');
      continue;
    }
    if (arg.startsWith('-')) fail(`알 수 없는 옵션이에요: ${arg}`);
    rawFingerprints.push(arg);
  }

  if (rawFingerprints.length === 0) {
    usage();
    fail('SHA-256 지문을 하나 이상 적어 주세요.');
  }

  const fingerprints = [];
  for (const raw of rawFingerprints) {
    let normalized;
    try {
      normalized = normalizeFingerprint(raw);
    } catch (error) {
      fail(error.message);
    }
    if (fingerprints.includes(normalized)) {
      console.warn(`[알림] 같은 지문이 두 번 들어와서 하나만 넣었어요: ${normalized}`);
      continue;
    }
    fingerprints.push(normalized);
  }

  const packageId = readPackageId();
  const statements = [
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: {
        namespace: 'android_app',
        package_name: packageId,
        sha256_cert_fingerprints: fingerprints,
      },
    },
  ];
  const json = `${JSON.stringify(statements, null, 2)}\n`;

  const usingDefault = out === null;
  const outPath = usingDefault ? defaultOut : resolve(process.cwd(), out);
  if (usingDefault && !existsSync(workerPublicDir)) {
    fail(`worker-web 의 public 폴더가 없어요: ${workerPublicDir}`);
  }
  const replaced = existsSync(outPath);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, json);

  console.log(`assetlinks.json 을 ${replaced ? '새로 썼어요' : '만들었어요'}: ${outPath}`);
  console.log(`  패키지: ${packageId}`);
  console.log(`  지문 ${fingerprints.length}개`);
  console.log('');
  process.stdout.write(json);
  console.log('');
  console.log('Play 에서 받은 앱이 주소창 없이 열리려면 Play Console \'앱 서명 키\' SHA-256 이 꼭 들어 있어야 해요.');
  if (usingDefault) {
    console.log('다음: worker-web 을 배포한 뒤 아래 두 주소를 확인하세요.');
    console.log('  https://itdot.co.kr/.well-known/assetlinks.json');
    console.log('  https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://itdot.co.kr&relation=delegate_permission/common.handle_all_urls');
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
