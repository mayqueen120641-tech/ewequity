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
