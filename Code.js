function doGet(e) {
  const action = (e && e.parameter && e.parameter.action) || 'rates';
  // 테스트/디버깅용: URL 끝에 &nocache=1 을 붙이면 캐시를 건너뛰고 무조건 새로 가져온다.
  // (스크립트 속성 값을 바꾼 직후 바로 확인하고 싶을 때 유용함)
  const noCache = !!(e && e.parameter && e.parameter.nocache);
  let result;
  try {
    switch (action) {
      case 'rates':
        result = getRates(noCache);
        break;
      case 'history':
        result = getHistory((e.parameter && e.parameter.range) || '3M', noCache);
        break;
      case 'calendar':
        result = getCalendar(noCache);
        break;
      case 'news':
        result = getNews((e.parameter && e.parameter.category) || 'all', noCache);
        break;
      case 'quote':
        result = getQuote((e.parameter && e.parameter.symbol) || '', noCache);
        break;
      default:
        result = { error: 'unknown action: ' + action };
    }
  } catch (err) {
    result = { error: String(err) };
  }
  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * 캐시를 한 번에 비우는 유틸리티. 스크립트 속성을 바꾼 직후 15분씩 기다리기
 * 싫을 때, Apps Script 에디터 상단 함수 선택 드롭다운에서 이 함수를 고르고
 * ▶ 실행 버튼을 한 번 눌러주면 즉시 캐시가 비워진다. (웹 앱 재배포 필요 없음)
 */
function clearAllCaches() {
  const keys = [
    'rates', 'history_1M', 'history_3M', 'history_1Y', 'calendar',
    'news_all', 'news_world', 'news_domestic', 'news_politics_domestic', 'news_politics_intl'
  ];
  CacheService.getScriptCache().removeAll(keys);
  Logger.log('캐시 초기화 완료');
}

// ================= 공통 유틸 =================
function getProp_(key) {
  const v = PropertiesService.getScriptProperties().getProperty(key);
  if (!v) throw new Error('스크립트 속성에 ' + key + ' 가 설정되어 있지 않습니다.');
  return v;
}

function cacheGet_(key) {
  const v = CacheService.getScriptCache().get(key);
  return v ? JSON.parse(v) : null;
}

function cachePut_(key, value, seconds) {
  // GAS 캐시는 최대 21600초(6시간), 값 용량은 100KB 제한.
  // 캐싱은 성능 최적화일 뿐 필수 기능이 아니므로, 실패해도 전체 응답이 깨지지 않도록 무시한다.
  try {
    CacheService.getScriptCache().put(key, JSON.stringify(value), Math.min(seconds, 21600));
  } catch (err) {
    console.log('cachePut_(' + key + ') 캐시 저장 실패(무시): ' + err);
  }
}

function fetchJson_(url, options) {
  const res = UrlFetchApp.fetch(url, Object.assign({ muteHttpExceptions: true }, options || {}));
  const code = res.getResponseCode();
  const text = res.getContentText();
  if (code >= 400) throw new Error('요청 실패(' + code + '): ' + url);
  return JSON.parse(text);
}

// ================= 1. 지표 8종 (기준금리 한/미, 환율, 유가, 코스피, 나스닥, 금, 비트코인) =================
function getRates(noCache) {
  const cached = noCache ? null : cacheGet_('rates');
  if (cached) return cached;

  const data = fetchRatesParallel_();
  data.updatedAt = new Date().toISOString();
  cachePut_('rates', data, 900); // 15분 캐시
  return data;
}

// 지표를 UrlFetchApp.fetchAll()로 한 번에 병렬 요청한다. 예전엔 하나씩 순차로 fetch()해서
// 첫 로딩이 오래 걸렸는데, 병렬화하면 전체 응답 시간이 "가장 느린 요청 1개" 수준으로 줄어든다.
//
// ECOS(기준금리·환율)는 여기서 요청하지 않는다. GAS 서버가 차단당하면 에러가 바로 나는 게
// 아니라 응답을 기다리며 ~50초를 매달려서, 사용자 요청 경로에 두면 그 시간을 그대로 물게 된다.
// 대신 시간 기반 트리거가 refreshEcosCache()로 백그라운드에서 미리 받아 스크립트 속성에
// 저장해두고, 여기서는 그 저장값만 읽는다(readEcosCache_). 저장값이 없거나 오래됐으면
// 기준금리는 수동 입력값, 환율은 Yahoo(KRW=X)로 폴백한다.
function fetchRatesParallel_() {
  const props = PropertiesService.getScriptProperties();
  const fredKey = props.getProperty('FRED_API_KEY');
  const noKey = function (name) { return { error: '스크립트 속성에 ' + name + ' 가 설정되어 있지 않습니다.' }; };

  const jobs = [
    fredKey
      ? { name: 'base_rate_us', url: fredSeriesUrl_('FEDFUNDS', fredKey), parse: parseFred_ }
      : { name: 'base_rate_us', error: noKey('FRED_API_KEY') },
    { name: 'usdkrw_fallback', url: yahooChartUrl_('KRW=X'), parse: parseYahooQuote_ },
    fredKey
      ? { name: 'wti', url: fredSeriesUrl_('DCOILWTICO', fredKey), parse: parseFred_ }
      : { name: 'wti', error: noKey('FRED_API_KEY') },
    { name: 'kospi', url: yahooChartUrl_('^KS11'), parse: parseYahooQuote_ },
    { name: 'nasdaq', url: yahooChartUrl_('^IXIC'), parse: parseYahooQuote_ },
    { name: 'gold', url: yahooChartUrl_('GC=F'), parse: parseYahooQuote_ },
    { name: 'btc', url: yahooChartUrl_('BTC-USD'), parse: parseYahooQuote_ }
  ];

  const toFetch = jobs.filter(function (j) { return !j.error; });
  const responses = fetchJobsSafe_(toFetch);

  const results = {};
  jobs.forEach(function (j) {
    if (j.error) results[j.name] = j.error;
  });
  toFetch.forEach(function (j, i) {
    try {
      const res = responses[i];
      if (!res) throw new Error('요청 실패(연결 오류): ' + j.url);
      const code = res.getResponseCode();
      if (code >= 400) throw new Error('요청 실패(' + code + '): ' + j.url);
      results[j.name] = j.parse(JSON.parse(res.getContentText()));
    } catch (err) {
      results[j.name] = { error: String(err) };
    }
  });

  const ecos = readEcosCache_();

  // base_rate_kr: 트리거가 받아둔 ECOS 값 → 없으면 스크립트 속성의 수동 입력값
  // (금통위 발표 때만 가끔 바뀌는 값이라 수동 관리로도 충분함) 순으로 사용한다.
  let baseRateKr = ecos.base_rate_kr;
  if (!baseRateKr) {
    const manual = props.getProperty('BASE_RATE_KR_MANUAL');
    baseRateKr = manual
      ? { value: parseFloat(manual), date: 'manual', note: 'ECOS 값 없음 - 수동 입력값 표시 중' }
      : { error: 'ECOS 기준금리 값이 아직 없습니다. setupEcosTrigger()를 실행했는지 확인하세요.' };
  }

  // usdkrw: 트리거가 받아둔 ECOS 값 → 없으면 방금 병렬로 받아둔 Yahoo(KRW=X) 결과.
  const usdkrw = ecos.usdkrw || results.usdkrw_fallback;

  return {
    base_rate_kr: baseRateKr,
    base_rate_us: results.base_rate_us,
    usdkrw: usdkrw,
    wti: results.wti,
    kospi: results.kospi,
    nasdaq: results.nasdaq,
    gold: results.gold,
    btc: results.btc
  };
}

// UrlFetchApp.fetchAll()은 배치 안의 요청 하나가 "Address unavailable" 같은 연결 레벨
// 오류를 내면 그 요청만 실패하는 게 아니라 fetchAll() 호출 자체가 예외를 던지며 배치 전체
// 응답을 잃어버린다(HTTP 4xx/5xx는 muteHttpExceptions로 막히지만 연결 실패는 안 막힘).
// 그래서 배치가 통째로 죽으면 하나씩 개별 요청으로 재시도해 성공/실패를 요청 단위로 격리한다.
// (오래 매달리는 ECOS는 이 배치에 없으므로 순차 재시도로도 크게 느려지지 않는다.)
// jobs와 같은 길이의 배열을 돌려주며, 못 받은 자리는 null이다.
function fetchJobsSafe_(jobs) {
  const toParams = function (j) {
    return Object.assign({ muteHttpExceptions: true }, j.headers ? { headers: j.headers } : {});
  };
  if (!jobs.length) return [];

  try {
    return UrlFetchApp.fetchAll(jobs.map(function (j) {
      return Object.assign({ url: j.url }, toParams(j));
    }));
  } catch (err) {
    return jobs.map(function (j) {
      try {
        return UrlFetchApp.fetch(j.url, toParams(j));
      } catch (err2) {
        return null;
      }
    });
  }
}

// ================= ECOS 백그라운드 갱신 (시간 기반 트리거) =================
// ECOS는 GAS 서버에서 차단당하는 일이 잦고, 그때 응답까지 ~50초를 매달린다. 그래서
// 사용자 요청(doGet) 경로에서 빼고, 트리거가 주기적으로 미리 받아 스크립트 속성에
// 넣어두는 방식으로 분리했다. 실패하면 직전에 저장해둔 값이 그대로 남는다.
var ECOS_CACHE_PROP_ = 'ECOS_CACHE_V1';
var ECOS_MAX_AGE_MS_ = 26 * 60 * 60 * 1000; // 26시간 넘게 갱신 안 됐으면 폐기하고 폴백 사용

/**
 * 이 프로젝트에서 딱 한 번만 실행하면 되는 설치 함수. Apps Script 편집기 상단의 함수
 * 드롭다운에서 골라 ▶ 실행하면, 30분마다 ECOS 값을 받아오는 트리거가 등록된다.
 * (여러 번 눌러도 기존 트리거를 지우고 다시 만들기 때문에 중복 생성되지 않는다.)
 */
function setupEcosTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'refreshEcosCache') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('refreshEcosCache').timeBased().everyMinutes(30).create();
  refreshEcosCache(); // 30분 기다리지 않도록 지금 한 번 채워둔다
  Logger.log('ECOS 트리거 등록 완료 (30분 주기). 현재 저장값: ' + PropertiesService.getScriptProperties().getProperty(ECOS_CACHE_PROP_));
}

/** 트리거가 호출하는 함수. 직접 실행해도 된다(값을 즉시 갱신하고 싶을 때). */
function refreshEcosCache() {
  const props = PropertiesService.getScriptProperties();
  const key = props.getProperty('ECOS_API_KEY');
  if (!key) {
    console.log('refreshEcosCache: ECOS_API_KEY 미설정 - 건너뜀');
    return;
  }

  const today = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyyMMdd');
  const startLong = Utilities.formatDate(new Date(Date.now() - 120 * 24 * 60 * 60 * 1000), 'Asia/Seoul', 'yyyyMMdd');
  const startShort = Utilities.formatDate(new Date(Date.now() - 10 * 24 * 60 * 60 * 1000), 'Asia/Seoul', 'yyyyMMdd');
  const jobs = [
    { name: 'base_rate_kr', url: ecosUrl_(key, '722Y001', startLong, today, '0101000'), headers: BROWSER_LIKE_HEADERS_, parse: parseEcosBaseRate_ },
    { name: 'usdkrw', url: ecosUrl_(key, '731Y001', startShort, today, '0000001'), headers: BROWSER_LIKE_HEADERS_, parse: parseEcosUsdKrw_ }
  ];
  const responses = fetchJobsSafe_(jobs);

  // 둘 중 하나만 성공했으면 그것만 갱신하고 나머지는 기존 값을 유지한다.
  const stored = readEcosCache_();
  const updated = [];
  jobs.forEach(function (j, i) {
    try {
      const res = responses[i];
      if (!res) throw new Error('연결 오류');
      const code = res.getResponseCode();
      if (code >= 400) throw new Error('HTTP ' + code);
      stored[j.name] = j.parse(JSON.parse(res.getContentText()));
      updated.push(j.name);
    } catch (err) {
      console.log('refreshEcosCache: ' + j.name + ' 실패(기존 값 유지) - ' + err);
    }
  });

  if (!updated.length) return; // 전부 실패 -> 저장 시각을 갱신하지 않아 기존 값이 자연히 만료된다
  stored.at = new Date().toISOString();
  props.setProperty(ECOS_CACHE_PROP_, JSON.stringify(stored));

  // 기준금리를 새로 받았으면 수동 폴백값(BASE_RATE_KR_MANUAL)도 같이 덮어쓴다.
  // 이 값은 ECOS 저장분이 26시간 넘게 낡았을 때 쓰이는 최후 폴백인데, 손으로 관리하면
  // 금통위 발표 때 갱신하는 걸 잊어버려 틀린 금리가 표시된다(실제로 2.75로 방치돼 있었음).
  // 성공할 때마다 최신값으로 자동 동기화해 그 사고를 막는다.
  if (updated.indexOf('base_rate_kr') !== -1 && isFinite(stored.base_rate_kr.value)) {
    props.setProperty('BASE_RATE_KR_MANUAL', String(stored.base_rate_kr.value));
  }

  console.log('refreshEcosCache: ' + updated.join(', ') + ' 갱신 완료');
}

function ecosUrl_(key, statCode, from, to, itemCode) {
  return 'https://ecos.bok.or.kr/api/StatisticSearch/' + key +
    '/json/kr/1/10/' + statCode + '/D/' + from + '/' + to + '/' + itemCode;
}

// 트리거가 저장해둔 ECOS 값을 읽는다. 너무 오래된 값은 쓰지 않고 폴백에 맡긴다.
function readEcosCache_() {
  const raw = PropertiesService.getScriptProperties().getProperty(ECOS_CACHE_PROP_);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed.at && (Date.now() - new Date(parsed.at).getTime()) > ECOS_MAX_AGE_MS_) return {};
    return parsed;
  } catch (err) {
    return {};
  }
}

function fredSeriesUrl_(seriesId, apiKey) {
  return 'https://api.stlouisfed.org/fred/series/observations?series_id=' + seriesId +
    '&api_key=' + apiKey + '&file_type=json&sort_order=desc&limit=2';
}

function yahooChartUrl_(symbol) {
  return 'https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(symbol) + '?interval=1d&range=5d';
}

function parseEcosBaseRate_(json) {
  const rows = json.StatisticSearch && json.StatisticSearch.row;
  if (!rows || !rows.length) throw new Error('ECOS 기준금리 응답 없음. 통계코드/기간을 확인하세요.');
  const last = rows[rows.length - 1];
  return { value: parseFloat(last.DATA_VALUE), date: last.TIME };
}

function parseEcosUsdKrw_(json) {
  const rows = json.StatisticSearch && json.StatisticSearch.row;
  if (!rows || !rows.length) throw new Error('ECOS 환율 응답 없음.');
  const last = rows[rows.length - 1];
  const prev = rows.length > 1 ? rows[rows.length - 2] : last;
  return {
    value: parseFloat(last.DATA_VALUE),
    change: parseFloat(last.DATA_VALUE) - parseFloat(prev.DATA_VALUE),
    date: last.TIME
  };
}

function parseFred_(json) {
  const obs = json.observations;
  if (!obs || !obs.length) throw new Error('FRED 응답 없음.');
  const last = obs[0];
  const prev = obs[1] || last;
  return {
    value: parseFloat(last.value),
    change: parseFloat(last.value) - parseFloat(prev.value),
    date: last.date
  };
}

function parseYahooQuote_(json) {
  const result = json.chart && json.chart.result && json.chart.result[0];
  if (!result) throw new Error('Yahoo Finance 응답 없음.');
  const meta = result.meta;
  const closes = ((result.indicators.quote[0] && result.indicators.quote[0].close) || [])
    .filter(function (c) { return c != null; });
  const current = meta.regularMarketPrice != null ? meta.regularMarketPrice : closes[closes.length - 1];
  // meta.previousClose가 비어있는 경우(지수 심볼에서 종종 발생)를 대비해
  // 최근 종가 배열에서 전일 종가를 직접 계산한다.
  let prevClose = meta.previousClose;
  if (prevClose == null && closes.length >= 2) {
    prevClose = closes[closes.length - 2];
  }
  const change = (current != null && prevClose != null) ? current - prevClose : null;
  const changePct = (change != null && prevClose) ? (change / prevClose) * 100 : null;
  return {
    value: current,
    change: change,
    changePct: changePct,
    date: meta.regularMarketTime ? new Date(meta.regularMarketTime * 1000).toISOString() : null
  };
}

// ================= 5. 종목 검색 (임의 심볼 조회) =================
// 삼성전자 = 005930.KS, 애플 = AAPL 처럼 Yahoo Finance가 인식하는 코드면 뭐든 조회 가능.

// Yahoo 검색 API가 막히거나 실패해도 자주 찾는 종목은 바로 뜨도록 준비해둔
// 최소한의 로컬 매핑(회사명 → 티커). 필요하면 얼마든지 추가하면 된다.
var KOREAN_TICKER_MAP_ = {
  '삼성전자': { symbol: '005930.KS', name: '삼성전자' },
  '삼성전자우': { symbol: '005935.KS', name: '삼성전자우' },
  'sk하이닉스': { symbol: '000660.KS', name: 'SK하이닉스' },
  '에스케이하이닉스': { symbol: '000660.KS', name: 'SK하이닉스' },
  '네이버': { symbol: '035420.KS', name: 'NAVER' },
  '카카오': { symbol: '035720.KS', name: '카카오' },
  '현대차': { symbol: '005380.KS', name: '현대차' },
  '기아': { symbol: '000270.KS', name: '기아' },
  'lg에너지솔루션': { symbol: '373220.KS', name: 'LG에너지솔루션' },
  '셀트리온': { symbol: '068270.KS', name: '셀트리온' },
  '포스코': { symbol: '005490.KS', name: 'POSCO홀딩스' },
  '포스코홀딩스': { symbol: '005490.KS', name: 'POSCO홀딩스' },
  '삼성바이오로직스': { symbol: '207940.KS', name: '삼성바이오로직스' },
  '삼성sdi': { symbol: '006400.KS', name: '삼성SDI' },
  'kb금융': { symbol: '105560.KS', name: 'KB금융' },
  '신한지주': { symbol: '055550.KS', name: '신한지주' },

  // ETF / 레버리지·인버스 상품 — Yahoo 검색이 한글 ETF명을 잘 못 찾는 경우가 많아
  // 자주 찾을 만한 것들은 미리 매핑해둔다.
  'kodex 200': { symbol: '069500.KS', name: 'KODEX 200' },
  '코덱스200': { symbol: '069500.KS', name: 'KODEX 200' },
  'kodex 레버리지': { symbol: '122630.KS', name: 'KODEX 레버리지' },
  '코덱스 레버리지': { symbol: '122630.KS', name: 'KODEX 레버리지' },
  'kodex 200선물인버스2x': { symbol: '252670.KS', name: 'KODEX 200선물인버스2X' },
  'kodex 인버스': { symbol: '114800.KS', name: 'KODEX 인버스' },
  'tiger 200': { symbol: '102110.KS', name: 'TIGER 200' },
  'tiger 200레버리지': { symbol: '123320.KS', name: 'TIGER 200 레버리지' },
  'tiger 미국나스닥100': { symbol: '133690.KS', name: 'TIGER 미국나스닥100' },
  'kodex 미국나스닥100선물': { symbol: '304940.KS', name: 'KODEX 미국나스닥100선물(H)' },
  'kodex 골드선물': { symbol: '132030.KS', name: 'KODEX 골드선물(H)' },
  'tqqq': { symbol: 'TQQQ', name: 'ProShares UltraPro QQQ (나스닥100 3배 레버리지)' },
  'sqqq': { symbol: 'SQQQ', name: 'ProShares UltraPro Short QQQ (나스닥100 3배 인버스)' },
  'soxl': { symbol: 'SOXL', name: 'Direxion Daily Semiconductor Bull 3X' },
  'spxl': { symbol: 'SPXL', name: 'Direxion Daily S&P 500 Bull 3X' }
};

function getQuote(query, noCache) {
  const clean = String(query || '').trim();
  if (!clean) return { error: '종목명 또는 코드를 입력해주세요.' };
  if (clean.length > 40) return { error: '입력이 너무 깁니다.' };

  const cacheKey = 'quote_' + clean.toLowerCase();
  const cached = noCache ? null : cacheGet_(cacheKey);
  if (cached) return cached;

  // "삼성전자" 처럼 종목명만 입력해도 되게, 코드 검색 없이 바로 Yahoo Finance의
  // 심볼 검색으로 정확한 티커를 먼저 찾아본 뒤 그 심볼로 시세를 조회한다.
  const resolved = resolveSymbol_(clean);

  // 한글(또는 그 외 비-티커성) 입력인데 끝내 심볼을 못 찾았으면, 그 텍스트를
  // 그대로 Yahoo 차트 API에 넘겨봐야 100% 실패하므로(예: "삼성전자" 자체는
  // 유효한 티커가 아님) 미리 명확한 에러로 안내한다.
  if (!resolved && /[^\x00-\x7F]/.test(clean)) {
    const data = { error: '"' + clean + '"에 해당하는 종목을 찾지 못했어요. 정확한 회사명이나 코드(예: 005930.KS)로 다시 시도해주세요.' };
    return data;
  }

  const symbol = resolved ? resolved.symbol : clean;
  const quote = getYahooQuote_(symbol);
  const data = { query: clean, symbol: symbol, name: resolved ? resolved.name : null, quote: quote };
  cachePut_(cacheKey, data, 300); // 5분 캐시 (검색은 자주 바뀔 수 있어 짧게)
  return data;
}

// 회사명/키워드로 실제 티커 심볼을 찾아주는 검색.
// 1) 로컬 매핑에 있으면 그걸 바로 사용 (네트워크 의존 없이 항상 동작)
// 2) 없으면 Yahoo Finance 검색 API를 query1 → query2 순서로 시도
//    (query1이 가끔 막히거나 빈 응답을 주는 경우가 있어 대체 도메인도 시도)
// 한국 거래소(KSC=코스피, KOE=코스닥) 결과가 있으면 그걸 우선 선택.
function resolveSymbol_(query) {
  const key = query.trim().toLowerCase();
  if (KOREAN_TICKER_MAP_[key]) return KOREAN_TICKER_MAP_[key];

  const hosts = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com'];
  for (var i = 0; i < hosts.length; i++) {
    try {
      const url = 'https://' + hosts[i] + '/v1/finance/search?q=' + encodeURIComponent(query) +
        '&lang=ko-KR&region=KR&quotesCount=5&newsCount=0';
      const json = fetchJson_(url, { headers: BROWSER_LIKE_HEADERS_ });
      const quotes = json.quotes || [];
      if (!quotes.length) continue;
      const krFirst = quotes.find(function (q) { return q.exchange === 'KSC' || q.exchange === 'KOE'; });
      const best = krFirst || quotes[0];
      if (!best.symbol) continue;
      return { symbol: best.symbol, name: best.shortname || best.longname || best.symbol };
    } catch (err) {
      // 이 도메인은 실패 — 다음 후보(다른 host, 또는 결국 null)로 넘어간다.
    }
  }
  return null; // 검색 실패
}

function safe_(fn) {
  try {
    return fn();
  } catch (err) {
    return { error: String(err) };
  }
}

// ECOS는 간혹 구글 앱스크립트 서버에서 "Address unavailable"(응답 없음)로 접속이
// 막히는 경우가 있다. 브라우저처럼 보이는 헤더를 붙여 한 번 더 시도하고, 그래도
// 안 되면 대체 수단(수동값/Yahoo Finance)으로 넘어간다.
var BROWSER_LIKE_HEADERS_ = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  'Accept': 'application/json'
};

function getYahooQuote_(symbol) {
  const json = fetchJson_(yahooChartUrl_(symbol));
  return parseYahooQuote_(json);
}

// ================= 2. 히스토리 차트 (코스피 vs 나스닥) =================
function getHistory(range, noCache) {
  const cacheKey = 'history_' + range;
  const cached = noCache ? null : cacheGet_(cacheKey);
  if (cached) return cached;

  const rangeMap = { '1M': '1mo', '3M': '3mo', '1Y': '1y' };
  const yRange = rangeMap[range] || '3mo';

  const data = {
    kospi: safe_(function () { return getYahooHistory_('^KS11', yRange); }),
    nasdaq: safe_(function () { return getYahooHistory_('^IXIC', yRange); })
  };
  cachePut_(cacheKey, data, 3600); // 1시간 캐시
  return data;
}

function getYahooHistory_(symbol, range) {
  const url = 'https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(symbol) +
    '?interval=1d&range=' + range;
  const json = fetchJson_(url);
  const result = json.chart && json.chart.result && json.chart.result[0];
  if (!result) throw new Error('Yahoo Finance 히스토리 응답 없음: ' + symbol);
  const timestamps = result.timestamp || [];
  const closes = (result.indicators.quote[0] && result.indicators.quote[0].close) || [];
  const points = [];
  for (let i = 0; i < timestamps.length; i++) {
    if (closes[i] != null) {
      points.push({
        date: Utilities.formatDate(new Date(timestamps[i] * 1000), 'Asia/Seoul', 'yyyy-MM-dd'),
        close: closes[i]
      });
    }
  }
  return points;
}

// ================= 3. 경제 캘린더 (매크로 지표 발표일 + 주요 기업 실적) =================
// 화면이 달력(월 단위) 형태라 이번 달 1일부터 다음 달 말일까지를 한 번에 받아둔다.
// 예전에 30일치를 통째로 캐시에 넣었다가 GAS 캐시 값 용량 제한(100KB)을 넘겨 응답 전체가
// 에러났던 적이 있는데, 지금은 주요 발표/대형주만 걸러내서 담기 때문에(두 달치 합쳐도
// 100건 안팎) 여유가 있다. 그래도 필드는 최소한만 남기고 개수 상한도 유지한다.
var CALENDAR_MONTHS_AHEAD_ = 1;

// FRED가 제공하는 발표 일정은 300종이 넘고 대부분은 이 대시보드와 무관하다(지역별 통계,
// 일간 금리 고시 등). 매크로 흐름을 볼 때 실제로 챙겨보는 것만 골라내고, 화면에 그대로 쓸
// 수 있게 한국어 이름을 같이 붙인다. key는 FRED release_name의 **앞부분** 일치로 검사한다 —
// 부분 일치로 하면 "Debt to Gross Domestic Product Ratios"(부채/GDP 비율) 같은 별개 통계가
// "Gross Domestic Product"에 걸려 GDP 발표로 둔갑한다(실제로 그랬음).
var FRED_MAJOR_RELEASES_ = [
  ['Consumer Price Index', '미국 소비자물가지수(CPI)'],
  ['Employment Situation', '미국 고용보고서'],
  ['Gross Domestic Product', '미국 GDP'],
  ['Personal Income and Outlays', '미국 개인소득·지출(PCE)'],
  ['Producer Price Index', '미국 생산자물가지수(PPI)'],
  ['Advance Monthly Sales for Retail', '미국 소매판매'],
  ['Industrial Production', '미국 산업생산'],
  ['Job Openings and Labor Turnover', '미국 구인·이직 보고서(JOLTS)'],
  ['New Residential Construction', '미국 신규주택착공'],
  ['Advance Report on Durable Goods', '미국 내구재 주문'],
  ['H.6', '미국 통화량(M2)'],
  ['Federal Open Market Committee', 'FOMC']
];

// 실적 캘린더에 띄울 종목. Finnhub는 미국 상장사 전체(하루 수백 건)를 돌려주는데 대부분
// 이름도 모르는 소형주라, 시장 전체가 반응하는 대형주로만 좁힌다. 종목 자체는 자주 바뀌지
// 않으니 여기만 가끔 손보면 되고, 발표일은 계속 자동으로 따라온다.
var MAJOR_EARNINGS_SYMBOLS_ = [
  'AAPL', 'MSFT', 'NVDA', 'GOOGL', 'GOOG', 'AMZN', 'META', 'TSLA', 'AVGO', 'ORCL',
  'AMD', 'INTC', 'MU', 'QCOM', 'TSM', 'ASML', 'ARM', 'SMCI', 'CRM', 'ADBE',
  'NFLX', 'DIS', 'JPM', 'V', 'MA', 'BAC', 'GS', 'BRK.B', 'UNH', 'LLY',
  'JNJ', 'XOM', 'CVX', 'WMT', 'COST', 'HD', 'PG', 'KO', 'PEP', 'BA',
  'CSCO', 'PLTR', 'COIN', 'MSTR', 'UBER', 'ABNB', 'SHOP', 'PYPL'
];

function getCalendar(noCache) {
  const cached = noCache ? null : cacheGet_('calendar');
  if (cached) return cached;

  const props = PropertiesService.getScriptProperties();
  const fredKey = props.getProperty('FRED_API_KEY');
  const finnhubKey = props.getProperty('FINNHUB_API_KEY');
  // 이번 달 1일 ~ (이번 달 + CALENDAR_MONTHS_AHEAD_)의 말일.
  // Date의 day=0은 "그 전달의 마지막 날"이라 말일 계산에 그대로 쓸 수 있다.
  const today = new Date();
  const first = new Date(today.getFullYear(), today.getMonth(), 1);
  const last = new Date(today.getFullYear(), today.getMonth() + CALENDAR_MONTHS_AHEAD_ + 1, 0);
  const from = Utilities.formatDate(first, 'Asia/Seoul', 'yyyy-MM-dd');
  const to = Utilities.formatDate(last, 'Asia/Seoul', 'yyyy-MM-dd');

  const jobs = [];
  if (fredKey) {
    jobs.push({ name: 'macro', url: fredReleaseDatesUrl_(fredKey, from, to, 0) });
  }
  if (finnhubKey) {
    jobs.push({
      name: 'earnings',
      url: 'https://finnhub.io/api/v1/calendar/earnings?from=' + from + '&to=' + to + '&token=' + finnhubKey
    });
  }

  const responses = fetchJobsSafe_(jobs);
  const data = { macro: [], earnings: [], from: from, to: to };
  jobs.forEach(function (j, i) {
    try {
      const res = responses[i];
      if (!res) throw new Error('연결 오류');
      const code = res.getResponseCode();
      if (code >= 400) throw new Error('HTTP ' + code);
      const json = JSON.parse(res.getContentText());
      data[j.name] = j.name === 'macro'
        ? parseFredReleases_(collectFredPages_(fredKey, from, to, json))
        : parseMajorEarnings_(json);
    } catch (err) {
      data[j.name + 'Error'] = String(err);
    }
  });

  cachePut_('calendar', data, 21600); // 6시간 캐시 (실패해도 cachePut_ 내부에서 무시하도록 처리됨)
  return data;
}

// FRED는 특정 통계가 아니라 "모든 발표 일정"을 돌려주기 때문에(일간 금리 고시처럼 매일
// 나오는 것도 전부 포함) 두 달치를 요청하면 한 페이지 한도(1000건)를 넘긴다. 그대로 두면
// 날짜 오름차순으로 앞부분만 남아 뒷달 일정이 통째로 사라진다(실제로 8월이 1건만 잡혔음).
// 첫 페이지의 count를 보고 남은 페이지를 한 번에 병렬로 받아 이어붙인다.
var FRED_PAGE_ = 1000;

function collectFredPages_(apiKey, from, to, firstPage) {
  const rows = (firstPage.release_dates || []).slice();
  const count = firstPage.count || rows.length;
  if (count <= rows.length) return rows;

  const jobs = [];
  for (var offset = FRED_PAGE_; offset < count && jobs.length < 8; offset += FRED_PAGE_) {
    jobs.push({ url: fredReleaseDatesUrl_(apiKey, from, to, offset) });
  }
  fetchJobsSafe_(jobs).forEach(function (res) {
    try {
      if (!res || res.getResponseCode() >= 400) return;
      const more = JSON.parse(res.getContentText()).release_dates || [];
      rows.push.apply(rows, more);
    } catch (err) {
      // 이 페이지는 건너뛴다 — 일부가 빠져도 나머지 일정은 그대로 보여준다.
    }
  });
  return rows;
}

// 예정된 발표일은 아직 데이터가 없는 상태라, include_release_dates_with_no_data=true를
// 붙이지 않으면 미래 일정이 하나도 안 나온다.
function fredReleaseDatesUrl_(apiKey, from, to, offset) {
  return 'https://api.stlouisfed.org/fred/releases/dates?api_key=' + apiKey +
    '&file_type=json&realtime_start=' + from + '&realtime_end=' + to +
    '&include_release_dates_with_no_data=true&sort_order=asc' +
    '&limit=' + FRED_PAGE_ + '&offset=' + (offset || 0);
}

// 인자는 collectFredPages_가 여러 페이지를 이어붙인 release_dates 행 배열이다
// (응답 객체가 아니라 배열임에 주의 — 예전에 json.release_dates를 꺼내려다 항상 빈
// 배열이 나온 적이 있다).
function parseFredReleases_(rows) {
  const out = [];
  const seen = {};
  rows.forEach(function (r) {
    const label = majorReleaseLabel_(r.release_name);
    if (!label) return;
    const key = r.date + '|' + label;
    if (seen[key]) return; // 같은 발표가 여러 건으로 쪼개져 오는 경우가 있어 중복 제거
    seen[key] = true;
    out.push({ date: r.date, name: label, source: r.release_name });
  });
  return out.slice(0, 80);
}

function majorReleaseLabel_(releaseName) {
  const name = String(releaseName || '');
  for (var i = 0; i < FRED_MAJOR_RELEASES_.length; i++) {
    if (name.indexOf(FRED_MAJOR_RELEASES_[i][0]) === 0) return FRED_MAJOR_RELEASES_[i][1];
  }
  return null;
}

function parseMajorEarnings_(json) {
  const raw = json.earningsCalendar || [];
  const wanted = {};
  MAJOR_EARNINGS_SYMBOLS_.forEach(function (s) { wanted[s] = true; });
  return raw
    .filter(function (e) { return wanted[String(e.symbol || '').toUpperCase()]; })
    .map(function (e) { return { date: e.date, symbol: e.symbol, hour: e.hour || '' }; })
    .sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; })
    .slice(0, 80);
}

// ================= 4. 경제 뉴스 피드 (네이버 뉴스 검색) =================
function getNews(category, noCache) {
  const cacheKey = 'news_' + category;
  const cached = noCache ? null : cacheGet_(cacheKey);
  if (cached) return cached;

  const clientId = getProp_('NAVER_CLIENT_ID');
  const clientSecret = getProp_('NAVER_CLIENT_SECRET');

  const queryMap = {
    world: '세계경제',
    domestic: '국내경제',
    politics_domestic: '국내정세',
    politics_intl: '국제정세',
    all: '경제'
  };
  const query = queryMap[category] || '경제';
  // 카테고리 4개 x 10개씩 합치면 화면에 40개가 한꺼번에 뜨는 게 너무 방대해서
  // 카테고리당 5개로 줄임 (전체 탭 기준 최대 20개).
  const url = 'https://openapi.naver.com/v1/search/news.json?query=' + encodeURIComponent(query) +
    '&display=5&sort=date';
  const json = fetchJson_(url, {
    headers: {
      'X-Naver-Client-Id': clientId,
      'X-Naver-Client-Secret': clientSecret
    }
  });

  const items = (json.items || []).map(function (item) {
    return {
      title: stripTags_(item.title),
      description: stripTags_(item.description),
      link: item.link,
      pubDate: item.pubDate,
      category: category
    };
  });

  const data = { items: items };
  cachePut_(cacheKey, data, 1800); // 30분 캐시
  return data;
}

function stripTags_(s) {
  return String(s).replace(/<[^>]*>/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
}

/**
 * (선택/2주차 이후) Claude API로 "오늘의 한 줄 요약" 만들기.
 * 스크립트 속성에 ANTHROPIC_API_KEY를 추가하면 사용 가능.
 * 지금 단계에서는 필수 아님 — index.html은 이 값이 비어도 정상 동작함.
 */
function getAIBriefing() {
  const key = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  if (!key) return { summary: null };

  const rates = getRates();
  const news = getNews('all');
  const prompt = '다음 지표와 뉴스 헤드라인을 바탕으로 한국어로 3~4문장짜리 오늘의 경제 브리핑을 작성해줘.\n' +
    '지표: ' + JSON.stringify(rates) + '\n' +
    '뉴스: ' + JSON.stringify(news.items.slice(0, 5).map(function (n) { return n.title; }));

  const res = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'x-api-key': key,
      'anthropic-version': '2023-06-01'
    },
    payload: JSON.stringify({
      model: 'claude-sonnet-4-5',
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }]
    }),
    muteHttpExceptions: true
  });
  const json = JSON.parse(res.getContentText());
  const text = json.content && json.content[0] && json.content[0].text;
  return { summary: text || null };
}

