# 새 PC에서 잇닿(atman) 작업 환경 만들기

비밀값(키·비밀번호)은 이 문서에 없다. 값은 전부 **Vercel에서 내려받는다**(`vercel env pull`). 2026-10-23 기준, 메인 맥과 같은 상태가 된다.

## 1. 필요한 계정 (본인 로그인)
| 서비스 | 용도 | 식별자 |
|---|---|---|
| GitHub | 코드 | `git@github.com:kkurt9785/Atman_Oct10.git` (SSH 키 등록 필요) |
| Vercel | 배포·환경변수 | 팀 `team_qclSkIYfTKm2eWzlDGLCv5Hd` |
| Supabase | 운영 DB | 프로젝트 ref `nkhwyiwegyhtiwggdoyg` |
| 카카오 개발자 | OAuth 키 변경 때만 | – |

## 2. 설치
- git, Node.js 20 이상(메인 맥은 26), npm
- `npm i -g vercel`
- Supabase CLI (`brew install supabase/tap/supabase`, 윈도우는 `scoop install supabase`)
- Docker Desktop — 로컬 DB를 띄울 때만(대부분 필요 없음, 4장 참고)

## 3. 코드와 환경변수
```bash
git clone git@github.com:kkurt9785/Atman_Oct10.git ~/atman
cd ~/atman

# 앱마다 따로 설치한다(루트 package.json 없음)
(cd apps/worker-web && npm install)
(cd apps/admin-web && npm install)

vercel login

# 앱 ↔ Vercel 프로젝트 연결
(cd apps/worker-web && vercel link --yes --team team_qclSkIYfTKm2eWzlDGLCv5Hd --project itdot)      # itdot.co.kr
(cd apps/admin-web  && vercel link --yes --team team_qclSkIYfTKm2eWzlDGLCv5Hd --project admin-web)  # admin.itdot.co.kr

# 환경변수 내려받기 → 각 앱 .env.local 생성(.gitignore 대상)
(cd apps/worker-web && vercel env pull .env.local --environment=production --yes)
(cd apps/admin-web  && vercel env pull .env.local --environment=production --yes)
```
- 내려받는 값은 **운영 값**이다. 메인 맥도 로컬 개발이 운영 Supabase(`nkhwyiwegyhtiwggdoyg`)를 바라본다. 로컬에서 데이터를 만들거나 지우면 운영에 반영된다.
- `VERCEL_GIT_*`·`VERCEL_URL` 줄은 빈 값으로 들어오는데 무시해도 된다.
- 새 키를 추가할 때는 Vercel에 먼저 넣고(`vercel env add`) 다른 PC에서 다시 pull 한다. `.env.local`만 고치면 PC끼리 어긋난다.

## 4. DB(Supabase)
```bash
cd ~/atman
supabase login
supabase link --project-ref nkhwyiwegyhtiwggdoyg   # DB 비밀번호는 Supabase 대시보드 → Settings → Database
```
- 마이그레이션 반영 순서: `supabase db push --linked --dry-run` 으로 대상 확인 → `supabase db push --linked` → 그다음 앱 배포. (admin 서버 조회가 새 테이블이 없으면 오류)
- **로컬 DB는 처음부터 재현이 안 된다**(옛 마이그레이션 순서 문제). 로컬 DB가 꼭 필요하면 `docs/LOCAL_VERIFICATION_GUIDE.md`, 운영 절차는 `docs/SUPABASE_PRODUCTION_GUIDE.md`.

## 5. 실행
```bash
(cd apps/worker-web && npm run dev)   # http://localhost:3003
(cd apps/admin-web  && npm run dev)   # http://localhost:3002
```

## 6. 배포
- **커밋 후 앱마다 `vercel --prod`.** git push 로는 배포되지 않는다.
  - worker: `cd apps/worker-web && vercel --prod` → 프로젝트 itdot / itdot.co.kr
  - admin: `cd apps/admin-web && vercel --prod` → 프로젝트 admin-web / admin.itdot.co.kr
- DB 변경이 있으면 4장 순서대로 DB 먼저.

## 7. 주의
- `git add .` 금지 — 대용량 산출물(docs/ir, output 등)이 섞인다. 바꾼 파일만 골라서 추가.
- 루트 `.vercel/project.json`(프로젝트 `atman`)은 예전 연결이다. 배포는 앱 폴더에서만.
- Claude Code 메모리(작업 기록)는 PC에 따로 저장된다. 메인 맥의 `~/.claude/projects/-Users-kihankim-atman/memory/` 를 새 PC의 같은 위치(경로 이름은 그 PC의 사용자·폴더명에 맞춰 바뀜)로 복사하면 이어서 쓸 수 있다.
