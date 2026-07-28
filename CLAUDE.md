# EweQuity — 프로젝트 컨텍스트

매일 아침 국내외 매크로 경제지표와 경제 뉴스를 한 화면에서 확인하는 개인용 브리핑 대시보드.
2026 클로드 스터디 프로젝트 (양(Ewe) + 주식(Equity)) · 작성자: 양서현.

## 구성

- `Code.js` — 백엔드. Google Apps Script(GAS), API 5종을 프록시 + 캐싱. `clasp`로 관리.
- `index.html` — 프론트엔드. 단일 정적 HTML (목업 데이터로도 바로 열림).
- `docs/` — API 발급 가이드, 배포 가이드, 진행보고서(docx).
- `README.md` — 프로젝트 개요, `SETUP_GUIDE.md` — 로컬 환경 세팅 절차 (이미 완료된 상태).

## 사용 API (5종)

| API | 용도 | 키 필요 |
|---|---|---|
| 한국은행 ECOS | 기준금리(한), 원/달러 환율 | O |
| FRED | 기준금리(미), WTI 유가 | O |
| Yahoo Finance (비공식) | 코스피·나스닥·금·비트코인 시세, 종목 검색 | X |
| Finnhub | 기업 실적 캘린더 | O |
| 네이버 뉴스 검색 | 경제 뉴스 피드 | O |

API 키는 전부 GAS 스크립트 속성(서버 측)에만 저장 — 코드에 하드코딩 금지.

## 작업 흐름

```bash
clasp push      # Code.js 수정사항 → Apps Script 프로젝트 업로드
clasp deploy    # 웹 앱(exec URL)에 새 버전 반영 — push만으론 실제 사이트에 반영 안 됨, 꼭 deploy까지
git add . && git commit -m "설명"
git push        # GitHub(mayqueen120641-tech/ewequity) 백업
```

`index.html`은 정적 파일이라 저장 후 브라우저 새로고침만 하면 됨 (재배포 불필요).

## 알아두어야 할 과거 이슈 (재발 방지용)

- **ECOS 차단**: 한국은행이 GAS 서버 IP를 종종 차단. 이때 에러가 바로 나는 게 아니라 응답이
  올 때까지 **~50초를 매달린다**. 그래서 ECOS는 사용자 요청 경로(`doGet`)에서 완전히 뺐다 —
  아래 "ECOS 백그라운드 갱신" 참고. **ECOS 요청을 `fetchRatesParallel_`에 다시 넣지 말 것.**
- **ECOS 백그라운드 갱신**: 시간 기반 트리거가 30분마다 `refreshEcosCache()`를 실행해 ECOS
  값을 스크립트 속성 `ECOS_CACHE_V1`에 저장하고, `fetchRatesParallel_`은 `readEcosCache_()`로
  그 저장값만 읽는다. 값이 없거나 26시간(`ECOS_MAX_AGE_MS_`) 넘게 낡았으면 기준금리는
  `BASE_RATE_KR_MANUAL`, 환율은 Yahoo(`KRW=X`)로 폴백. 트리거 설치는 Apps Script 편집기에서
  `setupEcosTrigger()`를 한 번 실행(중복 실행해도 안전).
  `BASE_RATE_KR_MANUAL`은 손으로 관리하지 말 것 — ECOS 갱신에 성공할 때마다
  `refreshEcosCache()`가 최신값으로 자동으로 덮어쓴다(방치돼 낡는 사고를 막기 위함).
- **`UrlFetchApp.fetchAll()`의 함정**: `muteHttpExceptions`는 HTTP 4xx/5xx만 막아준다.
  "Address unavailable" 같은 **연결 레벨 오류가 배치에 하나라도 있으면 fetchAll 호출 자체가
  예외를 던져 배치 전체 응답을 잃는다**. `fetchJobsSafe_()`가 배치 실패 시 개별 요청으로
  재시도해 실패를 요청 단위로 격리한다.
- **GAS CacheService 100KB 한도**: Finnhub 캘린더 데이터가 이 한도를 넘기면 요청 전체가 에러남.
  기간/필드를 트리밍하고, 캐시 저장 실패는 무시하도록 방어.
- **차트는 외부 CDN 의존 금지**: Chart.js 로드 실패 이슈 이후 Canvas 2D API 직접 구현
  (`drawDualLineChart_`)으로 전환 완료 — 다시 외부 라이브러리 추가하지 말 것.
- **스크립트 속성 캐시**: GAS가 15분간 이전 값을 반환할 수 있음. `clearAllCaches()` 유틸리티와
  `&nocache=1` 쿼리 옵션으로 우회 가능.
- **캔버스 리사이즈 그리드 버그**: `canvas.width`를 큰 픽셀값으로 재설정하면 CSS Grid가 이를
  트랙 최소 크기에 반영해 옆 패널이 찌부러짐. `.grid2 > .panel { min-width: 0; }`로 해결됨 —
  캔버스 관련 CSS 건드릴 때 주의.
- **한국 종목 검색**: Yahoo Finance 검색이 일부 한국 종목(예: 삼성전자)에서 실패할 수 있음.
  `KOREAN_TICKER_MAP_` 로컬 매핑표로 보강 + query1→query2 도메인 이중화 적용됨.

## 현재 우선순위 (2026-07-28 기준)

기존 기능 신뢰도부터 잡고 신규 기능은 그다음. 순서:

1. ~~**지표 로딩 속도 개선**~~ (2026-07-28 완료) — 지표를 `fetchAll()` 병렬 요청으로 전환하고
   ECOS는 트리거 백그라운드 갱신으로 분리. 실측 **2~3초**로 안정(50초 튐 없음).
   → 남은 할 일: 편집기에서 `setupEcosTrigger()` 1회 실행(트리거 생성 권한 승인 필요라
   clasp로는 불가). 실행하면 `BASE_RATE_KR_MANUAL`도 자동으로 최신값으로 맞춰진다.
2. **경제 캘린더 실데이터 교체** — Finnhub 무료플랜이 샘플데이터를 반환. 소스 교체 또는
   관심 종목 수기 관리 방식 검토.
3. **뉴스 "중요도순" 정렬** — AI 자동 브리핑 기능과 함께 로드맵 단계에서 처리 예정.

## 로드맵 (참고용, 아직 미착수)

- AI 자동 브리핑 (Claude API 연동, `getAIBriefing()` 함수 뼈대만 작성됨)
- 관심종목(워치리스트), 시가총액 상위/급등락 순위
- 다크모드 등 UI 폴리싱
- 매일 아침 이메일 자동 발송
- 계좌 연동(한국투자증권 Open API, 모의투자), 모바일 앱(Flutter) — 기획서 원안 Phase 2
- (선택) GitHub Pages로 index.html 배포
