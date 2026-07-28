# EweQuity

매일 아침 국내외 매크로 경제지표와 경제 뉴스를 한 화면에서 확인하는 개인용 브리핑 대시보드.
2026 클로드 스터디 프로젝트 (양(Ewe) + 주식(Equity)).

## 구성

```
Code.gs      ← Google Apps Script 백엔드 (5개 외부 API 프록시 + 캐싱)
             (SETUP_GUIDE.md의 clasp clone 단계에서 실제 배포본을 받아오면 생김)
index.html   ← 대시보드 프론트엔드 (단일 HTML, 목업 데이터로도 바로 열어볼 수 있음)
docs/        ← API 발급 가이드, 배포 가이드, 진행 보고서
```

## 로컬에서 열어보기

`index.html`을 브라우저로 더블클릭해서 열면 목업(가짜) 데이터로 레이아웃을 바로 확인할 수 있다.
실제 데이터를 보려면 아래 "배포" 과정을 거쳐 `GAS_URL`을 연결해야 한다.

## 개발 방식 (clasp)

이 프로젝트는 [clasp](https://github.com/google/clasp)(구글 공식 Apps Script CLI)로 관리한다.
`Code.gs`를 로컬에서 수정하고 `clasp push`로 Apps Script 프로젝트에 반영한다. 자세한 설치·로그인
방법은 `SETUP_GUIDE.md` 참고.

```bash
clasp push      # 로컬 Code.gs → Apps Script 프로젝트로 업로드
clasp deploy    # 웹 앱(exec URL)에 새 버전 반영 — 코드만 push하면 exec URL엔 반영 안 됨, 꼭 deploy까지
clasp open      # Apps Script 편집기를 브라우저로 열기
```

`index.html`은 정적 파일이라 그냥 저장하고 브라우저 새로고침만 하면 된다. 나중에 GitHub Pages 등에
올리면 다른 기기에서도 접속 가능.

## 사용 중인 API (5종)

| API | 용도 | 키 필요 |
|---|---|---|
| 한국은행 ECOS | 기준금리(한), 원/달러 환율 | O |
| FRED | 기준금리(미), WTI 유가 | O |
| Yahoo Finance (비공식) | 코스피/나스닥/금/비트코인 시세, 종목 검색 | X |
| Finnhub | 기업 실적 캘린더 | O |
| 네이버 뉴스 검색 | 경제 뉴스 피드 | O |

키 발급 방법은 `docs/API_발급_가이드.md`, Apps Script 스크립트 속성 등록 방법은
`docs/배포_가이드.md` 참고.

## 알려진 이슈 / 다음 할 일

- 지표 5개 로딩 속도 개선 (UrlFetchApp 병렬화)
- 경제 캘린더 실데이터 교체 (Finnhub 무료플랜 샘플데이터 이슈)
- 뉴스 "중요도순" 정렬 (현재 최신순만 가능)
- 관심종목(워치리스트), 시가총액 순위, 이메일 자동 발송, 다크모드 등 UI 폴리싱
