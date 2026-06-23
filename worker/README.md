# DegulDegul API

Cloudflare Workers와 D1을 사용하는 게스트 로그인 및 AI 랭킹 API입니다.

## 파일 구조

- `src/index.js`: HTTP API 라우팅과 CORS 처리
- `src/auth.js`: UID, 세션, 닉네임 처리
- `migrations/0001_auth.sql`: `users`, `sessions` 테이블
- `migrations/0002_profile_color.sql`: 블록 프로필 색상
- `migrations/0003_ai_rankings.sql`: AI 경기 세션, 제출 기록, 최고 기록
- `wrangler.jsonc`: Worker, D1 바인딩, `/api/*` 라우트
- `.dev.vars.example`: 로컬 전용 비밀키 예시

## 보안 방식

- UID는 Worker에서 생성하며 API 응답으로 반환하지 않습니다.
- 브라우저에는 무작위 세션 토큰만 저장합니다.
- D1에는 원본 세션 토큰이 아니라 `SESSION_PEPPER`로 만든 HMAC-SHA256 해시만 저장합니다.
- `SESSION_PEPPER`는 Wrangler secret 또는 로컬 `.dev.vars`로만 설정합니다.
- SQL 값은 모두 D1 prepared statement의 `bind()`로 전달합니다.

## 최초 설정

```powershell
cd worker
npm install
npx wrangler login
npx wrangler d1 create deguldegul-db
```

출력된 `database_id`를 `wrangler.jsonc`의 0으로 된 임시 ID 대신 입력합니다.

비밀키를 생성한 뒤 Cloudflare에 등록합니다.

```powershell
npx wrangler secret put SESSION_PEPPER
```

로컬 개발에서는 `.dev.vars.example`을 `.dev.vars`로 복사하고 실제 임의 문자열로 교체합니다. `.dev.vars`는 Git에 포함되지 않습니다.

## D1 마이그레이션

```powershell
npm run db:migrate:local
npm run db:migrate:remote
```

## 실행 및 배포

```powershell
npm test
npm run dev
npm run deploy
```

배포 후 Worker route `deguldegul.net/api/*`가 활성화되어야 합니다.

## API

- `POST /api/auth/guest`: 새 게스트 UID와 세션 생성
- `GET /api/auth/session`: 저장된 세션으로 자동 로그인
- `POST /api/auth/nickname`: 닉네임 최초 등록
- `POST /api/auth/profile`: 등록 후 프로필 색상 변경
- `POST /api/ai/sessions`: AI 경기 시작용 일회성 제출 세션 발급
- `POST /api/ai/results`: 승리 기록 제출 및 사용자 최고 기록 갱신
- `GET /api/ai/rankings`: 난이도·모드별 TOP 100, 내 최고 기록과 순위
- `GET /api/health`: Worker 상태 확인

클라이언트 응답에는 UID가 포함되지 않습니다.
