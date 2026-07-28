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
    'news_all', 'news_world', 'news_domestic', 'news_politics_domestic', 'news_politics_intl',
    'ecos_down' // ECOS 차단 표시(30분). 이걸 지우면 다음 요청에서 ECOS를 다시 시도한다.
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

// ECOS가 GAS 서버에서 막혀있는 걸 한 번 확인하면, 이 시간 동안은 아예 시도하지 않고
// 곧바로 폴백값(수동 기준금리 / Yahoo 환율)을 쓴다. ECOS가 막혔을 때는 에러가 바로
// 나는 게 아니라 응답이 올 때까지 수십 초를 매달려 있어서, 매 요청마다 그 시간을
// 물면 "첫 로딩이 느린" 문제가 그대로 남기 때문.
var ECOS_DOWN_KEY_ = 'ecos_down';
var ECOS_DOWN_SEC_ = 1800; // 30분

// 지표 8종을 UrlFetchApp.fetchAll()로 한 번에 병렬 요청한다. 예전엔 8개를 순차로
// fetch()해서(ECOS가 막혀 재시도가 붙으면 더 느려짐) 첫 로딩이 오래 걸렸는데, 병렬화하면
// 전체 응답 시간이 "가장 느린 요청 1개" 수준으로 줄어든다.
// usdkrw는 ECOS 성공 여부를 미리 알 수 없으니 Yahoo(KRW=X) 요청도 항상 같이 보내놓고,
// ECOS가 실패했을 때는 순차로 재요청하는 대신 이미 도착해있는 그 응답을 바로 대신 쓴다.
function fetchRatesParallel_() {
  const props = PropertiesService.getScriptProperties();
  const ecosKey = props.getProperty('ECOS_API_KEY');
  const fredKey = props.getProperty('FRED_API_KEY');
  const today = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyyMMdd');
  const ecosStartLong = Utilities.formatDate(new Date(Date.now() - 120 * 24 * 60 * 60 * 1000), 'Asia/Seoul', 'yyyyMMdd');
  const ecosStartShort = Utilities.formatDate(new Date(Date.now() - 10 * 24 * 60 * 60 * 1000), 'Asia/Seoul', 'yyyyMMdd');
  const noKey = function (name) { return new Error('스크립트 속성에 ' + name + ' 가 설정되어 있지 않습니다.'); };

  // 최근에 ECOS가 막힌 게 확인됐으면 이번엔 건너뛴다(위 ECOS_DOWN_KEY_ 설명 참고).
  const ecosSkipped = !!cacheGet_(ECOS_DOWN_KEY_);
  const useEcos = !!ecosKey && !ecosSkipped;
  const ecosError = function () {
    if (!ecosKey) return noKey('ECOS_API_KEY');
    return new Error('ECOS 접속 불가 상태로 이번 요청은 건너뜀 - 폴백값 표시 중');
  };

  const jobs = [
    useEcos
      ? { name: 'base_rate_kr', flaky: true, url: 'https://ecos.bok.or.kr/api/StatisticSearch/' + ecosKey + '/json/kr/1/10/722Y001/D/' + ecosStartLong + '/' + today + '/0101000', headers: BROWSER_LIKE_HEADERS_, parse: parseEcosBaseRate_ }
      : { name: 'base_rate_kr', error: ecosError() },
    fredKey
      ? { name: 'base_rate_us', url: fredSeriesUrl_('FEDFUNDS', fredKey), parse: parseFred_ }
      : { name: 'base_rate_us', error: noKey('FRED_API_KEY') },
    useEcos
      ? { name: 'usdkrw', flaky: true, url: 'https://ecos.bok.or.kr/api/StatisticSearch/' + ecosKey + '/json/kr/1/10/731Y001/D/' + ecosStartShort + '/' + today + '/0000001', headers: BROWSER_LIKE_HEADERS_, parse: parseEcosUsdKrw_ }
      : { name: 'usdkrw', error: ecosError() },
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
  const fetched = fetchJobsSafe_(toFetch);

  // 배치가 통째로 죽었다는 건 불안정한 요청(ECOS)이 연결 단계에서 막혔다는 뜻.
  // 다음 요청부터는 아예 건너뛰도록 표시해둔다.
  if (fetched.flakyFailed) cachePut_(ECOS_DOWN_KEY_, 1, ECOS_DOWN_SEC_);

  const results = {};
  jobs.forEach(function (j) {
    if (j.error) results[j.name] = { error: String(j.error) };
  });
  toFetch.forEach(function (j, i) {
    try {
      const res = fetched.responses[i];
      if (!res) throw new Error('요청 실패(연결 오류): ' + j.url);
      const code = res.getResponseCode();
      if (code >= 400) throw new Error('요청 실패(' + code + '): ' + j.url);
      results[j.name] = j.parse(JSON.parse(res.getContentText()));
    } catch (err) {
      results[j.name] = { error: String(err) };
    }
  });

  // base_rate_kr: ECOS 접속이 막혀있을 때 대비해, 스크립트 속성에
  // BASE_RATE_KR_MANUAL 값을 넣어두면(금통위 발표 때만 가끔 바뀌는 값이라 수동
  // 관리로도 충분함) 그 값을 대신 보여준다.
  if (results.base_rate_kr.error) {
    const manual = props.getProperty('BASE_RATE_KR_MANUAL');
    if (manual) {
      results.base_rate_kr = { value: parseFloat(manual), date: 'manual', note: 'ECOS 연동 실패 - 수동 입력값 표시 중' };
    }
  }

  // usdkrw: ECOS가 막혀있으면 이미 병렬로 받아둔 Yahoo(KRW=X) 결과로 대체.
  const usdkrw = results.usdkrw.error ? results.usdkrw_fallback : results.usdkrw;

  return {
    base_rate_kr: results.base_rate_kr,
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
// 그래서 배치가 죽으면 `flaky`로 표시된 요청(= ECOS)만 빼고 나머지를 한 번 더 병렬로
// 요청한다. 하나씩 순차 재시도하면 폴백 경로에서 오히려 더 느려지므로 재시도도 병렬로.
// jobs와 같은 길이의 배열을 돌려주며, 못 받은 자리는 null이다.
function fetchJobsSafe_(jobs) {
  const toRequest = function (j) {
    return Object.assign({ url: j.url, muteHttpExceptions: true }, j.headers ? { headers: j.headers } : {});
  };
  if (!jobs.length) return { responses: [], flakyFailed: false };

  try {
    return { responses: UrlFetchApp.fetchAll(jobs.map(toRequest)), flakyFailed: false };
  } catch (err) {
    const responses = jobs.map(function () { return null; });
    const stableIdx = [];
    const stable = [];
    jobs.forEach(function (j, i) {
      if (!j.flaky) { stableIdx.push(i); stable.push(toRequest(j)); }
    });
    if (stable.length) {
      try {
        const got = UrlFetchApp.fetchAll(stable);
        stableIdx.forEach(function (idx, k) { responses[idx] = got[k]; });
      } catch (err2) {
        // 두 번째 배치까지 죽으면 전부 null로 두고, 각 지표가 개별 에러로 표시된다.
      }
    }
    const hadFlaky = jobs.some(function (j) { return j.flaky; });
    return { responses: responses, flakyFailed: hadFlaky };
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

// ================= 3. 경제 캘린더 (기업 실적 발표일) =================
function getCalendar(noCache) {
  const cached = noCache ? null : cacheGet_('calendar');
  if (cached) return cached;

  const key = getProp_('FINNHUB_API_KEY');
  const today = new Date();
  // 30일치를 통째로 캐시에 넣으면 GAS 캐시 값 용량 제한(100KB)을 넘어 통째로
  // 에러가 났었음 -> 14일로 줄이고, 꼭 필요한 필드만 남기고, 개수도 상한을 둔다.
  const from = Utilities.formatDate(today, 'Asia/Seoul', 'yyyy-MM-dd');
  const to = Utilities.formatDate(new Date(today.getTime() + 14 * 24 * 60 * 60 * 1000), 'Asia/Seoul', 'yyyy-MM-dd');
  const url = 'https://finnhub.io/api/v1/calendar/earnings?from=' + from + '&to=' + to + '&token=' + key;
  const json = fetchJson_(url);
  const raw = json.earningsCalendar || [];
  const trimmed = raw.slice(0, 60).map(function (e) {
    return { date: e.date, symbol: e.symbol, hour: e.hour };
  });
  const data = { earnings: trimmed };
  cachePut_('calendar', data, 21600); // 6시간 캐시 (실패해도 cachePut_ 내부에서 무시하도록 처리됨)
  return data;
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

