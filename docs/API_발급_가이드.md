# EweQuity — API 5종 발급 가이드

기획서 1주차 목표(API 5종 발급 + 지표 5개 실데이터 표시)를 위한 가이드예요. 전부 **무료 가입**으로 발급 가능합니다. 순서대로 하나씩 진행하면 돼요.

---

## 1. 한국은행 ECOS API (기준금리, 원/달러 환율)

1. https://ecos.bok.or.kr/api/ 접속 → 회원가입 (일반 이메일 가입 가능)
2. 로그인 후 "Open API 이용신청" 메뉴에서 인증키 신청
3. 승인은 보통 즉시~수분 내 완료, 발급된 **인증키(40자리 영숫자)**를 복사해둘 것

**사용할 통계표/항목 코드**
- 한국 기준금리: 통계표코드 `722Y001`, 항목코드 `0101000`
- 원/달러 환율(매매기준율): 통계표코드 `731Y001`, 항목코드 `0000001`

**요청 URL 형식**
```
https://ecos.bok.or.kr/api/StatisticSearch/{인증키}/json/kr/1/10/722Y001/D/20260601/20260708/0101000
```
(주기 `D`=일, `M`=월, `A`=연. 순서대로: 인증키/응답형식/언어/시작행/끝행/통계표코드/주기/시작일자/종료일자/항목코드)

> ⚠️ 통계표코드는 한국은행이 개편 시 변경될 수 있어요. 위 값으로 응답이 비어있으면 ECOS 사이트에서 "통계검색 → 100대 지표"로 직접 검색해 최신 코드를 확인하세요.

---

## 2. FRED API (미국 기준금리, WTI 유가)

1. https://fred.stlouisfed.org 접속 → 회원가입 (My Account 생성)
2. 로그인 후 https://fred.stlouisfed.org/docs/api/api_key.html 에서 API Key 신청 (즉시 발급)

**사용할 시리즈 ID**
- 미국 기준금리(Effective Federal Funds Rate): `FEDFUNDS`
- WTI 유가(WTI Crude Oil Price): `DCOILWTICO`

**요청 URL 형식**
```
https://api.stlouisfed.org/fred/series/observations?series_id=FEDFUNDS&api_key={API키}&file_type=json&sort_order=desc&limit=2
```

---

## 3. 코스피 / 나스닥 지수 — Yahoo Finance (키 불필요, 우선 추천)

Alpha Vantage는 미국 개별 종목엔 강하지만 코스피 같은 해외 지수는 커버리지가 약해요. 대신 **Yahoo Finance의 비공식 차트 API**를 쓰면 API 키 없이 바로 조회 가능합니다 (단, 비공식이라 가끔 응답 포맷이 바뀔 수 있어요).

**심볼**
- 코스피: `^KS11`
- 나스닥종합: `^IXIC`

**요청 URL 형식**
```
https://query1.finance.yahoo.com/v8/finance/chart/^KS11?interval=1d&range=5d
```

키가 필요 없어서 발급 절차는 없지만, 혹시 나중에 막히면 대안으로 Alpha Vantage(https://www.alphavantage.co/support/#api-key, 이메일만으로 즉시 발급)를 병행 등록해두면 안전합니다.

---

## 4. Finnhub API (기업 실적 캘린더)

1. https://finnhub.io/register 접속 → 이메일로 가입
2. 가입 즉시 대시보드에서 **API Key** 확인 가능 (무료 플랜, 분당 60회 제한)

**요청 URL 형식**
```
https://finnhub.io/api/v1/calendar/earnings?from=2026-07-08&to=2026-08-07&token={API키}
```

---

## 5. 네이버 뉴스 검색 API

1. https://developers.naver.com/apps/#/register 접속 (네이버 계정 로그인)
2. "애플리케이션 등록" → 애플리케이션 이름 입력 → 사용 API에서 **검색** 선택
3. 비로그인 오픈 API 서비스 환경 → "WEB 설정"에 아무 URL이나 입력(예: http://localhost) 후 등록
4. 등록 완료 후 **Client ID / Client Secret** 확인

**요청 URL 형식** (Header 인증 필요)
```
GET https://openapi.naver.com/v1/search/news.json?query=경제&display=10&sort=date
Header: X-Naver-Client-Id: {Client ID}
Header: X-Naver-Client-Secret: {Client Secret}
```

---

## 발급 후 할 일

5개 키를 모두 받으면, Google Apps Script 프로젝트의 **스크립트 속성**에 아래 이름으로 저장하세요 (코드에 직접 넣지 않는 게 기획서의 보안 원칙이에요).

| 속성 이름 | 값 |
|---|---|
| ECOS_API_KEY | 한국은행 인증키 |
| FRED_API_KEY | FRED API Key |
| FINNHUB_API_KEY | Finnhub API Key |
| NAVER_CLIENT_ID | 네이버 Client ID |
| NAVER_CLIENT_SECRET | 네이버 Client Secret |

저장 방법은 `배포_가이드.md`에 스크린샷 대신 단계별로 정리해뒀어요.
