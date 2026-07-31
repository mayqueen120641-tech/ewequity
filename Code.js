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
      case 'quotes':
        result = getQuotes((e.parameter && e.parameter.symbols) || '', noCache);
        break;
      case 'market':
        result = getMarket(noCache);
        break;
      case 'weekly':
        result = getWeekly(noCache);
        break;
      case 'ask':
        result = getAsk(
          (e.parameter && e.parameter.q) || '',
          (e.parameter && e.parameter.symbols) || ''
        );
        break;
      case 'explain':
        result = getExplain(
          (e.parameter && e.parameter.symbol) || '',
          (e.parameter && e.parameter.name) || '',
          noCache
        );
        break;
      case 'briefing':
        result = getBriefing();
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
      : { error: 'ECOS 기준금리 값이 아직 없습니다. setupTriggers()를 실행했는지 확인하세요.' };
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
    // j.options로 POST/payload 같은 걸 그대로 넘길 수 있다(KIND가 POST만 받는다).
    return Object.assign({ muteHttpExceptions: true }, j.options || {}, j.headers ? { headers: j.headers } : {});
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
 * 드롭다운에서 골라 ▶ 실행하면, 백그라운드 갱신 트리거가 전부 등록된다.
 * (여러 번 눌러도 기존 트리거를 지우고 다시 만들기 때문에 중복 생성되지 않는다.)
 *
 * - refreshEcosCache : ECOS 기준금리/환율
 * - refreshAiBriefing: AI 브리핑 + 뉴스 중요도 (ANTHROPIC_API_KEY가 있을 때만 동작)
 */
function setupTriggers() {
  // 이름과 실제 함수를 같이 들고 다닌다(GAS에서 this[name]으로 부르는 건 불안정하다).
  // 브리핑은 유료 API를 쓰므로 주기를 길게 잡았다 — 뉴스가 30분마다 의미 있게 바뀌지도
  // 않고, 30분 주기로 돌리면 하루 48번 호출이라 비용이 확 뛴다.
  const jobs = [
    { name: 'refreshEcosCache', fn: refreshEcosCache, minutes: 30 },
    { name: 'refreshAiBriefing', fn: refreshAiBriefing, hours: 3 }
  ];
  const names = jobs.map(function (j) { return j.name; });

  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (names.indexOf(t.getHandlerFunction()) !== -1) ScriptApp.deleteTrigger(t);
  });
  jobs.forEach(function (j) {
    const clock = ScriptApp.newTrigger(j.name).timeBased();
    // everyMinutes는 1/5/10/15/30만 받는다. 그보다 긴 주기는 everyHours를 써야 한다.
    (j.hours ? clock.everyHours(j.hours) : clock.everyMinutes(j.minutes)).create();
  });
  Logger.log('✅ 트리거 등록 완료: ' + jobs.map(function (j) {
    return j.name + '(' + (j.hours ? j.hours + '시간' : j.minutes + '분') + ')';
  }).join(', '));

  // 30분 기다리지 않도록 지금 한 번씩 채워두되, 여기서 나는 오류가 트리거 등록까지
  // 실패한 것처럼 보이면 안 되므로 각각 격리해서 실행하고 결과만 로그로 남긴다.
  jobs.forEach(function (j) {
    try {
      j.fn();
      Logger.log('✅ ' + j.name + ' 첫 실행 완료');
    } catch (err) {
      Logger.log('⚠️ ' + j.name + ' 첫 실행 실패(트리거는 등록됨, 30분 뒤 재시도): ' + err);
    }
  });
}

/**
 * 설정이 제대로 됐는지 한눈에 보는 진단 함수. 편집기에서 실행하고 실행 로그를 보면 된다.
 * 어떤 스크립트 속성이 비어있는지, 트리거가 걸려있는지, 저장된 값이 있는지 알려준다.
 * (키 값 자체는 찍지 않는다 — 설정 여부만 확인한다.)
 */
function checkSetup() {
  const props = PropertiesService.getScriptProperties();
  const lines = ['--- 스크립트 속성 ---'];
  ['ECOS_API_KEY', 'FRED_API_KEY', 'FINNHUB_API_KEY', 'NAVER_CLIENT_ID',
    'NAVER_CLIENT_SECRET', 'ANTHROPIC_API_KEY', 'BASE_RATE_KR_MANUAL'
  ].forEach(function (k) {
    const v = props.getProperty(k);
    lines.push('  ' + (v ? '✅' : '❌') + ' ' + k + (k === 'BASE_RATE_KR_MANUAL' && v ? ' = ' + v : ''));
  });

  lines.push('--- 트리거 ---');
  const triggers = ScriptApp.getProjectTriggers();
  if (!triggers.length) lines.push('  ❌ 없음 — setupTriggers()를 실행하세요');
  triggers.forEach(function (t) { lines.push('  ✅ ' + t.getHandlerFunction()); });

  lines.push('--- 저장된 값 ---');
  const ecos = props.getProperty(ECOS_CACHE_PROP_);
  lines.push('  ' + (ecos ? '✅' : '❌') + ' ECOS' + (ecos ? ' (' + JSON.parse(ecos).at + ')' : ''));
  const brief = props.getProperty(AI_BRIEFING_PROP_);
  if (brief) {
    const b = JSON.parse(brief);
    lines.push('  ✅ AI 브리핑 (' + b.at + ', 뉴스 ' + Object.keys(b.importance || {}).length + '건 채점)');
  } else {
    lines.push('  ❌ AI 브리핑 없음');
  }

  const out = lines.join('\n');
  Logger.log(out);
  return out;
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

// ---- 관심종목(워치리스트) 시세 일괄 조회 ----
// 목록 자체는 브라우저 localStorage에 있다(서버에 두려면 공개 URL에 쓰기 엔드포인트를
// 열어야 하는데, 웹앱이 ANYONE_ANONYMOUS라 URL을 아는 누구나 남의 목록을 바꿀 수 있다).
// 백엔드는 "심볼 여러 개의 현재 시세"만 담당한다.
var WATCHLIST_MAX_ = 20;

function getQuotes(symbolsCsv, noCache) {
  const symbols = String(symbolsCsv || '')
    .split(',')
    .map(function (s) { return s.trim(); })
    .filter(function (s) { return s && s.length <= 40; })
    .slice(0, WATCHLIST_MAX_);
  if (!symbols.length) return { quotes: [] };

  // 심볼을 그대로 캐시 키에 쓰면 20개일 때 250자 제한을 넘길 수 있어 해시로 줄인다.
  const cacheKey = 'quotes_' + md5_(symbols.join(',').toLowerCase());
  const cached = noCache ? null : cacheGet_(cacheKey);
  if (cached) return cached;

  // 워치리스트에는 이미 확정된 티커만 들어오므로(검색으로 찾아서 담기 때문에)
  // resolveSymbol_ 없이 곧바로 시세만 병렬로 받는다.
  const jobs = symbols.map(function (s) { return { name: s, url: yahooChartUrl_(s) }; });
  const responses = fetchJobsSafe_(jobs);

  const quotes = jobs.map(function (j, i) {
    try {
      const res = responses[i];
      if (!res) throw new Error('연결 오류');
      const code = res.getResponseCode();
      if (code >= 400) throw new Error('HTTP ' + code);
      return { symbol: j.name, quote: parseYahooQuote_(JSON.parse(res.getContentText())) };
    } catch (err) {
      // 한 종목이 실패해도 나머지는 그대로 보여준다.
      return { symbol: j.name, error: String(err) };
    }
  });

  const data = { quotes: quotes };
  cachePut_(cacheKey, data, 300); // 5분 캐시 (시세라 짧게)
  return data;
}

// ---- 시가총액 상위 / 급등락 순위 (네이버 금융) ----
// 코스피 전 종목의 시가총액과 등락률을 한 번에 주는 무료 소스가 마땅치 않다.
//  - Yahoo screener: crumb 인증이 걸려 GAS에서 못 쓴다(quoteSummary와 같은 이유).
//  - KRX data.krx.co.kr: 세션 보호가 걸려 있어 POST하면 "LOGOUT"만 돌아온다.
// 그래서 네이버 금융의 시가총액 페이지를 파싱한다. 사용자가 "네이버 증권 메인 화면
// 느낌"이라고 한 그 화면이기도 하다.
//
// ⚠️ HTML 스크래핑이라 네이버가 표 구조를 바꾸면 깨진다. 페이지당 50종목이고
// 표의 각 행은 td 13칸으로 고정돼 있다:
//   [0]순위 [1]종목명 [2]현재가 [3]전일비 [4]등락률 [5]액면가 [6]시가총액(억) [7]상장주식수(천주) ...
// ⚠️ 이 페이지는 EUC-KR이다. getContentText()를 그냥 부르면 한글이 깨진다.
var NAVER_SISE_URL_ = 'https://finance.naver.com/sise/sise_market_sum.naver';
var MARKET_PAGES_ = 2; // 페이지당 50종목 → 상위 100종목

function getMarket(noCache) {
  const cached = noCache ? null : cacheGet_('market');
  if (cached) return cached;

  const jobs = [];
  for (var p = 1; p <= MARKET_PAGES_; p++) {
    jobs.push({
      name: 'p' + p,
      url: NAVER_SISE_URL_ + '?sosok=0&page=' + p, // sosok=0 코스피, 1 코스닥
      headers: { 'User-Agent': BROWSER_LIKE_HEADERS_['User-Agent'] }
    });
  }

  const responses = fetchJobsSafe_(jobs);
  const items = [];
  const seen = {};
  responses.forEach(function (res, i) {
    try {
      if (!res) throw new Error('연결 오류');
      const code = res.getResponseCode();
      if (code >= 400) throw new Error('HTTP ' + code);
      parseNaverSise_(res.getContentText('EUC-KR')).forEach(function (it) {
        if (seen[it.code]) return; // 페이지 경계에서 겹치는 경우 대비
        seen[it.code] = true;
        items.push(it);
      });
    } catch (err) {
      console.log('getMarket: ' + jobs[i].name + ' 실패(건너뜀) - ' + err);
    }
  });

  const data = items.length
    ? { items: items, at: new Date().toISOString() }
    : { items: [], error: '순위를 불러오지 못했습니다.' };
  cachePut_('market', data, 600); // 10분 캐시
  return data;
}

function parseNaverSise_(html) {
  const out = [];
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
  let tr;
  while ((tr = trRe.exec(html)) !== null) {
    const row = tr[1];
    // 종목 행에만 종목 링크가 있다(합계/헤더 행 제외).
    const codeMatch = row.match(/\/item\/main\.naver\?code=(\d+)/);
    if (!codeMatch) continue;

    const cells = [];
    const tdRe = /<td[^>]*>([\s\S]*?)<\/td>/g;
    let td;
    while ((td = tdRe.exec(row)) !== null) {
      cells.push(stripTags_(td[1]).replace(/\s+/g, ' ').trim());
    }
    if (cells.length < 8) continue;

    const num = function (s) {
      const v = parseFloat(String(s).replace(/[^0-9.\-]/g, ''));
      return isNaN(v) ? null : v;
    };
    const name = cells[1];
    const changePct = num(cells[4]);
    if (!name || changePct === null) continue;

    out.push({
      code: codeMatch[1],
      name: name,
      price: num(cells[2]),
      changePct: changePct,
      marketCap: num(cells[6]) // 억원 단위
    });
  }
  return out;
}

function md5_(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, s)
    .map(function (b) { return ((b & 0xFF) + 0x100).toString(16).slice(1); })
    .join('');
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
    jobs.push({
      name: 'macro',
      url: fredReleaseDatesUrl_(fredKey, from, to, 0),
      parse: function (text) {
        return parseFredReleases_(collectFredPages_(fredKey, from, to, JSON.parse(text)));
      }
    });
  }
  if (finnhubKey) {
    jobs.push({
      name: 'earnings',
      url: 'https://finnhub.io/api/v1/calendar/earnings?from=' + from + '&to=' + to + '&token=' + finnhubKey,
      parse: function (text) { return parseMajorEarnings_(JSON.parse(text)); }
    });
  }
  // 국내(코스피) 실적은 키가 필요 없다 — KIND는 공개 화면이라 그대로 조회한다.
  jobs.push(kindEarningsJob_(from, to));

  const responses = fetchJobsSafe_(jobs);
  const data = { macro: [], earnings: [], krEarnings: [], from: from, to: to };
  jobs.forEach(function (j, i) {
    try {
      const res = responses[i];
      if (!res) throw new Error('연결 오류');
      const code = res.getResponseCode();
      if (code >= 400) throw new Error('HTTP ' + code);
      data[j.name] = j.parse(res.getContentText());
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

// ---- 국내(코스피) 실적 발표: 한국거래소 KIND의 IR 일정 ----
// KIND는 JSON API가 아니라 HTML 표를 그리는 화면이라 POST로 조회해서 표를 파싱한다.
// 브라우저가 하는 요청을 그대로 흉내내야 하므로 Referer와 form 파라미터가 필요하다.
// (method/forward 값은 화면 JS가 폼에 채워 넣는 값 그대로다.)
var KIND_IR_URL_ = 'https://kind.krx.co.kr/corpgeneral/irschedule.do';
var KIND_MARKET_KOSPI_ = '1'; // 1=유가증권시장(코스피), 2=코스닥

// IR 일정에는 실적 발표 말고도 NDR·기업설명회·부스 운영 같은 게 섞여 있어서
// 실적 관련만 골라낸다.
var KIND_EARNINGS_RE_ = /실적|결산|Earnings|Financial Results/i;

function kindEarningsJob_(from, to) {
  return {
    name: 'krEarnings',
    url: KIND_IR_URL_,
    parse: parseKindEarnings_,
    options: {
      method: 'post',
      contentType: 'application/x-www-form-urlencoded; charset=UTF-8',
      headers: {
        'User-Agent': BROWSER_LIKE_HEADERS_['User-Agent'],
        'Referer': KIND_IR_URL_ + '?method=searchIRScheduleMain&gubun=iRSchedule'
      },
      payload: {
        method: 'searchIRScheduleSub',
        forward: 'searchirschedule_sub',
        currentPageSize: '3000',
        pageIndex: '1',
        fromDate: from,
        toDate: to,
        marketType: KIND_MARKET_KOSPI_
      }
    }
  };
}

function parseKindEarnings_(html) {
  const out = [];
  const seen = {};
  // 표의 각 행은 [번호, 회사명, 내용, 장소, 날짜, 시간] 6칸으로 고정돼 있다.
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
  let tr;
  while ((tr = trRe.exec(html)) !== null) {
    const cells = [];
    const tdRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g;
    let td;
    while ((td = tdRe.exec(tr[1])) !== null) {
      cells.push(stripTags_(td[1]).replace(/\s+/g, ' ').trim());
    }
    if (cells.length !== 6) continue;

    const corp = cells[1], desc = cells[2], date = cells[4], time = cells[5];
    if (!corp || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    if (!KIND_EARNINGS_RE_.test(desc)) continue;

    // 같은 행사를 국문/영문 두 건으로 올리는 회사가 많다. 회사+날짜로 묶고,
    // 화면에 한글 설명이 뜨도록 한글이 들어간 쪽을 남긴다.
    const key = corp + '|' + date;
    const isKorean = /[가-힣]/.test(desc);
    if (seen[key]) {
      if (isKorean && !seen[key].korean) {
        seen[key].item.desc = desc;
        seen[key].korean = true;
      }
      continue;
    }
    const item = { date: date, corp: corp, desc: desc, time: /^\d{2}:\d{2}$/.test(time) ? time : '' };
    seen[key] = { item: item, korean: isKorean };
    out.push(item);
  }
  return out
    .sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; })
    .slice(0, 250);
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
  return String(s)
    .replace(/<[^>]*>/g, '')
    .replace(/&#(\d+);/g, function (_, code) { return String.fromCharCode(parseInt(code, 10)); })
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    // &amp;는 반드시 마지막에 — 먼저 풀면 "&amp;quot;" 같은 이중 인코딩이 깨진다.
    .replace(/&amp;/g, '&');
}

// ================= 5. AI 브리핑 + 뉴스 중요도 (Claude API) =================
// 네이버 뉴스 검색 API에는 "중요도" 개념이 없어서 최신순 정렬만 가능했다. 그날 헤드라인을
// Claude에게 통째로 넘겨 요약과 중요도 점수를 **한 번의 호출로 같이** 받아서 그 문제를 푼다.
//
// ECOS와 같은 이유로 이 호출도 사용자 요청 경로에 두지 않는다 — 대시보드를 열 때마다
// Claude 응답을 기다리면 느려지므로, 트리거가 미리 만들어 스크립트 속성에 저장해두고
// doGet은 그 저장값만 읽는다.
var ANTHROPIC_URL_ = 'https://api.anthropic.com/v1/messages';
var AI_BRIEFING_PROP_ = 'AI_BRIEFING_V1';
// 갱신 주기(3시간)보다 넉넉히 잡아야 정상 동작 중에 "오래됨"으로 잘못 표시되지 않는다.
var AI_BRIEFING_MAX_AGE_MS_ = 8 * 60 * 60 * 1000;

// 구조화된 출력(output_config.format) 스키마. 이걸 주면 응답이 반드시 이 형태의 JSON이라
// 파싱 실패를 걱정하지 않아도 된다. 주의: 구조화된 출력은 minimum/maximum 같은 수치 제약을
// 지원하지 않으므로 점수 범위는 enum으로 표현하고, 모든 object에 additionalProperties:false와
// required가 있어야 한다.
// 카테고리별 한 줄 요약에 쓰는 고정 키. 프론트가 이 순서대로 그리고, 스키마의 enum으로도
// 쓰여서 모델이 임의의 카테고리를 만들어내지 못하게 막는다(라벨은 프론트가 붙인다).
var SECTOR_KEYS_ = ['kospi', 'nasdaq', 'fx', 'oil', 'crypto', 'domestic', 'global'];

var BRIEFING_SCHEMA_ = {
  type: 'object',
  properties: {
    summary: {
      type: 'string',
      description: '오늘의 경제 브리핑. 한국어 3~4문장. 지표 흐름과 주요 뉴스를 엮어서 작성. ' +
        '시장을 아는 사람이 빠르게 읽는 용도라 군더더기 없이 간결하게.'
    },
    summaryEasy: {
      type: 'string',
      description: '같은 내용을 **주식을 막 시작한 사람**에게 설명하듯 다시 쓴 것. 3~4문장. ' +
        '어려운 용어는 괄호로 짧게 풀고, 그래서 이게 무슨 의미인지까지 알려줄 것. ' +
        '예: "환율이 내렸어요(원화 가치가 올랐다는 뜻이에요). 해외 주식을 사기엔 조금 유리해진 셈이에요."'
    },
    terms: {
      type: 'array',
      description: '오늘 브리핑·뉴스에 나온 어려운 경제 용어 3~4개 풀이. 초보자 모드에서 보여준다.',
      items: {
        type: 'object',
        properties: {
          term: { type: 'string', description: '용어 (12자 이내)' },
          plain: { type: 'string', description: '초보자도 이해할 한 문장 설명 (40자 내외)' }
        },
        required: ['term', 'plain'],
        additionalProperties: false
      }
    },
    hashtags: {
      type: 'array',
      description: '오늘 시장을 관통하는 키워드 5~8개. "#" 없이 단어만. ' +
        '"경제"처럼 뻔한 말 말고 "반도체급락"·"FOMC대기"처럼 오늘을 특정하는 말로.',
      items: { type: 'string' }
    },
    sectors: {
      type: 'array',
      description: '카테고리별 한 줄 요약. 아래 7개 key 전부에 대해 하나씩, 총 7개.',
      items: {
        type: 'object',
        properties: {
          key: {
            type: 'string',
            enum: SECTOR_KEYS_,
            description: 'kospi=코스피, nasdaq=나스닥, fx=원/달러 환율, oil=국제유가, ' +
              'crypto=코인, domestic=국내 경제 전반, global=해외 경제 전반'
          },
          line: {
            type: 'string',
            description: '그 카테고리의 오늘 흐름을 한국어 한 문장(40자 내외)으로. ' +
              '수치가 있으면 넣고, 없으면 뉴스에서 읽히는 분위기로.'
          },
          tone: {
            type: 'string',
            enum: ['up', 'down', 'flat'],
            // 화살표(▲▼)로 그려지는 값이라 문장의 수치와 방향이 어긋나면 안 된다.
            // 실제로 환율에서 "-0.90 원화 강세"에 up을 준 적이 있다 — 좋고 나쁨이 아니라
            // 숫자의 방향이라고 못박아야 한다.
            description: '**숫자 자체의 방향**. 수치가 있는 카테고리(kospi/nasdaq/fx/oil/crypto)는 ' +
              '그 수치가 전일 대비 올랐으면 up, 내렸으면 down. 좋고 나쁨으로 판단하지 말 것 — ' +
              '환율은 원/달러 숫자가 내려가면(원화 강세여도) down이다. ' +
              'domestic/global처럼 수치가 없는 항목만 분위기로 판단하고, 애매하면 flat.'
          }
        },
        required: ['key', 'line', 'tone'],
        additionalProperties: false
      }
    },
    rankings: {
      type: 'array',
      description: '입력으로 준 뉴스 전부에 대한 중요도 평가. 뉴스 하나당 항목 하나씩.',
      items: {
        type: 'object',
        properties: {
          id: { type: 'integer', description: '입력 뉴스 목록에서의 번호' },
          importance: { type: 'integer', enum: [1, 2, 3, 4, 5], description: '5가 가장 중요' },
          reason: { type: 'string', description: '그 점수를 준 이유. 한국어 한 문장.' }
        },
        required: ['id', 'importance', 'reason'],
        additionalProperties: false
      }
    }
  },
  required: ['summary', 'summaryEasy', 'terms', 'hashtags', 'sectors', 'rankings'],
  additionalProperties: false
};

/** doGet에서 읽는 함수. 저장된 브리핑을 그대로 돌려준다(외부 호출 없음 = 즉시 응답). */
function getBriefing() {
  const raw = PropertiesService.getScriptProperties().getProperty(AI_BRIEFING_PROP_);
  const empty = { summary: null, summaryEasy: null, terms: [], hashtags: [], sectors: [], importance: {} };
  if (!raw) return empty;
  try {
    const parsed = JSON.parse(raw);
    // 예전 형식(해시태그/섹터가 없던 시절)이 저장돼 있어도 프론트가 깨지지 않게 채워준다.
    parsed.importance = parsed.importance || {};
    parsed.hashtags = parsed.hashtags || [];
    parsed.sectors = parsed.sectors || [];
    parsed.terms = parsed.terms || [];
    parsed.summaryEasy = parsed.summaryEasy || null;
    parsed.stale = !!(parsed.at && (Date.now() - new Date(parsed.at).getTime()) > AI_BRIEFING_MAX_AGE_MS_);
    return parsed;
  } catch (err) {
    return empty;
  }
}

/** 트리거가 호출하는 함수. 직접 실행해도 된다(브리핑을 지금 바로 갱신하고 싶을 때). */
function refreshAiBriefing() {
  const props = PropertiesService.getScriptProperties();
  const key = props.getProperty('ANTHROPIC_API_KEY');
  if (!key) {
    console.log('refreshAiBriefing: ANTHROPIC_API_KEY 미설정 - 건너뜀');
    return;
  }

  const news = collectAllNews_();
  if (!news.length) {
    console.log('refreshAiBriefing: 뉴스를 못 받아와서 건너뜀(기존 값 유지)');
    return;
  }

  const result = callClaudeBriefing_(key, safe_(getRates), news);
  if (!result) return; // 실패 사유는 callClaudeBriefing_ 안에서 로그로 남긴다

  // 중요도는 **링크를 키로** 저장한다. 프론트가 카테고리 필터를 걸면 배열 인덱스는
  // 흔들리지만 링크는 고정이라 항목과 안전하게 맞춰볼 수 있다.
  const importance = {};
  (result.rankings || []).forEach(function (r) {
    const item = news[r.id];
    if (item && item.link) importance[item.link] = r.importance;
  });

  // 스크립트 속성은 값 하나당 9KB 제한이라 reason은 저장하지 않는다(점수만 있으면 정렬은 된다).
  // 그래도 스키마에는 남겨둔다 — 이유를 함께 쓰게 하면 점수 자체가 더 정확해진다.
  // 해시태그/섹터도 같은 이유로 길이를 잘라둔다(한글은 JSON에서 문자당 6바이트로 불어난다).
  const hashtags = (result.hashtags || [])
    .map(function (h) { return String(h).replace(/^#/, '').trim().slice(0, 20); })
    .filter(Boolean)
    .slice(0, 8);

  // 모델이 같은 key를 두 번 쓰거나 빠뜨릴 수 있으니 고정 순서로 정리한다.
  const bySector = {};
  (result.sectors || []).forEach(function (s) {
    if (s && SECTOR_KEYS_.indexOf(s.key) !== -1 && !bySector[s.key]) {
      bySector[s.key] = { key: s.key, line: String(s.line || '').slice(0, 80), tone: s.tone || 'flat' };
    }
  });
  const sectors = SECTOR_KEYS_
    .map(function (k) { return bySector[k]; })
    .filter(Boolean);

  // 스크립트 속성 9KB 제한이 있어 용어 풀이도 개수와 길이를 잘라둔다.
  const terms = (result.terms || [])
    .filter(function (t) { return t && t.term && t.plain; })
    .map(function (t) { return { term: String(t.term).slice(0, 14), plain: String(t.plain).slice(0, 60) }; })
    .slice(0, 4);

  // 주간 리포트를 만들려면 매일 기록이 쌓여 있어야 한다.
  saveDailyBrief_(props, result.summary, hashtags, terms);

  props.setProperty(AI_BRIEFING_PROP_, JSON.stringify({
    summary: result.summary,
    summaryEasy: result.summaryEasy,
    terms: terms,
    hashtags: hashtags,
    sectors: sectors,
    importance: importance,
    at: new Date().toISOString()
  }));
  console.log('refreshAiBriefing: 갱신 완료 (뉴스 ' + news.length + '건, 섹터 ' +
    sectors.length + '/' + SECTOR_KEYS_.length + ', 태그 ' + hashtags.length +
    ', 용어 ' + terms.length + ', 쉬운요약 ' + (result.summaryEasy ? 'O' : 'X') + ')');
}

// ================= 6. 종목별 "왜 움직였나" =================
// 증권사 앱·네이버 증권은 "삼성전자 -13.4%"까지만 보여주고 왜 떨어졌는지는 알려주지 않는다.
// 그 종목 뉴스를 모아 오늘 등락의 원인을 설명해주는 게 이 프로젝트의 차별점이다.
//
// 브리핑과 달리 **사용자가 누를 때만** 호출한다(모든 종목을 미리 만들어둘 수 없으므로).
// 그래서 종목별로 캐시를 걸어 같은 종목을 반복해서 눌러도 과금이 늘지 않게 한다.
var EXPLAIN_CACHE_SEC_ = 1800; // 30분

var EXPLAIN_SCHEMA_ = {
  type: 'object',
  properties: {
    explanation: {
      type: 'string',
      description: '오늘 이 종목이 왜 그렇게 움직였는지 한국어 2~3문장. 초보자도 이해할 수 있게 ' +
        '쉬운 말로. 근거가 되는 뉴스가 없으면 추측하지 말고 "뉴스에서 뚜렷한 원인을 찾지 못했다"고 밝힐 것.'
    },
    evidence: {
      type: 'array',
      description: '설명의 근거가 된 뉴스. 관련 뉴스가 없으면 빈 배열.',
      items: {
        type: 'object',
        properties: {
          id: { type: 'integer', description: '입력 뉴스 목록에서의 번호' },
          note: { type: 'string', description: '이 뉴스가 왜 근거가 되는지 한국어 한 문장' }
        },
        required: ['id', 'note'],
        additionalProperties: false
      }
    },
    confidence: {
      type: 'string',
      enum: ['high', 'medium', 'low'],
      description: '설명의 확신도. 뉴스가 등락을 직접 설명하면 high, 정황만 있으면 medium, ' +
        '관련 뉴스를 못 찾았으면 low.'
    }
  },
  required: ['explanation', 'evidence', 'confidence'],
  additionalProperties: false
};

function getExplain(symbol, name, noCache) {
  const sym = String(symbol || '').trim();
  const nm = String(name || '').trim() || sym;
  if (!sym) return { error: '종목 코드가 없습니다.' };
  if (sym.length > 40 || nm.length > 60) return { error: '입력이 너무 깁니다.' };

  const cacheKey = 'explain_' + md5_((sym + '|' + nm).toLowerCase());
  const cached = noCache ? null : cacheGet_(cacheKey);
  if (cached) return cached;

  const key = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  if (!key) return { error: 'AI 설명 기능은 ANTHROPIC_API_KEY가 설정돼야 동작합니다.' };

  const quote = safe_(function () { return getYahooQuote_(sym); });
  const news = searchStockNews_(nm);
  if (!news.length) {
    return { symbol: sym, name: nm, quote: quote, explanation: null,
      error: '"' + nm + '" 관련 뉴스를 찾지 못했어요.' };
  }

  // 개별 종목 뉴스만 보면 "원인을 못 찾겠다"로 끝나는 경우가 많다. 실제로는 시장 전체가
  // 빠져서 같이 밀린 날이 흔하기 때문 — 그 판단을 할 수 있게 시장 상황을 같이 넘긴다.
  const result = callClaudeExplain_(key, nm, quote, news, marketContext_());
  if (!result) return { symbol: sym, name: nm, quote: quote, explanation: null,
    error: '설명을 만들지 못했어요. 잠시 후 다시 시도해주세요.' };

  // 링크는 **백엔드가** 붙인다. 모델에게 URL을 쓰게 하면 없는 주소를 지어낼 수 있다.
  const evidence = (result.evidence || [])
    .map(function (e) {
      const item = news[e.id];
      return item ? { title: item.title, link: item.link, pubDate: item.pubDate, note: e.note } : null;
    })
    .filter(Boolean)
    .slice(0, 4);

  const data = {
    symbol: sym, name: nm, quote: quote,
    explanation: result.explanation,
    confidence: result.confidence,
    evidence: evidence,
    at: new Date().toISOString()
  };
  cachePut_(cacheKey, data, EXPLAIN_CACHE_SEC_);
  return data;
}

// 이미 만들어둔 지표와 브리핑에서 "오늘 시장이 어땠는지"를 뽑는다. 추가 호출이 없어 공짜다.
function marketContext_() {
  const parts = [];
  const rates = safe_(getRates);
  if (rates && !rates.error) {
    ['kospi', 'nasdaq'].forEach(function (k) {
      const v = rates[k];
      if (v && !v.error && v.changePct != null) {
        parts.push((k === 'kospi' ? '코스피' : '나스닥') + ' ' + v.changePct.toFixed(2) + '%');
      }
    });
  }
  const brief = getBriefing();
  return {
    indices: parts.join(', '),
    summary: (brief && brief.summary) || ''
  };
}

// 종목명으로 네이버 뉴스를 검색한다. 등락 원인을 찾는 게 목적이라 최근 기사만 쓴다.
// 정확도순(sim)만 쓰면 오늘 벌어진 일이 빠지고, 최신순(date)만 쓰면 이름만 겹치는 기사가
// 섞인다. 둘을 합쳐서 링크로 중복 제거한다.
function searchStockNews_(name) {
  const headers = {
    'X-Naver-Client-Id': getProp_('NAVER_CLIENT_ID'),
    'X-Naver-Client-Secret': getProp_('NAVER_CLIENT_SECRET')
  };
  const jobs = ['sim', 'date'].map(function (sort) {
    return {
      name: sort,
      url: 'https://openapi.naver.com/v1/search/news.json?query=' + encodeURIComponent(name) +
        '&display=15&sort=' + sort,
      headers: headers
    };
  });

  const cutoff = Date.now() - 3 * 24 * 60 * 60 * 1000; // 최근 3일
  const out = [];
  const seen = {};
  fetchJobsSafe_(jobs).forEach(function (res, i) {
    try {
      if (!res || res.getResponseCode() >= 400) throw new Error('조회 실패');
      (JSON.parse(res.getContentText()).items || []).forEach(function (it) {
        if (!it.link || seen[it.link]) return;
        const ts = new Date(it.pubDate).getTime();
        if (ts && ts < cutoff) return;
        seen[it.link] = true;
        out.push({
          title: stripTags_(it.title),
          description: stripTags_(it.description),
          link: it.link,
          pubDate: it.pubDate
        });
      });
    } catch (err) {
      console.log('searchStockNews_: ' + jobs[i].name + ' 실패(건너뜀) - ' + err);
    }
  });
  return out.slice(0, 14);
}

function callClaudeExplain_(apiKey, name, quote, news, market) {
  const moved = quote && !quote.error && quote.changePct != null
    ? name + '은(는) 오늘 ' + quote.changePct.toFixed(2) + '% ' +
      (quote.changePct >= 0 ? '올랐어' : '내렸어') + '(현재가 ' + quote.value + ').'
    : name + '의 오늘 등락률은 확인되지 않았어.';

  const lines = news.map(function (n, i) {
    return i + '. ' + n.title + ' — ' + String(n.description || '').slice(0, 100);
  }).join('\n');

  const ctx = [];
  if (market && market.indices) ctx.push('오늘 시장: ' + market.indices);
  if (market && market.summary) ctx.push('오늘 시장 브리핑: ' + market.summary);

  const prompt =
    moved + '\n\n' +
    (ctx.length ? '[시장 상황]\n' + ctx.join('\n') + '\n\n' : '') +
    '[' + name + ' 관련 최근 뉴스]\n' + lines + '\n\n' +
    'explanation에는 오늘 이 종목이 왜 그렇게 움직였는지 초보 투자자도 이해할 수 있게 ' +
    '2~3문장으로 설명해줘. 어려운 용어를 쓰면 괄호로 짧게 풀어줘.\n' +
    'evidence에는 근거가 된 뉴스 번호를 최대 4개까지 골라줘.\n' +
    '개별 종목 뉴스에 뚜렷한 악재·호재가 없더라도, 시장 전체가 크게 움직인 날이면 ' +
    '"개별 이슈보다는 시장 전체 흐름을 따라간 것으로 보인다"고 설명해도 좋아. ' +
    '그게 실제로 가장 흔한 이유이기도 하고, 초보자가 가장 궁금해하는 부분이야.\n' +
    '⚠️ 다만 뉴스에 없는 사실을 **지어내지는 마**. 구체적인 악재를 아는 것처럼 쓰면 안 돼. ' +
    '근거가 정말 없으면 솔직히 밝히고 evidence는 비우고 confidence는 low로 해. ' +
    '종목명만 겹칠 뿐 주가와 무관한 기사(홍보·행사 등)는 근거로 쓰지 마.\n' +
    '⚠️ 매수/매도 추천이나 목표가는 절대 쓰지 마. 지금 무슨 일이 있었는지만 설명해.';

  let res;
  try {
    res = UrlFetchApp.fetch(ANTHROPIC_URL_, {
      method: 'post',
      contentType: 'application/json',
      muteHttpExceptions: true,
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      payload: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 1500,
        output_config: { format: { type: 'json_schema', schema: EXPLAIN_SCHEMA_ } },
        system: '너는 초보 투자자에게 주식 시장을 쉽게 설명해주는 도우미야. ' +
          '투자 권유는 하지 않고, 무슨 일이 있었는지 사실만 담백하게 전한다.',
        messages: [{ role: 'user', content: prompt }]
      })
    });
  } catch (err) {
    console.log('callClaudeExplain_: 연결 실패 - ' + err);
    return null;
  }

  const code = res.getResponseCode();
  const body = res.getContentText();
  if (code >= 400) { console.log('callClaudeExplain_: HTTP ' + code + ' - ' + body.slice(0, 300)); return null; }

  const json = JSON.parse(body);
  if (json.stop_reason === 'refusal' || json.stop_reason === 'max_tokens') {
    console.log('callClaudeExplain_: stop_reason=' + json.stop_reason);
    return null;
  }
  const textBlock = (json.content || []).filter(function (b) { return b.type === 'text'; })[0];
  if (!textBlock) return null;
  try {
    return JSON.parse(textBlock.text);
  } catch (err) {
    console.log('callClaudeExplain_: JSON 파싱 실패 - ' + err);
    return null;
  }
}

// ================= 8. 주간 리포트 =================
// 브리핑은 최신 1건만 저장하므로, 주간으로 돌아보려면 매일 따로 쌓아둬야 한다.
// 하루치를 각각 별도 속성(BRIEF_DAY_2026-07-29)에 저장한다 — 한 값에 몰아넣으면
// 스크립트 속성의 값당 9KB 제한에 금방 걸린다.
var BRIEF_DAY_PREFIX_ = 'BRIEF_DAY_';
var BRIEF_KEEP_DAYS_ = 21;

// 브리핑을 갱신할 때마다 그날 기록을 남긴다(같은 날 여러 번 돌면 마지막 것으로 덮어씀).
function saveDailyBrief_(props, summary, hashtags, terms) {
  const today = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd');
  props.setProperty(BRIEF_DAY_PREFIX_ + today, JSON.stringify({
    date: today,
    summary: String(summary || '').slice(0, 400),
    hashtags: (hashtags || []).slice(0, 6),
    terms: (terms || []).slice(0, 3)
  }));

  // 오래된 기록은 지운다. 속성 전체 용량(500KB)과 목록 조회 비용을 아끼기 위함.
  const cutoff = Utilities.formatDate(
    new Date(Date.now() - BRIEF_KEEP_DAYS_ * 24 * 60 * 60 * 1000), 'Asia/Seoul', 'yyyy-MM-dd');
  Object.keys(props.getProperties()).forEach(function (k) {
    if (k.indexOf(BRIEF_DAY_PREFIX_) === 0 && k.slice(BRIEF_DAY_PREFIX_.length) < cutoff) {
      props.deleteProperty(k);
    }
  });
}

function loadDailyBriefs_(days) {
  const props = PropertiesService.getScriptProperties().getProperties();
  const from = Utilities.formatDate(
    new Date(Date.now() - days * 24 * 60 * 60 * 1000), 'Asia/Seoul', 'yyyy-MM-dd');
  const out = [];
  Object.keys(props).forEach(function (k) {
    if (k.indexOf(BRIEF_DAY_PREFIX_) !== 0) return;
    if (k.slice(BRIEF_DAY_PREFIX_.length) < from) return;
    try { out.push(JSON.parse(props[k])); } catch (err) { /* 깨진 기록은 건너뜀 */ }
  });
  return out.sort(function (a, b) { return a.date < b.date ? -1 : 1; });
}

var WEEKLY_SCHEMA_ = {
  type: 'object',
  properties: {
    overview: {
      type: 'string',
      description: '이번 주 시장 흐름 요약. 한국어 4~5문장. 날마다 나열하지 말고 ' +
        '"무엇이 이어졌고 무엇이 바뀌었는지" 흐름으로 써줄 것.'
    },
    keyEvents: {
      type: 'array',
      description: '이번 주 가장 중요했던 일 3~4개.',
      items: {
        type: 'object',
        properties: {
          date: { type: 'string', description: '해당 날짜 (YYYY-MM-DD)' },
          event: { type: 'string', description: '무슨 일이었는지 한 문장' }
        },
        required: ['date', 'event'],
        additionalProperties: false
      }
    },
    lessons: {
      type: 'array',
      description: '이번 주 기록에 나온 경제 개념 3~4개를 초보자용으로 정리. 학습용.',
      items: {
        type: 'object',
        properties: {
          term: { type: 'string', description: '개념 이름 (14자 이내)' },
          plain: { type: 'string', description: '한 문장 설명 (50자 내외)' }
        },
        required: ['term', 'plain'],
        additionalProperties: false
      }
    }
  },
  required: ['overview', 'keyEvents', 'lessons'],
  additionalProperties: false
};

function getWeekly(noCache) {
  const briefs = loadDailyBriefs_(7);
  if (briefs.length < 2) {
    return { days: briefs.length, error: '주간 리포트는 브리핑이 2일치 이상 쌓여야 만들 수 있어요. ' +
      '지금은 ' + briefs.length + '일치가 쌓였습니다.' };
  }

  const cacheKey = 'weekly_' + md5_(briefs.map(function (b) { return b.date; }).join(','));
  const cached = noCache ? null : cacheGet_(cacheKey);
  if (cached) return cached;

  const key = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  if (!key) return { days: briefs.length, error: 'AI 리포트는 ANTHROPIC_API_KEY가 설정돼야 동작합니다.' };

  const result = callClaudeWeekly_(key, briefs);
  if (!result) return { days: briefs.length, error: '리포트를 만들지 못했어요. 잠시 후 다시 시도해주세요.' };

  const data = {
    from: briefs[0].date, to: briefs[briefs.length - 1].date, days: briefs.length,
    overview: result.overview,
    keyEvents: (result.keyEvents || []).slice(0, 4),
    lessons: (result.lessons || []).slice(0, 4),
    daily: briefs.map(function (b) { return { date: b.date, summary: b.summary }; }),
    at: new Date().toISOString()
  };
  cachePut_(cacheKey, data, 21600); // 6시간 (하루 기록이 늘면 캐시 키가 바뀌어 자연히 갱신됨)
  return data;
}

function callClaudeWeekly_(apiKey, briefs) {
  const lines = briefs.map(function (b) {
    return '[' + b.date + '] ' + b.summary +
      (b.hashtags && b.hashtags.length ? ' (키워드: ' + b.hashtags.join(', ') + ')' : '');
  }).join('\n\n');

  const prompt =
    '아래는 최근 ' + briefs.length + '일간의 일일 경제 브리핑 기록이야.\n\n' + lines + '\n\n' +
    'overview에는 이번 주 시장 흐름을 4~5문장으로 정리해줘. 날짜별로 나열하지 말고 ' +
    '무엇이 이어졌고 무엇이 바뀌었는지 흐름으로 써줘.\n' +
    'keyEvents에는 가장 중요했던 일 3~4개를 날짜와 함께 골라줘.\n' +
    'lessons에는 이번 주 기록에 나온 경제 개념 3~4개를 초보자가 이해할 수 있게 정리해줘. ' +
    '이번 주 상황과 연결해서 설명하면 더 좋아.\n' +
    '⚠️ 기록에 없는 내용은 지어내지 마. 매수/매도 추천이나 다음 주 전망 예측도 하지 마.';

  let res;
  try {
    res = UrlFetchApp.fetch(ANTHROPIC_URL_, {
      method: 'post',
      contentType: 'application/json',
      muteHttpExceptions: true,
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      payload: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 2000,
        output_config: { format: { type: 'json_schema', schema: WEEKLY_SCHEMA_ } },
        system: '너는 초보 투자자가 한 주를 돌아보도록 돕는 도우미야. 기록에 있는 사실만 쓴다.',
        messages: [{ role: 'user', content: prompt }]
      })
    });
  } catch (err) {
    console.log('callClaudeWeekly_: 연결 실패 - ' + err);
    return null;
  }

  const code = res.getResponseCode();
  const body = res.getContentText();
  if (code >= 400) { console.log('callClaudeWeekly_: HTTP ' + code + ' - ' + body.slice(0, 300)); return null; }

  const json = JSON.parse(body);
  if (json.stop_reason === 'refusal' || json.stop_reason === 'max_tokens') return null;
  const textBlock = (json.content || []).filter(function (b) { return b.type === 'text'; })[0];
  if (!textBlock) return null;
  try { return JSON.parse(textBlock.text); }
  catch (err) { console.log('callClaudeWeekly_: JSON 파싱 실패 - ' + err); return null; }
}

// ================= 7. 대시보드에 물어보기 =================
// 일반 챗봇과 다른 점은 "오늘 이 화면에 떠 있는 데이터"를 이미 알고 답한다는 것이다.
// 지표·브리핑·뉴스는 서버가 갖고 있고, 관심종목만 브라우저에서 받아온다.
//
// ⚠️ 웹앱이 ANYONE_ANONYMOUS라 이 엔드포인트는 누구나 호출할 수 있다. AI 호출은 과금되므로
// 하루 상한을 걸어 URL이 새어나가도 크레딧이 무한정 빠지지 않게 한다.
var ASK_DAILY_CAP_ = 120;
var ASK_COUNT_PROP_ = 'ASK_COUNT_V1';
var ASK_MAX_LEN_ = 200;

var ASK_SCHEMA_ = {
  type: 'object',
  properties: {
    answer: {
      type: 'string',
      description: '질문에 대한 답. 한국어 3~5문장. 주어진 데이터에 근거해서만 답하고, ' +
        '데이터에 없는 내용은 모른다고 밝힐 것. 초보자도 이해할 수 있게 쉬운 말로.'
    },
    relatedNews: {
      type: 'array',
      description: '답의 근거로 쓴 뉴스 번호. 없으면 빈 배열.',
      items: { type: 'integer' }
    },
    isAdvice: {
      type: 'boolean',
      description: '질문이 매수/매도 여부나 투자 판단을 물어본 것이면 true. ' +
        '(그런 질문이어도 추천하지 말고 판단에 필요한 상황만 설명할 것)'
    }
  },
  required: ['answer', 'relatedNews', 'isAdvice'],
  additionalProperties: false
};

function getAsk(question, symbolsCsv) {
  const q = String(question || '').trim();
  if (!q) return { error: '질문을 입력해주세요.' };
  if (q.length > ASK_MAX_LEN_) return { error: '질문이 너무 길어요. ' + ASK_MAX_LEN_ + '자 이내로 줄여주세요.' };

  const props = PropertiesService.getScriptProperties();
  const key = props.getProperty('ANTHROPIC_API_KEY');
  if (!key) return { error: 'AI 답변 기능은 ANTHROPIC_API_KEY가 설정돼야 동작합니다.' };

  // 같은 질문을 반복하면 캐시로 돌려줘서 과금과 대기 시간을 줄인다.
  const cacheKey = 'ask_' + md5_(q.toLowerCase() + '|' + String(symbolsCsv || ''));
  const cached = cacheGet_(cacheKey);
  if (cached) return cached;

  if (!bumpAskCount_(props)) {
    return { error: '오늘 질문 가능 횟수를 모두 사용했어요. 내일 다시 시도해주세요.' };
  }

  const news = collectAllNews_();
  const result = callClaudeAsk_(key, q, buildAskContext_(news, symbolsCsv), news);
  if (!result) return { error: '답변을 만들지 못했어요. 잠시 후 다시 시도해주세요.' };

  // 링크는 백엔드가 붙인다(모델이 URL을 지어내지 못하게).
  const sources = (result.relatedNews || [])
    .map(function (i) { return news[i]; })
    .filter(Boolean)
    .map(function (n) { return { title: n.title, link: n.link }; })
    .slice(0, 3);

  const data = {
    question: q,
    answer: result.answer,
    isAdvice: !!result.isAdvice,
    sources: sources,
    at: new Date().toISOString()
  };
  cachePut_(cacheKey, data, 1800); // 30분
  return data;
}

// 날짜가 바뀌면 카운터를 리셋한다. 한도를 넘으면 false.
function bumpAskCount_(props) {
  const today = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd');
  let rec = { date: today, n: 0 };
  try {
    const raw = props.getProperty(ASK_COUNT_PROP_);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed.date === today) rec = parsed;
    }
  } catch (err) { /* 깨졌으면 새로 시작 */ }

  if (rec.n >= ASK_DAILY_CAP_) return false;
  rec.n += 1;
  props.setProperty(ASK_COUNT_PROP_, JSON.stringify(rec));
  return true;
}

// 대시보드에 떠 있는 데이터를 전부 모아 넘긴다. 예전에는 지표·브리핑 요약·뉴스 제목만
// 넘겨서, 관심종목 시세나 급등락 순위를 물으면 "자료에 없다"거나 추측으로 답했다.
// 전부 이미 서버가 캐시해둔 값이라 추가 API 호출 없이 붙일 수 있다.
function buildAskContext_(news, symbolsCsv) {
  const ctx = [];

  const rates = safe_(getRates);
  if (rates && !rates.error) {
    const label = { base_rate_kr: '기준금리(한)', base_rate_us: '기준금리(미)', usdkrw: '원/달러',
      wti: 'WTI유가', kospi: '코스피', nasdaq: '나스닥', gold: '금', btc: '비트코인' };
    const lines = Object.keys(label).map(function (k) {
      const v = rates[k];
      if (!v || v.error || v.value == null) return null;
      return '- ' + label[k] + ': ' + v.value +
        (v.changePct != null ? ' (' + v.changePct.toFixed(2) + '%)'
          : v.change != null ? ' (' + v.change + ')' : '');
    }).filter(Boolean);
    if (lines.length) ctx.push('[오늘 지표]\n' + lines.join('\n'));
  }

  // 브리핑은 요약뿐 아니라 카테고리별 한 줄도 같이 넘긴다.
  const brief = getBriefing();
  if (brief && brief.summary) {
    let b = '[오늘 브리핑]\n' + brief.summary;
    if ((brief.sectors || []).length) {
      b += '\n' + brief.sectors.map(function (x) { return '- ' + x.key + ': ' + x.line; }).join('\n');
    }
    ctx.push(b);
  }

  // 관심종목은 이름만 넘기면 "어땠는지" 물어봐도 답을 못 한다. 실제 시세를 붙인다.
  const syms = String(symbolsCsv || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean);
  if (syms.length) {
    const q = safe_(function () { return getQuotes(syms.join(','), false); });
    const lines = ((q && q.quotes) || []).map(function (it) {
      if (it.error || !it.quote) return '- ' + it.symbol + ': 시세 조회 실패';
      return '- ' + it.symbol + ': ' + it.quote.value +
        (it.quote.changePct != null ? ' (' + it.quote.changePct.toFixed(2) + '%)' : '');
    });
    if (lines.length) ctx.push('[사용자 관심종목 오늘 시세]\n' + lines.join('\n'));
  }

  // 급등락 질문에 답하려면 순위표가 필요하다.
  const mk = safe_(function () { return getMarket(false); });
  const items = (mk && mk.items) || [];
  if (items.length) {
    const fmt = function (x) { return x.name + ' ' + x.changePct.toFixed(2) + '%'; };
    const byUp = items.slice().sort(function (a, b) { return b.changePct - a.changePct; });
    ctx.push('[코스피 상위 100종목 중]\n' +
      '- 시가총액 상위: ' + items.slice(0, 8).map(fmt).join(', ') + '\n' +
      '- 오늘 많이 오른 종목: ' + byUp.slice(0, 6).map(fmt).join(', ') + '\n' +
      '- 오늘 많이 내린 종목: ' + byUp.slice(-6).reverse().map(fmt).join(', '));
  }

  // 일정 질문("이번 주 실적발표 뭐 있어?")에 답하려면 캘린더가 필요하다.
  const cal = safe_(function () { return getCalendar(false); });
  if (cal && !cal.error) {
    const today = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd');
    const until = Utilities.formatDate(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), 'Asia/Seoul', 'yyyy-MM-dd');
    const soon = function (arr, fn) {
      return (arr || []).filter(function (x) { return x.date >= today && x.date <= until; })
        .slice(0, 10).map(fn);
    };
    const lines = []
      .concat(soon(cal.macro, function (x) { return '- ' + x.date + ' 지표: ' + x.name; }))
      .concat(soon(cal.krEarnings, function (x) { return '- ' + x.date + ' 국내실적: ' + x.corp; }))
      .concat(soon(cal.earnings, function (x) { return '- ' + x.date + ' 해외실적: ' + x.symbol; }));
    if (lines.length) ctx.push('[앞으로 7일 일정]\n' + lines.join('\n'));
  }

  // 뉴스는 제목만으론 내용을 알 수 없어 요약도 함께 넘긴다.
  if (news.length) {
    ctx.push('[오늘 뉴스]\n' + news.slice(0, 16).map(function (n, i) {
      return i + '. ' + n.title + ' — ' + String(n.description || '').slice(0, 110);
    }).join('\n'));
  }

  return ctx.join('\n\n');
}

function callClaudeAsk_(apiKey, question, context, news) {
  const prompt =
    context + '\n\n[질문]\n' + question + '\n\n' +
    '위에 있는 데이터로 답해줘. 지표·브리핑·관심종목 시세·종목 순위·일정·뉴스가 다 들어있으니 ' +
    '먼저 꼼꼼히 찾아보고, 있는 값은 **구체적인 숫자와 종목명으로** 답해. ' +
    '"~일 가능성이 높습니다" 같은 추측 대신 실제 수치를 써.\n' +
    '초보 투자자가 물어본다고 생각하고 쉬운 말로 3~5문장으로 답해줘. ' +
    '어려운 용어를 쓰면 괄호로 짧게 풀어줘.\n' +
    '정말 위 데이터에 없는 것(예: 재무제표, PER, 특정 종목의 과거 주가)을 물어보면 ' +
    '없다고 솔직히 말하고, 대신 지금 데이터로 답할 수 있는 걸 한 가지 제안해줘.\n' +
    '⚠️ "사도 돼?", "팔까?" 같은 질문이어도 **매수/매도를 추천하지 마.** ' +
    '대신 지금 상황이 어떤지, 판단할 때 무엇을 봐야 하는지를 설명하고 ' +
    '결정은 본인 몫이라는 점을 자연스럽게 전해. 그런 질문이면 isAdvice를 true로 해.\n' +
    '목표가나 수익률 예측도 하지 마.';

  let res;
  try {
    res = UrlFetchApp.fetch(ANTHROPIC_URL_, {
      method: 'post',
      contentType: 'application/json',
      muteHttpExceptions: true,
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      payload: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 1500,
        output_config: { format: { type: 'json_schema', schema: ASK_SCHEMA_ } },
        system: '너는 초보 투자자에게 오늘의 시장을 설명해주는 도우미야. ' +
          '주어진 데이터를 끝까지 살펴본 뒤 구체적인 숫자로 답하고, 투자 권유는 하지 않는다.',
        messages: [{ role: 'user', content: prompt }]
      })
    });
  } catch (err) {
    console.log('callClaudeAsk_: 연결 실패 - ' + err);
    return null;
  }

  const code = res.getResponseCode();
  const body = res.getContentText();
  if (code >= 400) { console.log('callClaudeAsk_: HTTP ' + code + ' - ' + body.slice(0, 300)); return null; }

  const json = JSON.parse(body);
  if (json.stop_reason === 'refusal' || json.stop_reason === 'max_tokens') {
    console.log('callClaudeAsk_: stop_reason=' + json.stop_reason);
    return null;
  }
  const textBlock = (json.content || []).filter(function (b) { return b.type === 'text'; })[0];
  if (!textBlock) return null;
  try { return JSON.parse(textBlock.text); }
  catch (err) { console.log('callClaudeAsk_: JSON 파싱 실패 - ' + err); return null; }
}

// 카테고리별로 나뉜 뉴스를 한 데 모은다. 'all'은 다른 카테고리와 겹치므로 링크로 중복 제거.
function collectAllNews_() {
  const out = [];
  const seen = {};
  ['all', 'world', 'domestic', 'politics_domestic', 'politics_intl'].forEach(function (c) {
    try {
      (getNews(c).items || []).forEach(function (n) {
        if (!n.link || seen[n.link]) return;
        seen[n.link] = true;
        out.push(n);
      });
    } catch (err) {
      console.log('collectAllNews_: ' + c + ' 실패(건너뜀) - ' + err);
    }
  });
  return out;
}

function callClaudeBriefing_(apiKey, rates, news) {
  const headlines = news.map(function (n, i) { return i + '. ' + n.title; }).join('\n');
  const prompt =
    '아래는 오늘 한국 경제 대시보드에 뜬 지표와 뉴스 헤드라인이야.\n\n' +
    '[지표]\n' + JSON.stringify(rates) + '\n\n' +
    '[뉴스 헤드라인]\n' + headlines + '\n\n' +
    'summary에는 지표 흐름과 주요 뉴스를 엮어 한국어 3~4문장 브리핑을 써줘.\n' +
    'summaryEasy에는 같은 내용을 주식을 막 시작한 사람에게 설명하듯 다시 써줘. ' +
    '어려운 용어는 괄호로 풀고, 그게 왜 중요한지까지 알려줘. 겁주지 말고 담담하게.\n' +
    'terms에는 오늘 내용에 나온 어려운 경제 용어 3~4개를 골라 한 문장씩 풀어줘.\n' +
    'hashtags에는 오늘 시장을 관통하는 키워드 5~8개를 뽑아줘. "경제"·"증시"처럼 아무 날에나 ' +
    '쓸 수 있는 말 말고, "반도체급락"·"FOMC대기"처럼 오늘을 특정하는 말로.\n' +
    'sectors에는 ' + SECTOR_KEYS_.join(', ') + ' 7개 전부에 대해 한 줄씩 써줘. ' +
    '지표에 수치가 있는 항목(코스피·나스닥·환율·유가·코인)은 수치를 넣고, ' +
    '국내/해외 전반은 뉴스에서 읽히는 분위기로 요약해. 뉴스에 근거가 없으면 무리해서 ' +
    '지어내지 말고 "특별한 움직임 없음" 식으로 담백하게 써.\n' +
    'tone은 화살표로 그려지니 문장 속 수치와 반드시 같은 방향이어야 해. ' +
    '문장에 "하락"이라고 썼으면 tone도 down이다. 환율은 원/달러 숫자가 내려가면 ' +
    '원화 강세여도 down으로 적어.\n' +
    '⚠️ 환율 방향을 헷갈리지 마. 원/달러 숫자가 **내려가면 원화 강세**(달러 대비 원화 가치 상승), ' +
    '**올라가면 원화 약세**야. 반대로 쓰면 명백한 오류다.\n' +
    'rankings에는 위 뉴스 ' + news.length + '건 **전부**에 대해 번호(id)와 중요도(1~5)를 매겨줘.\n' +
    '중요도는 "이 뉴스가 한국 투자자의 판단을 실제로 바꿀 만한가"를 기준으로 봐. ' +
    '금리·환율·물가처럼 시장 전반에 영향을 주는 뉴스가 높고, 개별 홍보성·단신 기사는 낮아.';

  // muteHttpExceptions는 HTTP 오류만 막아준다. 연결 자체가 실패하면 예외가 그대로
  // 튀어나와 호출한 쪽(트리거)까지 죽으므로 여기서 잡는다.
  let res;
  try {
    res = UrlFetchApp.fetch(ANTHROPIC_URL_, {
      method: 'post',
      contentType: 'application/json',
      muteHttpExceptions: true,
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      payload: JSON.stringify({
        // 개인용 대시보드라 비용을 우선했다. 헤드라인 요약·채점은 난이도가 높지 않아
        // Haiku로도 충분하다. 더 나은 판단이 필요하면 claude-sonnet-5 / claude-opus-4-8로
        // 올리면 되는데, 그때는 아래 주석대로 파라미터도 같이 바꿔야 한다.
        model: 'claude-haiku-4-5',
        max_tokens: 4000,
        // ⚠️ Haiku 4.5는 구형이라 최신 모델용 파라미터가 통하지 않는다:
        //   - output_config.effort → 에러. (4.6 이상 + Opus 4.5에서만 지원)
        //   - thinking: {type:'adaptive'} → 4.6 이상 전용. Haiku는 {type:'enabled', budget_tokens}만 됨.
        // 여기서는 사고를 아예 끈다 — 스키마의 reason 필드가 항목별로 근거를 쓰게 만들어서
        // 사실상 같은 역할을 하고, 출력 토큰도 아낀다.
        // 상위 모델로 올릴 때는 thinking: {type:'adaptive'} + output_config.effort를 켤 것.
        output_config: {
          format: { type: 'json_schema', schema: BRIEFING_SCHEMA_ }
        },
        system: '너는 한국 개인 투자자를 위한 경제 브리핑 도우미야. 과장 없이 담백하게 쓴다.',
        messages: [{ role: 'user', content: prompt }]
      })
    });
  } catch (err) {
    console.log('callClaudeBriefing_: 연결 실패 - ' + err);
    return null;
  }

  const code = res.getResponseCode();
  const body = res.getContentText();
  if (code >= 400) {
    console.log('callClaudeBriefing_: HTTP ' + code + ' - ' + body.slice(0, 400));
    return null;
  }

  const json = JSON.parse(body);
  if (json.stop_reason === 'refusal') {
    console.log('callClaudeBriefing_: 모델이 응답을 거부함');
    return null;
  }
  if (json.stop_reason === 'max_tokens') {
    console.log('callClaudeBriefing_: max_tokens에 걸려 응답이 잘림 - 저장하지 않음');
    return null;
  }

  // 적응형 사고를 켜두면 thinking 블록이 앞에 오므로 content[0]을 그냥 쓰면 안 된다.
  // 구조화된 출력을 켰으니 text 블록의 내용은 스키마에 맞는 JSON이 보장된다.
  const textBlock = (json.content || []).filter(function (b) { return b.type === 'text'; })[0];
  if (!textBlock) {
    console.log('callClaudeBriefing_: 응답에 text 블록이 없음');
    return null;
  }
  try {
    return JSON.parse(textBlock.text);
  } catch (err) {
    console.log('callClaudeBriefing_: JSON 파싱 실패 - ' + err);
    return null;
  }
}

