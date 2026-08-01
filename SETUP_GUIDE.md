# 맥에서 클로드 코드 + git + clasp 세팅하기

여기 있는 명령어들은 **맥의 터미널 앱(Terminal.app)**에서 실행하는 거예요. Cowork 대화창이 아니라
진짜 터미널을 열어서 하나씩 복사-붙여넣기 하시면 됩니다. (Spotlight에서 "터미널" 검색하면 나와요)

막히는 단계 있으면 그 화면 스크린샷 찍어서 저한테 보여주세요.

---

## 0단계 — 이 폴더로 이동

터미널을 열고 아래 명령어로 이 프로젝트 폴더로 이동하세요.

```bash
cd ~/Documents/EweQuity
```

## 1단계 — Node.js 확인

```bash
node -v
```

버전 숫자가 나오면 이미 설치돼 있는 거예요 (18 이상이면 OK). "command not found"가 뜨면
https://nodejs.org 에서 LTS 버전을 받아 설치하세요.

## 2단계 — 클로드 코드 설치

```bash
npm install -g @anthropic-ai/claude-code
```

설치 후 아래처럼 실행하면 이 폴더를 기준으로 클로드 코드가 시작돼요.

```bash
claude
```

처음 실행하면 로그인(구독 계정) 화면이 뜰 거예요. 안내대로 진행하시면 됩니다.

## 3단계 — git 확인 + 초기화

맥에는 보통 git이 기본으로 깔려있어요.

```bash
git --version
```

버전이 안 나오면 설치 창이 자동으로 뜰 거예요(Xcode Command Line Tools), 그대로 설치 진행.

이 폴더를 git 저장소로 만들기:

```bash
git init
git add .
git commit -m "EweQuity 프로젝트 시작"
```

이제부터는 뭔가 바꿀 때마다 `git add . && git commit -m "설명"` 해두면, 나중에 문제가 생겨도
`git log`로 이력을 보고 `git checkout`으로 예전 버전으로 되돌릴 수 있어요. (오늘 겪었던,
작업 중이던 파일이 갑자기 사라지는 사고를 이제 걱정 안 해도 돼요.)

## 4단계 — GitHub 저장소 만들기 (백업용, 선택이지만 추천)

1. https://github.com/signup 에서 계정 생성
2. 로그인 후 우측 상단 "+" → "New repository" → 이름 `ewequity` → Create (Public/Private 아무거나)
3. 터미널에서:

```bash
git remote add origin https://github.com/{본인아이디}/ewequity.git
git branch -M main
git push -u origin main
```

이후 커밋할 때마다 `git push`로 GitHub에도 백업돼요.

## 5단계 — clasp 설치 (Apps Script를 터미널에서 다루는 도구)

```bash
npm install -g @google/clasp
clasp login
```

`clasp login`을 실행하면 브라우저가 자동으로 열리면서 구글 로그인 화면이 떠요. Apps Script를
만들 때 쓴 구글 계정으로 로그인하고 권한을 승인하세요.

## 6단계 — 기존 Apps Script 프로젝트와 연결하기

이미 만들어둔 Apps Script 프로젝트(Code.gs가 배포되어 있는 그 프로젝트)를 연결할 거예요.
**"스크립트 ID"**가 필요한데, 아래에서 찾을 수 있어요.

1. https://script.google.com 접속 → EweQuity 프로젝트 열기
2. 왼쪽 톱니바퀴 아이콘("프로젝트 설정") 클릭
3. "스크립트 ID" 값 복사 (배포 URL에 있는 `AKfycb...`가 아니라, 이 페이지에 따로 있는 값이에요 —
   보통 알파벳/숫자가 더 길어요)

터미널에서:

```bash
clasp clone {복사한_스크립트_ID}
```

지금 실제로 배포되어 있는(가장 최신의) `Code.gs`가 이 폴더로 내려받아질 거예요. 이 폴더에는
아직 `Code.gs`가 없는 상태라 그대로 받으면 돼요 — 이 파일이 지금부터 "진짜 원본"이 됩니다.

## 이후 작업 흐름

```bash
claude              # 이 폴더에서 클로드 코드로 대화하며 개발
clasp push           # Code.gs 수정 사항을 Apps Script 프로젝트에 업로드
clasp deploy          # 실제 웹 앱(exec URL)에 새 버전으로 반영 — 이거 안 하면 push만으론 실제 사이트에 반영 안 됨
git add . && git commit -m "설명"   # 버전 기록
git push              # GitHub 백업 (원격 저장소 연결했다면)
```

`index.html`은 그냥 파일 저장하고 브라우저 새로고침하면 바로 반영돼요 (재배포 필요 없음).

---

# 구글 로그인 설정 (선택)

로그인을 켜면 관심 종목·포트폴리오가 계정에 저장돼서 폰과 노트북에서 같이 보여요.
**비밀번호는 받지도 저장하지도 않습니다** — 구글이 신원 확인을 대신 해주고, 우리는
그 결과만 확인합니다.

> ⚠️ **먼저 알아둘 것**: 구글 로그인은 `https://` 주소에서만 동작합니다.
> 지금처럼 파일을 더블클릭해서 여는 방식(`file:///...`)에서는 **로그인 버튼이 안 뜹니다.**
> 그래서 GitHub Pages를 먼저 켜야 해요.

## 1단계 — GitHub Pages 켜기

1. GitHub 저장소 → **Settings** → 왼쪽 **Pages**
2. Source를 **Deploy from a branch**, 브랜치는 **main / (root)** 로 저장
3. 몇 분 뒤 `https://{아이디}.github.io/ewequity/` 로 접속되는지 확인

이 주소를 아래에서 계속 씁니다.

## 2단계 — 구글 클라이언트 ID 발급

1. https://console.cloud.google.com 접속
2. 상단에서 프로젝트 만들기 (이름은 아무거나, 예: `ewequity`)
3. 왼쪽 메뉴 **API 및 서비스 → OAuth 동의 화면**
   - User Type: **외부** 선택 → 만들기
   - 앱 이름 `EweQuity`, 사용자 지원 이메일과 개발자 이메일에 본인 메일 입력 → 저장
   - **테스트 사용자**에 로그인할 사람들의 지메일 주소를 추가하세요.
     (게시 전에는 여기 등록된 사람만 로그인할 수 있어요. 지인 몇 명이면 이걸로 충분합니다.)
4. 왼쪽 메뉴 **사용자 인증 정보 → 사용자 인증 정보 만들기 → OAuth 클라이언트 ID**
   - 애플리케이션 유형: **웹 애플리케이션**
   - **승인된 자바스크립트 원본**에 아래를 추가:
     - `https://{아이디}.github.io`
   - 만들기를 누르면 **클라이언트 ID**가 나옵니다 (`....apps.googleusercontent.com`)

> 클라이언트 ID는 **비밀값이 아닙니다.** 코드에 그대로 넣어도 됩니다 —
> 구글이 위에 등록한 주소에서만 동작하게 막아주기 때문이에요.
> (같이 나오는 **클라이언트 보안 비밀번호는 이 방식에선 쓰지 않으니 무시**하세요.)

## 3단계 — 사용자 데이터를 저장할 스프레드시트 만들기

1. https://sheets.google.com 에서 새 스프레드시트 만들기 (이름 예: `EweQuity 사용자`)
2. 주소창에서 ID를 복사
   `https://docs.google.com/spreadsheets/d/`**`이_부분이_ID`**`/edit`

> 이 시트에는 이메일과 닉네임이 저장됩니다. **공유 설정을 "링크가 있는 모든 사용자"로
> 바꾸지 마세요.** 본인만 볼 수 있게 두면 됩니다.

## 4단계 — 값 넣기

**Apps Script 스크립트 속성**에 두 개 추가:

| 속성 이름 | 값 |
|---|---|
| `GOOGLE_CLIENT_ID` | 2단계에서 받은 클라이언트 ID |
| `USER_SHEET_ID` | 3단계에서 복사한 스프레드시트 ID |

**`index.html`** 위쪽의 이 줄에도 같은 클라이언트 ID를 넣습니다:

```js
const GOOGLE_CLIENT_ID = "";   // ← 여기에 붙여넣기
```

넣었으면 `clasp push && clasp deploy -i {배포ID}` 하고, `index.html`은 커밋해서 push하면 끝입니다.

## 확인

GitHub Pages 주소로 접속했을 때 왼쪽 아래에 구글 로그인 버튼이 뜨면 성공입니다.
로그인하면 닉네임이 보이고, 관심 종목을 담은 뒤 다른 기기에서 같은 계정으로 들어가면
그대로 따라옵니다.

안 되면 브라우저 개발자 도구(F12) 콘솔을 보세요. 대부분 **승인된 자바스크립트 원본**에
주소를 안 넣었거나, 끝에 `/`를 붙여서 생기는 문제입니다.
