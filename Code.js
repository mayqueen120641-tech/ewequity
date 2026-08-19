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
          (e.parameter && e.parameter.symbols) || '',
          (e.parameter && e.parameter.history) || ''
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
      case 'finance':
        result = getFinance((e.parameter && e.parameter.symbol) || '', noCache);
        break;
      case 'finrank':
        result = getFinRank((e.parameter && e.parameter.sort) || 'per');
        break;
      case 'finai':
        result = getFinAi((e.parameter && e.parameter.symbol) || '', noCache);
        break;
      case 'flow':
        result = getFlow((e.parameter && e.parameter.symbol) || '', noCache);
        break;
      case 'earnings':
        result = getEarnings(noCache);
        break;
      case 'chart':
        result = getChart(
          (e.parameter && e.parameter.symbol) || '',
          (e.parameter && e.parameter.range) || '3M',
          noCache
        );
        break;
      case 'explainday':
        result = getExplainOn(
          (e.parameter && e.parameter.symbol) || '',
          (e.parameter && e.parameter.name) || '',
          (e.parameter && e.parameter.date) || '',
          noCache
        );
        break;
      case 'chartai':
        result = getChartAi(
          (e.parameter && e.parameter.symbol) || '',
          (e.parameter && e.parameter.range) || '3M',
          noCache
        );
        break;
      case 'earndetail':
        result = getEarningsDetail(
          (e.parameter && e.parameter.market) || 'us',
          (e.parameter && e.parameter.key) || '',
          (e.parameter && e.parameter.date) || '',
          noCache
        );
        break;
      default:
        result = { error: 'unknown action: ' + action };
    }
  } catch (err) {
    // 예외 메시지에 실패한 요청 URL이 통째로 들어오는 경우가 있다. 그 URL에는 API 키가
    // 쿼리 파라미터로 붙어 있어서, 그대로 내보내면 **누구나 공개 주소로 키를 가져갈 수 있다.**
    // (실제로 DART 호출이 실패했을 때 crtfc_key가 응답에 그대로 실려 나갔다)
    console.log('doGet(' + action + ') 예외: ' + err);
    result = { error: scrubSecrets_(String(err)) };
  }
  return ContentService
    .createTextOutput(JSON.stringify(scrubValue_(result)))
    .setMimeType(ContentService.MimeType.JSON);
}

// 응답에 섞여 나갈 수 있는 비밀값을 가린다. 키 이름이 아니라 **저장된 값 자체**를 찾아
// 지우기 때문에, 어떤 경로로 새어 나오든(URL 파라미터든 헤더든) 막힌다.
var SECRET_PROPS_ = [
  'DART_API_KEY', 'ANTHROPIC_API_KEY', 'FINNHUB_API_KEY', 'FRED_API_KEY',
  'ECOS_API_KEY', 'NAVER_CLIENT_ID', 'NAVER_CLIENT_SECRET'
];

// 응답 전체를 훑기 때문에 속성을 문자열마다 읽으면 느리다. 요청당 한 번만 읽는다.
var secretCache_ = null;

function secretValues_() {
  if (secretCache_) return secretCache_;
  const props = PropertiesService.getScriptProperties();
  secretCache_ = SECRET_PROPS_
    .map(function (name) { return props.getProperty(name); })
    // 너무 짧은 값을 지우면 멀쩡한 문장이 깨진다.
    .filter(function (v) { return v && v.length >= 8; });
  return secretCache_;
}

function scrubSecrets_(s) {
  var out = String(s);
  secretValues_().forEach(function (v) {
    if (out.indexOf(v) !== -1) out = out.split(v).join('***');
  });
  // 값을 못 읽었더라도 잘 알려진 키 파라미터는 이름 기준으로 한 번 더 막는다.
  return out.replace(/([?&](?:crtfc_key|api_key|apikey|token|key|serviceKey)=)[^&\s'"]+/gi, '$1***');
}

function scrubValue_(v) {
  if (typeof v === 'string') return scrubSecrets_(v);
  if (Array.isArray(v)) return v.map(scrubValue_);
  if (v && typeof v === 'object') {
    const out = {};
    Object.keys(v).forEach(function (k) { out[k] = scrubValue_(v[k]); });
    return out;
  }
  return v;
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
  ].concat(bondJobs_(fredKey));

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

  // 국고채는 ECOS 트리거가 받아둔 값을 쓴다(요청 경로에서 ECOS를 부르면 안 된다).
  const krb = ecos.krBonds || {};
  const bonds = {
    kr3y: krb.kr3y || null,
    kr10y: krb.kr10y || null,
    us3y: results.us3y || null,
    us10y: results.us10y || null,
    jp10y: results.jp10y || null
  };
  // 장단기 금리차 — 화면에서 다시 계산하지 않도록 여기서 한 번만 만든다.
  bonds.krSpread = yieldSpread_(bonds.kr3y, bonds.kr10y);
  bonds.usSpread = yieldSpread_(bonds.us3y, bonds.us10y);

  return {
    base_rate_kr: baseRateKr,
    base_rate_us: results.base_rate_us,
    usdkrw: usdkrw,
    wti: results.wti,
    kospi: results.kospi,
    nasdaq: results.nasdaq,
    gold: results.gold,
    btc: results.btc,
    bonds: bonds
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
  // DART 재무는 분기에 한 번만 바뀌므로 하루 1회면 충분하고, 고유번호 매핑은 상장사가
  // 새로 생길 때만 바뀌니 주 1회면 된다(20MB짜리 ZIP이라 자주 받을 것도 아니다).
  const jobs = [
    { name: 'refreshEcosCache', fn: refreshEcosCache, minutes: 30 },
    { name: 'refreshAiBriefing', fn: refreshAiBriefing, hours: 3 },
    { name: 'refreshDartCorpMap', fn: refreshDartCorpMap, weeks: 1 },
    { name: 'refreshDartSnapshot', fn: refreshDartSnapshot, days: 1 }
  ];
  const names = jobs.map(function (j) { return j.name; });

  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (names.indexOf(t.getHandlerFunction()) !== -1) ScriptApp.deleteTrigger(t);
  });
  jobs.forEach(function (j) {
    const clock = ScriptApp.newTrigger(j.name).timeBased();
    // everyMinutes는 1/5/10/15/30만 받는다. 그보다 긴 주기는 everyHours를 써야 한다.
    // everyWeeks는 요일을 같이 지정하지 않으면 생성이 실패한다.
    if (j.weeks) clock.everyWeeks(j.weeks).onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(4);
    else if (j.days) clock.everyDays(j.days).atHour(6);
    else if (j.hours) clock.everyHours(j.hours);
    else clock.everyMinutes(j.minutes);
    clock.create();
  });
  Logger.log('✅ 트리거 등록 완료: ' + jobs.map(function (j) {
    return j.name + '(' + (j.weeks ? j.weeks + '주' : j.days ? j.days + '일'
      : j.hours ? j.hours + '시간' : j.minutes + '분') + ')';
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
    'NAVER_CLIENT_SECRET', 'ANTHROPIC_API_KEY', 'DART_API_KEY', 'BASE_RATE_KR_MANUAL'
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
  const corpN = Number(props.getProperty(DART_CORPMAP_ + '_N') || 0);
  const corpAt = props.getProperty('DART_CORPMAP_AT');
  lines.push('  ' + (corpN ? '✅' : '❌') + ' DART 고유번호 매핑' +
    (corpN ? ' (조각 ' + corpN + '개, ' + corpAt + ')' : ' 없음 — refreshDartCorpMap() 실행'));
  const snap = readDartSnapshot_();
  lines.push('  ' + (snap ? '✅' : '❌') + ' DART 재무 스냅샷' +
    (snap ? ' (' + snap.year + '년, ' + Object.keys(snap.byCode).length + '종목, ' +
      props.getProperty('DART_FIN_AT') + ')' : ' 없음 — refreshDartSnapshot() 실행'));

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
    { name: 'usdkrw', url: ecosUrl_(key, '731Y001', startShort, today, '0000001'), headers: BROWSER_LIKE_HEADERS_, parse: parseEcosUsdKrw_ },
    // 국고채는 항목 코드를 지정하지 않고 통째로 받아 **이름으로 골라낸다**(코드 변경에 안전).
    { name: 'krBonds', url: ecosAllItemsUrl_(key, ECOS_RATE_STAT_, startShort, today), headers: BROWSER_LIKE_HEADERS_, parse: parseEcosBonds_ }
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

// ---- 종목별 기간 수익률 ----
// "삼성전자 한 달 전보다?" 같은 질문에 답하려면 과거 주가가 필요하다.
// 3개월치를 한 번 받아서 1주/1개월/3개월 전 대비를 모두 계산한다(종목당 호출 1회).
// 과거 주가는 자주 안 바뀌므로 1시간 캐시로 묶어 매 질문마다 다시 받지 않게 한다.
var PERF_MAX_ = 25;

function getPerf(symbolsCsv, noCache) {
  const symbols = String(symbolsCsv || '')
    .split(',').map(function (s) { return s.trim(); })
    .filter(function (s) { return s && s.length <= 40; })
    .slice(0, PERF_MAX_);
  if (!symbols.length) return { perf: [] };

  const cacheKey = 'perf_' + md5_(symbols.join(',').toLowerCase());
  const cached = noCache ? null : cacheGet_(cacheKey);
  if (cached) return cached;

  const jobs = symbols.map(function (s) {
    return {
      name: s,
      url: 'https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(s) +
        '?interval=1d&range=3mo'
    };
  });
  const responses = fetchJobsSafe_(jobs);

  const perf = jobs.map(function (j, i) {
    try {
      const res = responses[i];
      if (!res || res.getResponseCode() >= 400) throw new Error('조회 실패');
      const points = parseYahooPoints_(JSON.parse(res.getContentText()));
      if (points.length < 2) throw new Error('데이터 부족');
      const last = points[points.length - 1];
      return {
        symbol: j.name,
        price: last.close,
        w1: pctChangeSince_(points, 7),
        m1: pctChangeSince_(points, 30),
        m3: pctChangeSince_(points, 90)
      };
    } catch (err) {
      return { symbol: j.name, error: String(err) };
    }
  });

  const data = { perf: perf };
  cachePut_(cacheKey, data, 3600); // 1시간
  return data;
}

// 며칠 전 종가 대비 등락률. 휴장일이 있으므로 인덱스가 아니라 날짜로 찾는다.
function pctChangeSince_(points, daysAgo) {
  const last = points[points.length - 1];
  const target = new Date(new Date(last.date).getTime() - daysAgo * 24 * 60 * 60 * 1000);
  const targetStr = Utilities.formatDate(target, 'Asia/Seoul', 'yyyy-MM-dd');

  // 목표 날짜 이하 중 가장 최근 종가를 쓴다(그날이 휴장이면 직전 거래일).
  let base = null;
  for (var i = points.length - 1; i >= 0; i--) {
    if (points[i].date <= targetStr) { base = points[i]; break; }
  }
  if (!base) base = points[0]; // 조회 기간보다 과거면 가장 오래된 값으로
  if (!base.close) return null;
  return Math.round(((last.close - base.close) / base.close) * 10000) / 100;
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
  const points = parseYahooPoints_(fetchJson_(url));
  if (!points.length) throw new Error('Yahoo Finance 히스토리 응답 없음: ' + symbol);
  return points;
}

// 차트용 히스토리와 기간 수익률(getPerf)이 같은 응답 형태를 쓰므로 파싱을 공통으로 뺐다.
function parseYahooPoints_(json) {
  const result = json.chart && json.chart.result && json.chart.result[0];
  if (!result) return [];
  const timestamps = result.timestamp || [];
  const q = result.indicators.quote[0] || {};
  const closes = q.close || [];
  // 야후는 시가·고가·저가·거래량까지 같이 준다. 오랫동안 종가만 쓰고 나머지를 버렸는데,
  // 캔들차트와 "거래량이 평소의 몇 배인지" 같은 설명이 전부 이 값들에서 나온다.
  const points = [];
  for (let i = 0; i < timestamps.length; i++) {
    if (closes[i] != null) {
      points.push({
        date: Utilities.formatDate(new Date(timestamps[i] * 1000), 'Asia/Seoul', 'yyyy-MM-dd'),
        close: closes[i],
        open: q.open ? q.open[i] : null,
        high: q.high ? q.high[i] : null,
        low: q.low ? q.low[i] : null,
        volume: q.volume ? q.volume[i] : null
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
    const weeks = dateChunks_(from, to, 7);
    jobs.push({
      name: 'earnings',
      url: finnhubEarningsUrl_(finnhubKey, weeks[0].from, weeks[0].to),
      parse: function (text) {
        return parseMajorEarnings_(collectFinnhubEarnings_(finnhubKey, weeks, JSON.parse(text)));
      }
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

// Finnhub 실적 캘린더는 한 응답에 1500건까지만 준다. FRED와 달리 offset 같은 페이지 파라미터가
// 없고, 넘치면 **날짜가 이른 쪽부터** 잘라낸다. 두 달을 통째로 요청했더니 1500건이 뒷달로 다
// 채워져서 7월 실적이 하나도 안 들어왔다(아마존 7/31이 캘린더에서 사라진 원인).
// 그래서 기간을 주 단위로 쪼개 받고, 그래도 한도가 꽉 찬 주는 실적 시즌이라 하루 단위로 다시 받는다.
var FINNHUB_MAX_ROWS_ = 1500;

function finnhubEarningsUrl_(apiKey, from, to) {
  return 'https://finnhub.io/api/v1/calendar/earnings?from=' + from + '&to=' + to +
    '&token=' + apiKey;
}

// [from, to]를 days일짜리 구간으로 나눈다. 마지막 구간은 to에서 잘린다.
function dateChunks_(from, to, days) {
  const out = [];
  const end = new Date(from.slice(0, 4), Number(from.slice(5, 7)) - 1, Number(from.slice(8, 10)));
  const stopAt = new Date(to.slice(0, 4), Number(to.slice(5, 7)) - 1, Number(to.slice(8, 10)));
  const cur = end;
  while (cur <= stopAt && out.length < 20) {
    const last = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() + days - 1);
    out.push({ from: ymd_(cur), to: ymd_(last > stopAt ? stopAt : last) });
    cur.setDate(cur.getDate() + days);
  }
  return out;
}

function ymd_(d) {
  return Utilities.formatDate(d, 'Asia/Seoul', 'yyyy-MM-dd');
}

function collectFinnhubEarnings_(apiKey, chunks, firstChunkJson) {
  var rows = (firstChunkJson.earningsCalendar || []).slice();
  const overflow = rows.length >= FINNHUB_MAX_ROWS_ ? [chunks[0]] : [];

  const rest = chunks.slice(1);
  if (rest.length) {
    const got = fetchEarningsChunks_(apiKey, rest);
    rows = rows.concat(got.rows);
    overflow.push.apply(overflow, got.overflow);
  }
  if (overflow.length) {
    var days = [];
    overflow.forEach(function (c) { days = days.concat(dateChunks_(c.from, c.to, 1)); });
    // 잘린 구간의 결과와 겹치지만, 어차피 아래에서 심볼+날짜로 중복을 걸러낸다.
    rows = rows.concat(fetchEarningsChunks_(apiKey, days).rows);
  }
  return rows;
}

function fetchEarningsChunks_(apiKey, chunks) {
  const jobs = chunks.map(function (c) {
    return { url: finnhubEarningsUrl_(apiKey, c.from, c.to) };
  });
  var rows = [];
  const overflow = [];
  fetchJobsSafe_(jobs).forEach(function (res, i) {
    try {
      if (!res || res.getResponseCode() >= 400) return;
      const got = JSON.parse(res.getContentText()).earningsCalendar || [];
      rows = rows.concat(got);
      if (got.length >= FINNHUB_MAX_ROWS_) overflow.push(chunks[i]);
    } catch (err) {
      // 이 구간만 건너뛴다 — 한 주가 빠져도 나머지 일정은 그대로 보여준다.
    }
  });
  return { rows: rows, overflow: overflow };
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

    // KIND는 회사 링크에 5자리 내부 ID를 쓰는데, 이게 **종목코드의 앞 5자리**다
    // (018260 → '01826'). 실측 16종목 전부 일치했다. 다만 문서화된 규칙이 아니라
    // 추론이므로, 뒤에 0을 붙여 만든 코드가 실제 상장사 코드인지 한 번 더 확인한다.
    const idm = tr[1].match(/companysummary_open\('(\d{5})'\)/);
    const code = idm ? idm[1] + '0' : null;

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
    const item = { date: date, corp: corp, desc: desc, code: code,
      time: /^\d{2}:\d{2}$/.test(time) ? time : '' };
    seen[key] = { item: item, korean: isKorean };
    out.push(item);
  }
  return out
    .sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; })
    .slice(0, 250);
}

// ⚠️ 인자는 응답 객체가 아니라 **행 배열**이다(collectFinnhubEarnings_가 여러 구간을 이어붙임).
function parseMajorEarnings_(rows) {
  const wanted = {};
  MAJOR_EARNINGS_SYMBOLS_.forEach(function (s) { wanted[s] = true; });
  const seen = {};
  return (rows || [])
    .filter(function (e) {
      const sym = String(e.symbol || '').toUpperCase();
      if (!wanted[sym]) return false;
      // 구간이 겹치게 다시 받은 날이 있어 같은 발표가 두 번 들어올 수 있다.
      const key = sym + '|' + e.date;
      if (seen[key]) return false;
      seen[key] = true;
      return true;
    })
    // 예상치·실제치를 같이 들고 온다. 주가는 "실적이 좋았나"가 아니라 "예상보다 좋았나"로
    // 움직이기 때문에, 이 두 값이 있어야 발표 결과를 제대로 보여줄 수 있다.
    .map(function (e) {
      return {
        date: e.date, symbol: e.symbol, hour: e.hour || '',
        quarter: e.quarter || null, year: e.year || null,
        epsEst: e.epsEstimate === undefined ? null : e.epsEstimate,
        epsAct: e.epsActual === undefined ? null : e.epsActual,
        revEst: e.revenueEstimate === undefined ? null : e.revenueEstimate,
        revAct: e.revenueActual === undefined ? null : e.revenueActual
      };
    })
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
    },
    // explanation 안에 녹여달라고만 하면 모델이 뉴스 설명에 밀려 수급을 통째로 빠뜨린다.
    // 별도 필드로 빼야 반드시 나온다.
    flowNote: {
      type: 'string',
      description: '투자자별 수급이 주어졌으면 오늘 누가 사고 팔았는지 한국어 1~2문장. ' +
        '주어진 수치만 쓸 것. 수급 정보가 없으면 빈 문자열.'
    }
  },
  required: ['explanation', 'evidence', 'confidence', 'flowNote'],
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

  // 수급은 뉴스에 재료가 없는 날에도 "누가 사고 팔았나"를 말해준다. 국내 종목만 나온다.
  const flow = safe_(function () { return getFlow(sym, noCache); });

  // 개별 종목 뉴스만 보면 "원인을 못 찾겠다"로 끝나는 경우가 많다. 실제로는 시장 전체가
  // 빠져서 같이 밀린 날이 흔하기 때문 — 그 판단을 할 수 있게 시장 상황을 같이 넘긴다.
  const result = callClaudeExplain_(key, nm, quote, news, marketContext_(), flow);
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

  // 기간 수익률도 같이 준다 — "오늘 왜 움직였나"를 볼 때 최근 흐름이 함께 보이면
  // 오늘 하루 등락이 추세 속에서 어떤 의미인지 판단하기 쉽다.
  const pf = safe_(function () { return getPerf(sym, false); });
  const perf = ((pf && pf.perf) || []).filter(function (p) { return !p.error; })[0] || null;

  // 오늘 왜 움직였는지를 볼 때 "그래서 이 회사가 지금 어떤 상태인지"가 같이 보이면
  // 하루 등락을 회사 실적과 이어서 볼 수 있다. 스냅샷에 이미 있는 값이라 추가 호출이 없다.
  // (상위 100종목 밖이거나 해외 종목이면 그냥 빠진다)
  const kc = krCode_(sym);
  const snapshot = kc ? readDartSnapshot_() : null;
  const val = snapshot ? snapshot.byCode[kc] : null;

  const data = {
    symbol: sym, name: nm, quote: quote, perf: perf,
    flow: (flow && !flow.error && flow.days && flow.days.length) ? flow : null,
    valuation: val || null,
    valuationYear: val ? snapshot.year : null,
    explanation: result.explanation,
    confidence: result.confidence,
    flowNote: result.flowNote || null,
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

function callClaudeExplain_(apiKey, name, quote, news, market, flow) {
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

  const flowText = flowContext_(flow);

  const prompt =
    moved + '\n\n' +
    (ctx.length ? '[시장 상황]\n' + ctx.join('\n') + '\n\n' : '') +
    (flowText ? '[투자자별 수급]\n' + flowText + '\n\n' : '') +
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
    (flowText
      ? 'flowNote에는 오늘 누가 사고 팔았는지 써줘 ' +
        '("외국인이 836만주를 순매수한 반면 개인은 1,168만주를 순매도했습니다" 같은 식). ' +
        '오늘과 누적 방향이 다르면 그 점도 짚어줘.\n' +
        '⚠️ 수급은 결과지 원인이 아니다. "외국인이 샀으니 오른다"처럼 인과를 뒤집지 마. ' +
        '개인이 팔고 외국인이 샀다는 사실을 **어느 쪽이 옳다는 식으로 쓰지 마** — ' +
        '초보자가 "외국인 따라 사면 된다"로 읽으면 안 된다.\n'
      : 'flowNote는 빈 문자열로 둬.\n') +
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

function getAsk(question, symbolsCsv, historyJson) {
  const q = String(question || '').trim();
  if (!q) return { error: '질문을 입력해주세요.' };
  if (q.length > ASK_MAX_LEN_) return { error: '질문이 너무 길어요. ' + ASK_MAX_LEN_ + '자 이내로 줄여주세요.' };

  const props = PropertiesService.getScriptProperties();
  const key = props.getProperty('ANTHROPIC_API_KEY');
  if (!key) return { error: 'AI 답변 기능은 ANTHROPIC_API_KEY가 설정돼야 동작합니다.' };

  // 이어서 묻기: 직전 대화를 같이 넘겨야 "그럼 왜?" 같은 질문을 알아듣는다.
  // URL 길이 제한이 있어 최근 4개만, 각각 잘라서 받는다.
  const history = parseAskHistory_(historyJson);

  // 같은 대화 흐름에서 같은 질문을 반복하면 캐시로 돌려준다.
  const cacheKey = 'ask_' + md5_(q.toLowerCase() + '|' + String(symbolsCsv || '') + '|' +
    history.map(function (h) { return h.role + ':' + h.text; }).join('|'));
  const cached = cacheGet_(cacheKey);
  if (cached) return cached;

  if (!bumpAskCount_(props)) {
    return { error: '오늘 질문 가능 횟수를 모두 사용했어요. 내일 다시 시도해주세요.' };
  }

  const news = collectAllNews_();
  const result = callClaudeAsk_(key, q, buildAskContext_(news, symbolsCsv), history);
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

// 클라이언트가 보낸 대화 기록을 정리한다. 형식이 깨졌으면 그냥 무시하고 새 대화로 취급.
function parseAskHistory_(raw) {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr
      .filter(function (m) { return m && (m.role === 'user' || m.role === 'assistant') && m.text; })
      .slice(-4)
      .map(function (m) { return { role: m.role, text: String(m.text).slice(0, 400) }; });
  } catch (err) {
    return [];
  }
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

  // "한 달 전보다?" 같은 질문에 답하려면 과거 주가가 필요하다.
  // 관심종목 + 시총 상위 종목을 합쳐서 계산한다 — 담아두지 않은 대형주를 물어도 답하도록.
  const mkForPerf = safe_(function () { return getMarket(false); });
  const topSyms = (((mkForPerf && mkForPerf.items) || []).slice(0, 10))
    .map(function (x) { return x.code + '.KS'; });
  const perfSyms = syms.concat(topSyms).filter(function (s, i, a) { return a.indexOf(s) === i; });
  if (perfSyms.length) {
    const pf = safe_(function () { return getPerf(perfSyms.join(','), false); });
    const nameOf = {};
    (((mkForPerf && mkForPerf.items) || [])).forEach(function (x) { nameOf[x.code + '.KS'] = x.name; });
    const lines = ((pf && pf.perf) || [])
      .filter(function (p) { return !p.error; })
      .map(function (p) {
        const nm = nameOf[p.symbol] ? nameOf[p.symbol] + '(' + p.symbol + ')' : p.symbol;
        const fmt = function (v) { return v == null ? '?' : (v > 0 ? '+' : '') + v + '%'; };
        return '- ' + nm + ': 현재 ' + p.price +
          ' / 1주 전 대비 ' + fmt(p.w1) + ', 1개월 전 대비 ' + fmt(p.m1) + ', 3개월 전 대비 ' + fmt(p.m3);
      });
    if (lines.length) ctx.push('[종목별 기간 수익률]\n' + lines.join('\n'));
  }

  // 급등락 질문에 답하려면 순위표가 필요하다.
  const mk = mkForPerf;
  const items = (mk && mk.items) || [];
  if (items.length) {
    const fmt = function (x) { return x.name + ' ' + x.changePct.toFixed(2) + '%'; };
    const byUp = items.slice().sort(function (a, b) { return b.changePct - a.changePct; });
    ctx.push('[코스피 상위 100종목 중]\n' +
      '- 시가총액 상위: ' + items.slice(0, 8).map(fmt).join(', ') + '\n' +
      '- 오늘 많이 오른 종목: ' + byUp.slice(0, 6).map(fmt).join(', ') + '\n' +
      '- 오늘 많이 내린 종목: ' + byUp.slice(-6).reverse().map(fmt).join(', '));
  }

  // "삼성전자 PER 얼마야?", "관심종목 중 ROE 제일 높은 거?" 같은 질문용.
  // 스냅샷은 트리거가 채워둔 값이라 추가 호출이 없다. 관심종목 + 시총 상위를 함께 넣는다.
  const snap = readDartSnapshot_();
  if (snap && items.length) {
    const wantCodes = {};
    syms.forEach(function (s) { const c = krCode_(s); if (c) wantCodes[c] = true; });
    const finLines = items
      .filter(function (x, i) { return i < 12 || wantCodes[x.code]; })
      .map(function (x) {
        const v = snap.byCode[x.code];
        if (!v) return null;
        const parts = [];
        if (v.per !== null) parts.push('PER ' + v.per + '배');
        else parts.push('PER 없음(적자)');
        if (v.pbr !== null) parts.push('PBR ' + v.pbr + '배');
        if (v.roe !== null) parts.push('ROE ' + v.roe + '%');
        if (v.opMargin !== null) parts.push('영업이익률 ' + v.opMargin + '%');
        if (v.debtRatio !== null) parts.push('부채비율 ' + v.debtRatio + '%');
        return '- ' + x.name + ': ' + parts.join(', ');
      })
      .filter(function (s) { return s; });
    if (finLines.length) {
      ctx.push('[재무지표 — ' + snap.year + '년 사업보고서(DART) 기준, 시가총액은 현재가]\n' +
        finLines.join('\n') +
        '\n※ PER·PBR은 회사가 실제로 싼지 비싼지를 확정해주지 않는다. PER이 낮은 데는 ' +
        '앞으로 실적이 나빠질 것이란 전망이 깔린 경우가 많으니 단정하지 말 것.');
    }
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

function callClaudeAsk_(apiKey, question, context, history) {
  // 대시보드 데이터는 대화 내내 그대로이므로 system에 둔다. messages에 넣으면 매 턴
  // 통째로 반복돼 토큰이 낭비되고, 대화가 길어질수록 심해진다.
  const system =
    '너는 초보 투자자에게 오늘의 시장을 설명해주는 도우미야. ' +
    '아래 데이터를 끝까지 살펴본 뒤 구체적인 숫자로 답하고, 투자 권유는 하지 않는다.\n\n' +
    context + '\n\n' +
    '[답변 규칙]\n' +
    '- 위 데이터에 있는 값은 **구체적인 숫자와 종목명으로** 답해. ' +
    '"~일 가능성이 높습니다" 같은 추측 대신 실제 수치를 써.\n' +
    '- 초보 투자자가 물어본다고 생각하고 쉬운 말로 3~5문장. 어려운 용어는 괄호로 짧게 풀어줘.\n' +
    '- 앞선 대화가 있으면 그 맥락을 이어서 답해. "그럼 왜?"처럼 짧게 물어도 ' +
    '무엇에 대한 질문인지 앞 대화에서 찾아낼 것.\n' +
    '- 정말 데이터에 없는 것(재무제표, PER, 개별 종목 과거 주가)을 물으면 없다고 솔직히 말하고, ' +
    '대신 지금 데이터로 답할 수 있는 걸 한 가지 제안해.\n' +
    '- relatedNews에는 [오늘 뉴스] 목록의 번호만 쓴다. 근거로 쓴 뉴스가 없으면 빈 배열.\n' +
    '- ⚠️ "사도 돼?", "팔까?" 같은 질문이어도 **매수/매도를 추천하지 마.** ' +
    '지금 상황과 판단할 때 볼 것들을 설명하고, 결정은 본인 몫이라는 점을 자연스럽게 전해. ' +
    '그런 질문이면 isAdvice를 true로 해.\n' +
    '- 목표가나 수익률 예측도 하지 마.';

  const messages = (history || []).map(function (h) {
    return { role: h.role, content: h.text };
  });
  messages.push({ role: 'user', content: question });

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
        system: system,
        messages: messages
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


// ================= 9. DART 재무지표 (PER / PBR / ROE) =================
// DART는 PER·PBR을 직접 주지 않는다. 재무제표 원본만 주므로, 이미 네이버에서 긁어오는
// 시가총액과 나눠서 계산한다. 주식수를 따로 구할 필요가 없어 자기주식·우선주 계산이 빠진다.
//   PER = 시가총액 / 당기순이익,  PBR = 시가총액 / 자본총계,  ROE = 당기순이익 / 자본총계
var DART_BASE_ = 'https://opendart.fss.or.kr/api/';
var DART_CORPMAP_ = 'DART_CORPMAP';   // 종목코드 → DART 고유번호(8자리)
var DART_SNAPSHOT_ = 'DART_FIN_V1';   // 상위 100종목 지표 스냅샷
var DART_FETCH_BATCH_ = 20;           // 한 번에 병렬로 때릴 종목 수

// 스크립트 속성은 값 하나에 9KB 제한이 있다. 종목코드 매핑(약 60KB)이나 스냅샷처럼
// 그보다 큰 값은 잘라서 저장하고, 조각 수를 따로 적어둔다.
var PROP_CHUNK_ = 8000;

function savePropChunks_(prefix, str) {
  const props = PropertiesService.getScriptProperties();
  const n = Math.ceil(str.length / PROP_CHUNK_);
  const out = {};
  for (var i = 0; i < n; i++) out[prefix + '_' + i] = str.substr(i * PROP_CHUNK_, PROP_CHUNK_);
  out[prefix + '_N'] = String(n);
  props.setProperties(out, false);
  // 이전에 더 많은 조각이 있었다면 남은 꼬리를 지운다(안 지우면 다음 읽기에서 섞인다).
  for (var k = n; k < n + 20; k++) props.deleteProperty(prefix + '_' + k);
  return n;
}

function readPropChunks_(prefix) {
  const props = PropertiesService.getScriptProperties();
  const n = Number(props.getProperty(prefix + '_N') || 0);
  if (!n) return '';
  var s = '';
  for (var i = 0; i < n; i++) s += (props.getProperty(prefix + '_' + i) || '');
  return s;
}

// ---- 종목코드 ↔ DART 고유번호 매핑 ----
// DART는 종목코드가 아니라 자체 8자리 고유번호를 쓴다. 매핑 파일은 ZIP으로 내려오고
// 압축을 풀면 20MB가 넘어(전체 법인 약 11만 건) 캐시에 못 넣는다. 상장사(종목코드가
// 있는 것)만 3,900여 건 추려서 속성에 나눠 저장하고, 주 1회 트리거로만 갱신한다.
function refreshDartCorpMap() {
  const key = getProp_('DART_API_KEY');
  if (!key) { Logger.log('⚠️ DART_API_KEY 없음 — 건너뜀'); return; }

  const res = UrlFetchApp.fetch(DART_BASE_ + 'corpCode.xml?crtfc_key=' + key,
    { muteHttpExceptions: true });
  if (res.getResponseCode() >= 400) throw new Error('corpCode HTTP ' + res.getResponseCode());

  const blob = res.getBlob().setContentType('application/zip');
  const xml = Utilities.unzip(blob)[0].getDataAsString('UTF-8');
  const map = parseCorpCodeXml_(xml);

  const codes = Object.keys(map);
  if (codes.length < 1000) throw new Error('상장사가 너무 적게 파싱됨: ' + codes.length);

  const packed = codes.map(function (c) { return c + ':' + map[c]; }).join(',');
  const chunks = savePropChunks_(DART_CORPMAP_, packed);
  PropertiesService.getScriptProperties()
    .setProperty('DART_CORPMAP_AT', new Date().toISOString());
  Logger.log('✅ DART 고유번호 매핑 ' + codes.length + '건 저장(조각 ' + chunks + '개)');
}

// XML을 XmlService로 파싱하면 11만 건짜리 20MB 문서라 시간이 오래 걸린다. 상장사만
// 필요하므로 정규식으로 훑되, ⚠️ **반드시 <list> 블록 단위로 끊어서** 봐야 한다.
// corp_code와 stock_code를 한 정규식으로 이어 잡으면 비상장사(stock_code가 공백)를
// 만났을 때 그 회사의 corp_code에 **다음 회사의 stock_code**가 붙는다.
// 실제로 SK하이닉스에 바로 앞 비상장사의 고유번호가 매칭됐다 — 엉뚱한 회사의
// 재무제표가 표시되는 버그라 화면만 봐서는 못 잡는다.
// <list> 블록을 전부 훑으면 11만 번을 도는데 20MB 문서라 요청 시간을 다 잡아먹는다.
// 필요한 건 상장사 3,900여 건뿐이므로 **6자리 종목코드를 앵커로** 잡고, 거기서 뒤로
// 조금만 되짚어 같은 블록의 corp_code를 찾는다(각 <list>는 corp_code로 시작한다).
// 되짚는 창을 짧게 묶어두면 앞 블록으로 넘어갈 일이 없다.
var STOCK_CODE_RE_ = /<stock_code>\s*(\d{6})\s*<\/stock_code>/g;
var CORP_BACK_WINDOW_ = 500;

function parseCorpCodeXml_(xml) {
  const map = {};
  STOCK_CODE_RE_.lastIndex = 0;
  var m;
  while ((m = STOCK_CODE_RE_.exec(xml)) !== null) {
    const start = Math.max(0, m.index - CORP_BACK_WINDOW_);
    const back = xml.slice(start, m.index);
    const at = back.lastIndexOf('<corp_code>');
    if (at === -1) continue;
    const corp = back.slice(at).match(/^<corp_code>\s*(\d{8})\s*<\/corp_code>/);
    if (corp) map[m[1]] = corp[1];
  }
  return map;
}

function readDartCorpMap_() {
  const packed = readPropChunks_(DART_CORPMAP_);
  const map = {};
  if (!packed) return map;
  packed.split(',').forEach(function (pair) {
    const p = pair.split(':');
    if (p.length === 2) map[p[0]] = p[1];
  });
  return map;
}

// ---- 주요계정 파싱 ----
// 계정명은 회사·업종마다 조금씩 다르게 적힌다("당기순이익(손실)", "수익(매출액)" 등).
// 은행·보험은 매출액 대신 영업수익을 쓴다. 그래서 정확히 일치가 아니라 후보 목록으로 찾는다.
var DART_ACCOUNTS_ = {
  revenue: ['매출액', '수익(매출액)', '영업수익'],
  operatingProfit: ['영업이익', '영업이익(손실)'],
  netIncome: ['당기순이익', '당기순이익(손실)', '당기순이익(당기순손실)'],
  assets: ['자산총계'],
  liabilities: ['부채총계'],
  equity: ['자본총계']
};

function dartAmount_(s) {
  if (s === null || s === undefined) return null;
  const t = String(s).replace(/,/g, '').trim();
  if (!t || t === '-') return null;
  const v = Number(t);
  return isNaN(v) ? null : v;
}

// ⚠️ 인자는 응답 객체가 아니라 list 배열이다.
// 연결재무제표(CFS)를 우선하고, 없으면 별도(OFS)를 쓴다. 지주회사는 별도만 보면
// 자회사 실적이 통째로 빠져 순이익이 실제의 몇 분의 일로 나온다.
function parseDartAccounts_(list) {
  const rows = list || [];
  const pick = function (names, fsDiv) {
    for (var i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (fsDiv && r.fs_div !== fsDiv) continue;
      if (names.indexOf(String(r.account_nm || '').trim()) === -1) continue;
      const v = dartAmount_(r.thstrm_amount);
      if (v !== null) return v;
    }
    return null;
  };
  const out = {};
  Object.keys(DART_ACCOUNTS_).forEach(function (k) {
    out[k] = pick(DART_ACCOUNTS_[k], 'CFS');
    if (out[k] === null) out[k] = pick(DART_ACCOUNTS_[k], 'OFS');
    if (out[k] === null) out[k] = pick(DART_ACCOUNTS_[k], null);
  });
  return out;
}

// ---- 지표 계산 ----
// marketCapEok: 네이버에서 긁어온 시가총액(억원). DART 금액은 원 단위라 1억을 곱해 맞춘다.
// 적자면 PER은 의미가 없으므로 null로 둔다(음수 PER을 "싸다"로 오해하기 쉽다).
var EOK_ = 100000000;

function calcValuation_(fin, marketCapEok) {
  const cap = marketCapEok ? marketCapEok * EOK_ : null;
  const div = function (a, b) {
    return (a === null || b === null || !b) ? null : a / b;
  };
  const round = function (v, d) {
    return v === null ? null : Math.round(v * Math.pow(10, d)) / Math.pow(10, d);
  };
  const netIncome = fin.netIncome;
  const equity = fin.equity;
  return {
    per: netIncome !== null && netIncome > 0 ? round(div(cap, netIncome), 2) : null,
    pbr: equity !== null && equity > 0 ? round(div(cap, equity), 2) : null,
    roe: netIncome !== null && equity !== null && equity > 0
      ? round(div(netIncome, equity) * 100, 2) : null,
    opMargin: fin.revenue !== null && fin.revenue > 0
      ? round(div(fin.operatingProfit, fin.revenue) * 100, 2) : null,
    debtRatio: equity !== null && equity > 0
      ? round(div(fin.liabilities, equity) * 100, 1) : null,
    // 적자 여부는 PER이 null인 이유를 화면에서 구분하기 위해 따로 내려준다.
    loss: netIncome !== null && netIncome <= 0
  };
}

// ---- DART 조회 ----
var DART_REPRT_ = { annual: '11011', q1: '11013', half: '11012', q3: '11014' };

// 사업보고서는 결산 후 90일 안에 낸다(12월 결산이면 이듬해 3월 말). 그래서 4월부터는
// 작년 것이 있고, 1~3월엔 아직 없어 재작년을 봐야 한다.
function latestAnnualYear_(now) {
  const d = now || new Date();
  return d.getMonth() + 1 >= 4 ? d.getFullYear() - 1 : d.getFullYear() - 2;
}

function dartAcntUrl_(key, corpCode, year, reprt) {
  return DART_BASE_ + 'fnlttSinglAcnt.json?crtfc_key=' + key +
    '&corp_code=' + corpCode + '&bsns_year=' + year + '&reprt_code=' + reprt;
}

// 종목이 많아 한꺼번에 던지면 DART가 막을 수 있어 20개씩 끊어서 병렬로 받는다.
// status '013'은 "조회된 데이터 없음"이라 오류가 아니다 — 그 해 보고서를 아직 안 낸 것뿐.
function fetchDartFinancials_(pairs, year, reprt) {
  const key = getProp_('DART_API_KEY');
  const out = {};
  if (!key) return out;

  for (var s = 0; s < pairs.length; s += DART_FETCH_BATCH_) {
    const batch = pairs.slice(s, s + DART_FETCH_BATCH_);
    const jobs = batch.map(function (p) {
      return { url: dartAcntUrl_(key, p.corpCode, year, reprt) };
    });
    fetchJobsSafe_(jobs).forEach(function (res, i) {
      try {
        if (!res || res.getResponseCode() >= 400) return;
        const json = JSON.parse(res.getContentText());
        if (json.status !== '000') return;
        out[batch[i].code] = parseDartAccounts_(json.list);
      } catch (err) {
        // 이 종목만 건너뛴다 — 한 종목 때문에 100종목 갱신을 통째로 날릴 이유가 없다.
      }
    });
  }
  return out;
}

// ---- 상위 100종목 스냅샷 (트리거) ----
// 재무는 분기에 한 번만 바뀌므로 요청 경로에서 부를 이유가 없다(ECOS·브리핑과 같은 이유).
// 하루 1회 트리거로 채워두고, 화면은 저장된 값만 읽는다.
function refreshDartSnapshot() {
  if (!getProp_('DART_API_KEY')) { Logger.log('⚠️ DART_API_KEY 없음 — 건너뜀'); return; }
  const map = readDartCorpMap_();
  if (!Object.keys(map).length) {
    Logger.log('⚠️ 고유번호 매핑이 비어 있음 — refreshDartCorpMap 먼저 실행');
    return;
  }

  const mk = getMarket(false);
  const items = (mk && mk.items) || [];
  const pairs = items
    .filter(function (x) { return map[x.code]; })
    .map(function (x) { return { code: x.code, corpCode: map[x.code] }; });

  const year = latestAnnualYear_();
  const fins = fetchDartFinancials_(pairs, year, DART_REPRT_.annual);

  const capByCode = {};
  items.forEach(function (x) { capByCode[x.code] = x.marketCap; });

  const rows = [];
  Object.keys(fins).forEach(function (code) {
    const v = calcValuation_(fins[code], capByCode[code]);
    if (v.per === null && v.pbr === null && v.roe === null) return;
    rows.push([code, v.per, v.pbr, v.roe, v.opMargin, v.debtRatio, v.loss ? 1 : 0]);
  });

  savePropChunks_(DART_SNAPSHOT_, JSON.stringify({ year: year, rows: rows }));
  PropertiesService.getScriptProperties()
    .setProperty('DART_FIN_AT', new Date().toISOString());
  Logger.log('✅ DART 재무 스냅샷 ' + rows.length + '/' + pairs.length + '종목 (' + year + '년 연간)');
}

var DART_FIELDS_ = ['code', 'per', 'pbr', 'roe', 'opMargin', 'debtRatio', 'loss'];

function readDartSnapshot_() {
  try {
    const raw = readPropChunks_(DART_SNAPSHOT_);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const byCode = {};
    (parsed.rows || []).forEach(function (r) {
      const o = {};
      DART_FIELDS_.forEach(function (f, i) { o[f] = r[i]; });
      o.loss = !!o.loss;
      byCode[o.code] = o;
    });
    return { year: parsed.year, byCode: byCode };
  } catch (err) {
    return null;
  }
}

// ---- 실적 추이 ----
// 사업보고서 응답에는 당기(thstrm)·전기(frmtrm)·전전기(bfefrmtrm)가 같이 들어 있다.
// 즉 호출 한 번으로 3개년 추이가 나온다 — 연도별로 따로 부를 필요가 없다.
var DART_TREND_ACCOUNTS_ = [
  ['revenue', DART_ACCOUNTS_.revenue, '매출액'],
  ['operatingProfit', DART_ACCOUNTS_.operatingProfit, '영업이익'],
  ['netIncome', DART_ACCOUNTS_.netIncome, '당기순이익']
];

// "2025.01.01 ~ 2025.12.31" 또는 "제 57 기" 형태에서 연도만 뽑는다.
function dartPeriodYear_(dt, fallbackYear) {
  const m = String(dt || '').match(/(20\d{2})/);
  return m ? Number(m[1]) : fallbackYear;
}

function parseDartTrend_(list, year) {
  const rows = list || [];
  const find = function (names, fsDiv) {
    for (var i = 0; i < rows.length; i++) {
      if (fsDiv && rows[i].fs_div !== fsDiv) continue;
      if (names.indexOf(String(rows[i].account_nm || '').trim()) !== -1) return rows[i];
    }
    return null;
  };
  const byYear = {};
  const add = function (y, field, val) {
    if (y === null || val === null) return;
    if (!byYear[y]) byYear[y] = { year: y };
    byYear[y][field] = val;
  };

  DART_TREND_ACCOUNTS_.forEach(function (spec) {
    const row = find(spec[1], 'CFS') || find(spec[1], 'OFS') || find(spec[1], null);
    if (!row) return;
    add(dartPeriodYear_(row.thstrm_dt, year), spec[0], dartAmount_(row.thstrm_amount));
    add(dartPeriodYear_(row.frmtrm_dt, year - 1), spec[0], dartAmount_(row.frmtrm_amount));
    add(dartPeriodYear_(row.bfefrmtrm_dt, year - 2), spec[0], dartAmount_(row.bfefrmtrm_amount));
  });

  return Object.keys(byYear)
    .map(function (y) { return byYear[y]; })
    .sort(function (a, b) { return a.year - b.year; });
}

// ---- 단일 종목 재무 (요청 시 조회) ----
// 종목코드는 '005930' 또는 '005930.KS' 둘 다 받는다(워치리스트는 .KS를 붙여 저장한다).
function krCode_(symbol) {
  const m = String(symbol || '').match(/(\d{6})/);
  return m ? m[1] : null;
}

function getFinance(symbol, noCache) {
  const code = krCode_(symbol);
  if (!code) return { error: '국내 종목만 재무 지표를 볼 수 있어요. (해외 종목은 DART에 공시되지 않습니다)' };

  const cacheKey = 'fin_' + code;
  const cached = noCache ? null : cacheGet_(cacheKey);
  if (cached) return cached;

  if (!getProp_('DART_API_KEY')) return { error: 'DART_API_KEY가 설정되지 않았어요.' };
  const map = readDartCorpMap_();
  const corpCode = map[code];
  if (!corpCode) return { error: '이 종목의 DART 고유번호를 찾지 못했어요.' };

  const key = getProp_('DART_API_KEY');
  const year = latestAnnualYear_();
  const res = UrlFetchApp.fetch(dartAcntUrl_(key, corpCode, year, DART_REPRT_.annual),
    { muteHttpExceptions: true });
  const json = JSON.parse(res.getContentText());
  if (json.status !== '000') {
    return { error: json.message || (year + '년 사업보고서를 찾지 못했어요.'), code: code };
  }

  const fin = parseDartAccounts_(json.list);
  // 시가총액은 이미 순위표에서 긁어온 값을 그대로 쓴다(추가 호출 없음).
  const mk = safe_(function () { return getMarket(false); });
  const item = (((mk && mk.items) || []).filter(function (x) { return x.code === code; }))[0];

  const data = {
    code: code,
    name: item ? item.name : null,
    year: year,
    marketCap: item ? item.marketCap : null,
    valuation: calcValuation_(fin, item ? item.marketCap : null),
    financials: fin,
    trend: parseDartTrend_(json.list, year)
  };
  cachePut_(cacheKey, data, 43200); // 12시간 — 재무는 분기에 한 번만 바뀐다
  return data;
}

// ---- 재무 스크리너 ----
// 상위 100종목을 PER 낮은 순 / PBR 낮은 순 / ROE 높은 순으로 정렬한다.
// ⚠️ "저평가"라고 단정하지 않는다 — PER이 낮은 데는 실적이 나쁠 것이란 전망이 깔린
// 경우가 많다. 화면에도 사실(수치)만 쓰고 판단은 사용자에게 남긴다.
function getFinRank(sort) {
  const snap = readDartSnapshot_();
  if (!snap) return { rows: [], error: '재무 데이터가 아직 준비되지 않았어요.' };

  const mk = safe_(function () { return getMarket(false); });
  const items = (mk && mk.items) || [];
  const rows = [];
  items.forEach(function (x) {
    const v = snap.byCode[x.code];
    if (!v) return;
    rows.push({
      code: x.code, name: x.name, price: x.price, changePct: x.changePct,
      marketCap: x.marketCap,
      per: v.per, pbr: v.pbr, roe: v.roe, opMargin: v.opMargin, debtRatio: v.debtRatio
    });
  });

  const key = sort === 'pbr' ? 'pbr' : sort === 'roe' ? 'roe' : 'per';
  const desc = key === 'roe';
  const sorted = rows
    .filter(function (r) { return r[key] !== null && r[key] !== undefined; })
    .sort(function (a, b) { return desc ? b[key] - a[key] : a[key] - b[key]; });

  return { rows: sorted, year: snap.year, sort: key, total: rows.length };
}

// ================= 10. 재무지표 AI 해설 =================
// 숫자만 띄우는 건 네이버 증권도 한다. 이 프로젝트의 목적은 그 숫자가 **무슨 뜻인지**
// 초보자 말로 풀어주는 것이다. 그래서 지표마다 한 문장씩 해설을 붙인다.
//
// ⚠️ 가장 중요한 원칙: "PER이 낮다 = 싸다 = 사야 한다"로 읽히게 쓰지 않는다.
// PER이 낮은 회사는 시장이 앞으로 실적이 나빠질 거라고 보는 경우가 많다. 사실(수치)과
// 그 수치의 의미까지만 말하고, 살지 말지는 사용자가 판단한다.

var FIN_AI_SCHEMA_ = {
  type: 'object',
  properties: {
    summary: {
      type: 'string',
      description: '이 회사의 재무 상태를 초보자에게 요약해주는 한국어 2~3문장. ' +
        '주어진 수치에 근거해서만 쓸 것. 좋다/나쁘다로 단정하지 말고 특징을 짚어줄 것.'
    },
    metrics: {
      type: 'array',
      description: '지표별 해설. 값이 있는 지표만 담고, 값이 없는(–) 지표는 넣지 말 것.',
      items: {
        type: 'object',
        properties: {
          key: {
            type: 'string',
            enum: ['per', 'pbr', 'roe', 'opMargin', 'debtRatio'],
            description: '해설 대상 지표'
          },
          text: {
            type: 'string',
            description: '이 지표가 무슨 뜻인지 + 이 회사 수치가 어느 정도인지 한국어 1~2문장. ' +
              '용어는 반드시 쉬운 말로 풀어서 설명할 것. 가능하면 시장 중앙값과 비교해줄 것.'
          }
        },
        required: ['key', 'text'],
        additionalProperties: false
      }
    },
    watch: {
      type: 'string',
      description: '이 수치들을 볼 때 같이 따져봐야 할 점 한국어 1~2문장. ' +
        '⚠️ 매수/매도 추천이나 목표가는 절대 쓰지 말 것. 판단 재료만 알려줄 것.'
    }
  },
  required: ['summary', 'metrics', 'watch'],
  additionalProperties: false
};

// 스냅샷 전체의 중앙값. "PER 34배"만 보면 높은지 알 수 없지만 "시장 중앙값 15배"가
// 같이 있으면 초보자도 감을 잡는다. 이미 저장된 값이라 추가 호출이 0이다.
// 평균이 아니라 중앙값을 쓰는 이유: PER 300배짜리 하나가 평균을 통째로 망가뜨린다.
function dartMedians_(snap) {
  const out = {};
  ['per', 'pbr', 'roe', 'opMargin', 'debtRatio'].forEach(function (k) {
    const vals = Object.keys(snap.byCode)
      .map(function (c) { return snap.byCode[c][k]; })
      .filter(function (v) { return v !== null && v !== undefined; })
      .sort(function (a, b) { return a - b; });
    if (!vals.length) { out[k] = null; return; }
    const mid = Math.floor(vals.length / 2);
    const med = vals.length % 2 ? vals[mid] : (vals[mid - 1] + vals[mid]) / 2;
    out[k] = Math.round(med * 100) / 100;
  });
  out.count = Object.keys(snap.byCode).length;
  return out;
}

var FIN_AI_CACHE_SEC_ = 21600; // 6시간

function getFinAi(symbol, noCache) {
  const code = krCode_(symbol);
  if (!code) return { error: '국내 종목만 해설할 수 있어요.' };

  const key = getProp_('ANTHROPIC_API_KEY');
  if (!key) return { error: 'AI 해설은 ANTHROPIC_API_KEY가 설정돼야 동작합니다.' };

  const fin = getFinance(code, noCache);
  if (!fin || fin.error) return { error: (fin && fin.error) || '재무 데이터를 찾지 못했어요.' };

  const v = fin.valuation || {};
  // 주가가 움직이면 PER·PBR도 같이 움직인다. 캐시 키에 수치를 넣어두면 값이 의미 있게
  // 바뀐 순간 자동으로 다시 만들어진다 — 시간만으로 만료시키면 옛날 숫자를 설명하게 된다.
  const stamp = [fin.year, v.per, v.pbr, v.roe].join('|');
  const cacheKey = 'finai_' + code + '_' + md5_(stamp);
  const cached = noCache ? null : cacheGet_(cacheKey);
  if (cached) return cached;

  const snap = readDartSnapshot_();
  const medians = snap ? dartMedians_(snap) : null;

  const result = callClaudeFinAi_(key, fin, medians);
  if (!result) return { error: '해설을 만들지 못했어요. 잠시 후 다시 시도해주세요.' };

  const data = {
    code: code, name: fin.name, year: fin.year,
    summary: result.summary,
    metrics: (result.metrics || []).filter(function (m) {
      // 값이 없는 지표를 모델이 굳이 설명했다면 화면과 어긋나므로 버린다.
      return v[m.key] !== null && v[m.key] !== undefined;
    }),
    watch: result.watch,
    at: new Date().toISOString()
  };
  cachePut_(cacheKey, data, FIN_AI_CACHE_SEC_);
  return data;
}

var FIN_AI_LABELS_ = {
  per: ['PER', '배'], pbr: ['PBR', '배'], roe: ['ROE', '%'],
  opMargin: ['영업이익률', '%'], debtRatio: ['부채비율', '%']
};

function callClaudeFinAi_(apiKey, fin, medians) {
  const v = fin.valuation || {};
  const lines = [];
  Object.keys(FIN_AI_LABELS_).forEach(function (k) {
    if (v[k] === null || v[k] === undefined) return;
    const L = FIN_AI_LABELS_[k];
    var s = '- ' + L[0] + ': ' + v[k] + L[1];
    if (medians && medians[k] !== null) s += ' (시장 상위 100종목 중앙값 ' + medians[k] + L[1] + ')';
    lines.push(s);
  });
  if (!lines.length) return null;

  const f = fin.financials || {};
  const jo = function (n) {
    return n === null || n === undefined ? null : (Math.round(n / 1e11) / 10) + '조원';
  };
  const finLines = [];
  if (jo(f.revenue)) finLines.push('- 매출액: ' + jo(f.revenue));
  if (jo(f.operatingProfit)) finLines.push('- 영업이익: ' + jo(f.operatingProfit));
  if (jo(f.netIncome)) finLines.push('- 당기순이익: ' + jo(f.netIncome));
  if (jo(f.equity)) finLines.push('- 자본총계: ' + jo(f.equity));

  // 추이를 같이 주면 "PER이 낮다"가 아니라 "이익이 3년째 줄고 있어서 PER이 낮다"까지
  // 갈 수 있다. 초보자에게 진짜 필요한 건 그 연결이다.
  const trendLines = [];
  ((fin.trend && fin.trend.operatingProfit) || []).forEach(function (p) {
    trendLines.push(p.year + '년 ' + jo(p.value));
  });

  const prompt =
    '[' + (fin.name || fin.code) + ' — ' + fin.year + '년 사업보고서(DART) 기준]\n' +
    lines.join('\n') + '\n\n' +
    (finLines.length ? '[실적]\n' + finLines.join('\n') + '\n\n' : '') +
    (trendLines.length ? '[영업이익 추이] ' + trendLines.join(' → ') + '\n\n' : '') +
    (v.loss ? '※ 이 회사는 당기순손실(적자)이라 PER을 계산할 수 없다.\n\n' : '') +
    'summary에는 이 회사 재무 상태의 특징을 2~3문장으로 요약해줘.\n' +
    'metrics에는 위에 값이 있는 지표만 골라 각각 무슨 뜻인지 풀어줘. ' +
    '예를 들어 "PBR 0.8배 — 회사가 가진 순자산보다 시가총액이 더 싸게 매겨져 있다는 뜻입니다" ' +
    '처럼 용어를 반드시 쉬운 말로 바꿔줘. 중앙값이 주어진 지표는 시장과 비교해줘.\n' +
    'watch에는 이 숫자들을 볼 때 함께 따져봐야 할 점을 알려줘.\n\n' +
    // 정의를 안 주면 모델이 그럴듯하게 틀린 말을 한다. 실제로 부채비율을 "자산 대비"라고
    // 설명한 적이 있는데, 삼성전자 기준 23%와 29.9%로 값 자체가 달라진다.
    '[지표 정의 — 이 정의대로만 설명할 것]\n' +
    '- PER = 시가총액 ÷ 당기순이익 (순이익의 몇 배 가격인가)\n' +
    '- PBR = 시가총액 ÷ 자본총계 (순자산의 몇 배 가격인가)\n' +
    '- ROE = 당기순이익 ÷ 자본총계 (주주 돈으로 얼마를 벌었나)\n' +
    '- 영업이익률 = 영업이익 ÷ 매출액 (판 돈에서 얼마가 남나)\n' +
    '- 부채비율 = 부채총계 ÷ **자본총계** (자산 대비가 아니다. 100%면 빚과 자기 돈이 같다)\n\n' +
    '⚠️ 지켜야 할 것:\n' +
    '- 주어진 수치만 쓰고 없는 숫자를 지어내지 마. 업종 평균이나 경쟁사 수치를 아는 척하지 마.\n' +
    // 13.07%와 8.07%를 두고 "5배 높다"고 쓴 적이 있다(뺄셈 결과를 배수로 착각).
    // 초보자용 화면이라 틀린 배수 하나가 인상을 통째로 바꾼다. 아예 계산을 시키지 않는다.
    '- **배수를 직접 계산하지 마.** "○배 높다/낮다" 같은 표현을 쓰지 말고, ' +
    '"13.07%로 중앙값 8.07%보다 높습니다"처럼 두 숫자를 그대로 나란히 놓고 높다/낮다만 말해.\n' +
    // "저평가"는 이미 판단이 끝난 단어다. 초보자는 이걸 "사도 된다"로 읽는다.
    // 조건부로 쓰지 말라고만 하면 모델이 슬그머니 쓴다 — 단어 자체를 금지한다.
    '- **"저평가", "고평가", "싸다", "비싸다", "매력적이다"라는 단어를 쓰지 마**. ' +
    '대신 "중앙값보다 낮습니다/높습니다"처럼 사실만 말해.\n' +
    '- PER이나 PBR이 낮은 건 시장이 앞으로 실적이 나빠질 거라 보기 때문인 경우가 많아. ' +
    '낮다는 사실만 좋은 일처럼 쓰면 틀린 인상을 준다. 왜 낮은지를 같이 짚어줘.\n' +
    '- 매수/매도 추천, 목표가, "지금이 기회" 같은 말은 절대 쓰지 마.\n' +
    '- 은행·보험처럼 부채비율이 원래 높은 업종이면 그 점을 밝혀줘.';

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
        output_config: { format: { type: 'json_schema', schema: FIN_AI_SCHEMA_ } },
        system: '너는 초보 투자자에게 기업 재무제표를 쉽게 풀어주는 도우미야. ' +
          '투자 권유는 절대 하지 않고, 숫자가 무슨 뜻인지만 정확하게 설명한다.',
        messages: [{ role: 'user', content: prompt }]
      })
    });
  } catch (err) {
    console.log('callClaudeFinAi_: 연결 실패 - ' + err);
    return null;
  }

  const code = res.getResponseCode();
  const body = res.getContentText();
  if (code >= 400) { console.log('callClaudeFinAi_: HTTP ' + code + ' - ' + body.slice(0, 300)); return null; }

  const json = JSON.parse(body);
  if (json.stop_reason === 'refusal' || json.stop_reason === 'max_tokens') {
    console.log('callClaudeFinAi_: stop_reason=' + json.stop_reason);
    return null;
  }
  const textBlock = (json.content || []).filter(function (b) { return b.type === 'text'; })[0];
  if (!textBlock) return null;
  try {
    return JSON.parse(textBlock.text);
  } catch (err) {
    console.log('callClaudeFinAi_: JSON 파싱 실패 - ' + err);
    return null;
  }
}

// ================= 11. 투자자별 수급 (외국인·기관·개인) =================
// KRX 공식 API는 세션 쿠키를 붙여도 LOGOUT만 돌려준다. 네이버 PC 페이지(frgn.naver)에는
// 기관·외국인만 있고 **개인이 없다**. 네이버 모바일 API가 셋을 다 주는 유일한 무료 경로다.
//
// ⚠️ 개인을 -(외국인+기관)으로 역산하면 안 된다. 기타법인·내국인이 따로 있어서 세 값의
// 합이 0이 아니다(삼성전자 실측 +296,663주). 반드시 individualPureBuyQuant를 그대로 쓸 것.

var FLOW_URL_ = 'https://m.stock.naver.com/api/stock/';
var FLOW_CACHE_SEC_ = 1800; // 30분 — 장중에도 30분마다 갱신되면 충분하다
var FLOW_DAYS_ = 10;        // 이 API가 주는 최대치

// "+8,359,011" / "-11,681,307" / "" → 숫자
function flowNum_(s) {
  if (s === null || s === undefined || s === '') return null;
  const t = String(s).replace(/[,+\s]/g, '');
  const n = Number(t);
  return isNaN(n) ? null : n;
}

// "20260731" → "2026-07-31"
function flowDate_(s) {
  const t = String(s || '');
  return t.length === 8 ? t.slice(0, 4) + '-' + t.slice(4, 6) + '-' + t.slice(6) : t;
}

function getFlow(symbol, noCache) {
  const code = krCode_(symbol);
  if (!code) return { error: '국내 종목만 수급을 볼 수 있어요.' };

  const cacheKey = 'flow_' + code;
  const cached = noCache ? null : cacheGet_(cacheKey);
  if (cached) return cached;

  const res = UrlFetchApp.fetch(FLOW_URL_ + code + '/trend', {
    muteHttpExceptions: true,
    headers: { 'User-Agent': BROWSER_LIKE_HEADERS_['User-Agent'], 'Referer': 'https://m.stock.naver.com/' }
  });
  if (res.getResponseCode() >= 400) return { error: '수급 데이터를 불러오지 못했어요.' };

  var raw;
  try { raw = JSON.parse(res.getContentText()); } catch (err) { raw = null; }
  // 상장폐지·신규상장 등으로 자료가 없으면 배열이 아닌 게 온다.
  if (!raw || !raw.length) return { code: code, days: [], totals: null };

  const days = raw.slice(0, FLOW_DAYS_).map(function (r) {
    return {
      date: flowDate_(r.bizdate),
      foreign: flowNum_(r.foreignerPureBuyQuant),
      inst: flowNum_(r.organPureBuyQuant),
      indiv: flowNum_(r.individualPureBuyQuant),
      close: flowNum_(r.closePrice),
      change: flowNum_(r.compareToPreviousClosePrice),
      volume: flowNum_(r.accumulatedTradingVolume),
      holdRatio: r.foreignerHoldRatio || null
    };
  }).reverse(); // 응답은 최신순 — 화면은 오래된 날부터 그린다

  const sum = function (k) {
    return days.reduce(function (a, d) { return a + (d[k] || 0); }, 0);
  };
  const data = {
    code: code,
    days: days,
    totals: { foreign: sum('foreign'), inst: sum('inst'), indiv: sum('indiv'), days: days.length },
    holdRatio: days.length ? days[days.length - 1].holdRatio : null
  };
  cachePut_(cacheKey, data, FLOW_CACHE_SEC_);
  return data;
}

// AI 설명에 넘길 한 줄 요약. 뉴스에 뚜렷한 재료가 없는 날에도 "누가 샀나"는 말할 수 있다.
function flowContext_(flow) {
  if (!flow || flow.error || !flow.days || !flow.days.length) return '';
  const last = flow.days[flow.days.length - 1];
  const man = function (v) {
    if (v === null) return '?';
    const s = v > 0 ? '+' : '';
    return s + Math.round(v / 10000).toLocaleString() + '만주';
  };
  const t = flow.totals;
  return '오늘 수급(순매수): 외국인 ' + man(last.foreign) + ', 기관 ' + man(last.inst) +
    ', 개인 ' + man(last.indiv) + '\n' +
    '최근 ' + t.days + '거래일 누적: 외국인 ' + man(t.foreign) + ', 기관 ' + man(t.inst) +
    ', 개인 ' + man(t.indiv);
}

// ================= 12. 로그인 (구글) =================
// 비밀번호를 직접 받지 않는다. 구글이 신원을 확인해주고, 우리는 그 결과(ID 토큰)만 검증한다.
// 저장하는 개인정보는 구글이 주는 sub(고유 ID)·이메일·이름뿐이고, 전화번호는 받지 않는다.
//
// 🔴 이 웹앱은 ANYONE_ANONYMOUS다. 즉 URL만 알면 누구나 호출할 수 있다.
//    그래서 **클라이언트가 보낸 사용자 식별자를 절대 믿으면 안 된다.**
//    userId를 파라미터로 받으면 남의 데이터를 그대로 읽어갈 수 있다.
//    사용자 구분은 오직 **검증된 토큰 안의 sub**로만 한다.

var GSI_TOKENINFO_ = 'https://oauth2.googleapis.com/tokeninfo?id_token=';
var AUTH_CACHE_SEC_ = 300;    // 토큰 검증 결과 캐시(5분). 토큰 만료보다 짧게 잡는다.
var USER_SHEET_ = 'users';
var DATA_SHEET_ = 'userdata';

// 구글이 서명한 ID 토큰인지 확인하고 사용자 정보를 돌려준다.
// tokeninfo 엔드포인트가 서명·만료를 검사해준다. 다만 **그것만으론 부족하다** —
// 다른 앱용으로 발급된 토큰도 서명은 유효하기 때문에 aud(발급 대상)를 반드시 대조해야 한다.
// 이걸 빼먹으면 아무 구글 앱 토큰으로나 남의 계정에 들어올 수 있다.
function verifyIdToken_(idToken) {
  const t = String(idToken || '').trim();
  if (!t || t.length > 4000) return null;

  // getProp_는 값이 없으면 예외를 던진다. 여기서는 "설정 안 됨"도 그냥 로그인 실패로
  // 다뤄야 한다 — 예외가 나가면 응답에 내부 사정이 실린다.
  const clientId = PropertiesService.getScriptProperties().getProperty('GOOGLE_CLIENT_ID');
  if (!clientId) { console.log('verifyIdToken_: GOOGLE_CLIENT_ID 미설정'); return null; }

  const cacheKey = 'auth_' + md5_(t);
  const cached = cacheGet_(cacheKey);
  if (cached) return cached;

  var res;
  try {
    res = UrlFetchApp.fetch(GSI_TOKENINFO_ + encodeURIComponent(t), { muteHttpExceptions: true });
  } catch (err) {
    console.log('verifyIdToken_: 연결 실패');
    return null;
  }
  if (res.getResponseCode() !== 200) return null;

  var info;
  try { info = JSON.parse(res.getContentText()); } catch (err) { return null; }

  if (info.aud !== clientId) { console.log('verifyIdToken_: aud 불일치'); return null; }
  if (info.iss !== 'accounts.google.com' && info.iss !== 'https://accounts.google.com') return null;
  // tokeninfo가 만료를 걸러주지만, 시계 오차나 응답 캐싱을 감안해 한 번 더 본다.
  if (!info.exp || Number(info.exp) * 1000 <= Date.now()) return null;
  if (!info.sub) return null;
  // 이메일 미인증 계정은 이메일을 신뢰할 수 없다. 식별은 sub로 하므로 로그인은 되지만
  // 이메일은 비워둔다.
  const verified = String(info.email_verified) === 'true';

  const user = {
    sub: info.sub,
    email: verified ? (info.email || '') : '',
    name: info.name || '',
    picture: info.picture || ''
  };
  // 캐시는 토큰 남은 수명과 5분 중 짧은 쪽으로.
  const ttl = Math.min(AUTH_CACHE_SEC_, Math.floor((Number(info.exp) * 1000 - Date.now()) / 1000));
  if (ttl > 0) cachePut_(cacheKey, user, ttl);
  return user;
}

// 사용자 데이터는 스프레드시트에 둔다. 스크립트 속성은 값당 9KB라 사람이 늘면 금방 찬다.
function userSheet_(name, headers) {
  const id = getProp_('USER_SHEET_ID');
  if (!id) throw new Error('USER_SHEET_ID가 설정되지 않았습니다.');
  const ss = SpreadsheetApp.openById(id);
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(headers);
  }
  return sh;
}

// sub → 시트 행 번호. 매번 전체를 훑지 않도록 캐시한다.
function findUserRow_(sh, sub) {
  const values = sh.getRange(1, 1, Math.max(sh.getLastRow(), 1), 1).getValues();
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][0]) === sub) return i + 1;
  }
  return 0;
}

var NICK_MAX_ = 20;

function sanitizeNick_(s) {
  return String(s || '').replace(/[\r\n\t]/g, ' ').trim().slice(0, NICK_MAX_);
}

// 로그인. 없으면 만들고 있으면 마지막 접속 시각만 갱신한다.
function getMe(idToken) {
  const user = verifyIdToken_(idToken);
  if (!user) return { error: '로그인이 필요합니다.', authRequired: true };

  const sh = userSheet_(USER_SHEET_, ['sub', 'email', 'nickname', 'joinedAt', 'lastSeenAt']);
  const row = findUserRow_(sh, user.sub);
  const now = new Date().toISOString();

  if (!row) {
    const nick = sanitizeNick_(user.name) || '이름없는양';
    sh.appendRow([user.sub, user.email, nick, now, now]);
    return { sub: user.sub, email: user.email, nickname: nick, picture: user.picture, isNew: true };
  }
  sh.getRange(row, 5).setValue(now);
  return {
    sub: user.sub,
    email: user.email,
    nickname: sh.getRange(row, 3).getValue() || sanitizeNick_(user.name),
    picture: user.picture,
    isNew: false
  };
}

function setNickname(idToken, nickname) {
  const user = verifyIdToken_(idToken);
  if (!user) return { error: '로그인이 필요합니다.', authRequired: true };
  const nick = sanitizeNick_(nickname);
  if (!nick) return { error: '닉네임을 입력해주세요.' };

  const sh = userSheet_(USER_SHEET_, ['sub', 'email', 'nickname', 'joinedAt', 'lastSeenAt']);
  const row = findUserRow_(sh, user.sub);
  if (!row) return { error: '가입 정보를 찾지 못했어요.' };
  sh.getRange(row, 3).setValue(nick);
  return { nickname: nick };
}

var USERDATA_MAX_ = 20000; // 한 사람이 저장할 수 있는 JSON 길이 상한

// 관심종목·포트폴리오를 한 칸에 JSON으로 넣는다. 사용자당 한 행이라 단순하다.
function getUserData(idToken) {
  const user = verifyIdToken_(idToken);
  if (!user) return { error: '로그인이 필요합니다.', authRequired: true };

  const sh = userSheet_(DATA_SHEET_, ['sub', 'data', 'updatedAt']);
  const row = findUserRow_(sh, user.sub);
  if (!row) return { watchlist: [], portfolio: [] };
  try {
    const parsed = JSON.parse(sh.getRange(row, 2).getValue() || '{}');
    return {
      watchlist: parsed.watchlist || [],
      portfolio: parsed.portfolio || [],
      updatedAt: sh.getRange(row, 3).getValue()
    };
  } catch (err) {
    return { watchlist: [], portfolio: [] };
  }
}

function saveUserData(idToken, payloadJson) {
  const user = verifyIdToken_(idToken);
  if (!user) return { error: '로그인이 필요합니다.', authRequired: true };

  const raw = String(payloadJson || '');
  if (raw.length > USERDATA_MAX_) return { error: '저장할 데이터가 너무 큽니다.' };

  var parsed;
  try { parsed = JSON.parse(raw); } catch (err) { return { error: '데이터 형식이 올바르지 않습니다.' }; }

  // 클라이언트가 뭘 보내든 우리가 쓰는 모양으로만 다시 만든다.
  const clean = JSON.stringify({
    watchlist: cleanWatchlist_(parsed.watchlist),
    portfolio: cleanPortfolio_(parsed.portfolio)
  });

  const sh = userSheet_(DATA_SHEET_, ['sub', 'data', 'updatedAt']);
  const row = findUserRow_(sh, user.sub);
  const now = new Date().toISOString();
  if (!row) sh.appendRow([user.sub, clean, now]);
  else sh.getRange(row, 2, 1, 2).setValues([[clean, now]]);
  return { ok: true, updatedAt: now };
}

function cleanWatchlist_(list) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, WATCHLIST_MAX_).map(function (w) {
    return {
      symbol: String((w && w.symbol) || '').slice(0, 20),
      name: String((w && w.name) || '').slice(0, 40)
    };
  }).filter(function (w) { return w.symbol; });
}

var PORTFOLIO_MAX_ = 50;

function cleanPortfolio_(list) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, PORTFOLIO_MAX_).map(function (p) {
    const qty = Number((p && p.qty) || 0);
    const avg = Number((p && p.avgPrice) || 0);
    return {
      symbol: String((p && p.symbol) || '').slice(0, 20),
      name: String((p && p.name) || '').slice(0, 40),
      qty: isFinite(qty) && qty > 0 ? qty : 0,
      avgPrice: isFinite(avg) && avg >= 0 ? avg : 0
    };
  }).filter(function (p) { return p.symbol && p.qty > 0; });
}

// 로그인이 필요한 요청은 전부 POST로 받는다. GET 쿼리에 토큰을 실으면 접속 로그·리퍼러에
// 그대로 남는다 — 토큰은 유효한 동안 그 사람 자체이므로 URL에 두면 안 된다.
//
// 브라우저가 사전 요청(preflight)을 보내면 GAS가 응답하지 못해 막힌다. 그래서 프런트는
// Content-Type을 text/plain으로 보내고, 본문에 JSON을 담는다.
function doPost(e) {
  var result;
  try {
    var body = {};
    try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (err) { body = {}; }
    const action = String(body.action || '');
    const token = body.idToken || '';

    switch (action) {
      case 'me':
        result = getMe(token);
        break;
      case 'nickname':
        result = setNickname(token, body.nickname);
        break;
      case 'userdata':
        result = getUserData(token);
        break;
      case 'saveuserdata':
        result = saveUserData(token, JSON.stringify(body.data || {}));
        break;
      default:
        result = { error: 'unknown action: ' + action };
    }
  } catch (err) {
    console.log('doPost 예외: ' + err);
    result = { error: scrubSecrets_(String(err)) };
  }
  return ContentService
    .createTextOutput(JSON.stringify(scrubValue_(result)))
    .setMimeType(ContentService.MimeType.JSON);
}

// ================= 13. 실적 발표 (어닝) =================
// 주가는 "실적이 좋았나"가 아니라 **"예상보다 좋았나"**로 움직인다. 사상 최대 실적을 내고도
// 예상에 못 미쳐 떨어지는 일이 흔하다. 그래서 예상치와 실제치를 항상 같이 보여준다.
//
// ⚠️ 어닝콜 **녹취록·전문 요약은 만들 수 없다.** Finnhub transcripts는 유료 플랜이고
//    국내는 공개 전문이 사실상 없다. 숫자와 일정까지만 다룬다.

// 예상 대비 몇 % 인지. 예상치가 0에 가까우면 퍼센트가 무의미하게 커지므로 내지 않는다
// (EPS 0.01 예상에 0.05가 나오면 +400%가 되는데, 이건 정보가 아니라 착시다).
var SURPRISE_MIN_BASE_ = 0.02;

function surprisePct_(est, act) {
  if (est === null || act === null || est === undefined || act === undefined) return null;
  if (Math.abs(est) < SURPRISE_MIN_BASE_) return null;
  return Math.round(((act - est) / Math.abs(est)) * 1000) / 10;
}

// "amc"(장 마감 후) / "bmo"(장 개장 전) — 초보자에게는 풀어서 보여준다.
var EARN_HOUR_ = { amc: '장 마감 후', bmo: '장 시작 전', dmh: '장중' };

function earningsRow_(e) {
  const sur = surprisePct_(e.epsEst, e.epsAct);
  return {
    market: 'us',
    symbol: e.symbol,
    name: e.symbol,
    date: e.date,
    when: EARN_HOUR_[e.hour] || '',
    quarter: e.quarter, year: e.year,
    epsEst: e.epsEst, epsAct: e.epsAct,
    revEst: e.revEst, revAct: e.revAct,
    epsSurprise: sur,
    revSurprise: surprisePct_(e.revEst, e.revAct),
    // 실제치가 들어왔으면 발표가 끝난 것이다.
    done: e.epsAct !== null && e.epsAct !== undefined
  };
}

// KIND 설명문에 "질의응답"이 있으면 컨퍼런스콜(어닝콜)이 같이 열린다는 뜻이다.
var KR_CALL_RE_ = /질의\s*응답|컨퍼런스\s*콜|conference\s*call|IR\s*미팅/i;

function krEarningsRow_(e, todayStr) {
  return {
    market: 'kr',
    name: e.corp,
    code: e.code || null,
    date: e.date,
    when: e.time || '',
    desc: e.desc || '',
    hasCall: KR_CALL_RE_.test(e.desc || ''),
    done: e.date < todayStr
  };
}

function getEarnings(noCache) {
  const cal = getCalendar(noCache);
  if (!cal) return { error: '실적 일정을 불러오지 못했어요.' };

  const today = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd');
  const us = (cal.earnings || []).map(earningsRow_);
  const kr = (cal.krEarnings || []).map(function (e) { return krEarningsRow_(e, today); });

  const all = us.concat(kr).sort(function (a, b) {
    return a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
  });

  return {
    upcoming: all.filter(function (x) { return !x.done && x.date >= today; }),
    recent: all.filter(function (x) { return x.done || x.date < today; })
      .sort(function (a, b) { return a.date > b.date ? -1 : 1; }),
    today: today,
    from: cal.from, to: cal.to
  };
}

// ---- 발표 후 주가 반응 ----
// 언제 반응했는지는 발표 시각에 달렸다. 장 마감 후(amc) 발표면 **다음 거래일**에 반영되고,
// 장 시작 전(bmo) 발표면 **그날** 반영된다. 이걸 뒤집으면 엉뚱한 날의 등락을 보여주게 된다.
function reactsSameDay_(when) {
  return when === '장 시작 전' || when === '장중';
}

// 일별 종가에서 기준일(포함) 이후 첫 거래일의 등락률을 구한다.
function reactionFrom_(points, dateStr, sameDay) {
  if (!points || points.length < 2) return null;
  for (var i = 1; i < points.length; i++) {
    const d = String(points[i].date).slice(0, 10);
    const hit = sameDay ? (d >= dateStr) : (d > dateStr);
    if (hit) {
      const prev = points[i - 1].close;
      const cur = points[i].close;
      if (!prev || cur === null) return null;
      return {
        date: d,
        prevClose: prev,
        close: cur,
        changePct: Math.round(((cur - prev) / prev) * 1000) / 10
      };
    }
  }
  return null;
}

function earningsReaction_(symbol, dateStr, when) {
  // getYahooHistory_는 이미 [{date, close}]로 파싱해서 돌려준다 — 여기서 또 파싱하면 안 된다.
  const points = safe_(function () { return getYahooHistory_(symbol, '3mo'); });
  if (!points || !points.length) return null;
  return reactionFrom_(points, dateStr, reactsSameDay_(when));
}

// ---- 국내 실적 공시 (DART) ----
// 잠정실적 공시 자체의 숫자를 뜯어오려면 공시 원문(HTML)을 파싱해야 하는데 서식이 제각각이라
// 깨지기 쉽다. 여기서는 **공시가 있다는 사실과 원문 링크까지만** 제공한다.
var DART_LIST_RE_ = /실적|영업\(잠정\)|손익구조/;

// yyyy-MM-dd에서 n일 이동. 월말/연말을 Date가 알아서 넘겨준다.
function shiftDate_(dateStr, n) {
  const d = new Date(Number(dateStr.slice(0, 4)), Number(dateStr.slice(5, 7)) - 1,
    Number(dateStr.slice(8, 10)) + n);
  return Utilities.formatDate(d, 'Asia/Seoul', 'yyyy-MM-dd');
}

function dartEarningsFilings_(corpCode, fromDate, toDate) {
  const key = PropertiesService.getScriptProperties().getProperty('DART_API_KEY');
  if (!key || !corpCode) return [];
  const url = DART_BASE_ + 'list.json?crtfc_key=' + key + '&corp_code=' + corpCode +
    '&bgn_de=' + fromDate.replace(/-/g, '') + '&end_de=' + toDate.replace(/-/g, '') +
    '&page_count=100';
  const res = safe_(function () { return UrlFetchApp.fetch(url, { muteHttpExceptions: true }); });
  if (!res || res.getResponseCode() >= 400) return [];
  var json;
  try { json = JSON.parse(res.getContentText()); } catch (err) { return []; }
  if (json.status !== '000') return [];
  return (json.list || [])
    .filter(function (x) { return DART_LIST_RE_.test(x.report_nm || ''); })
    .slice(0, 5)
    .map(function (x) {
      return {
        name: x.report_nm,
        date: String(x.rcept_dt || '').replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3'),
        link: 'https://dart.fss.or.kr/dsaf001/main.do?rcpNo=' + x.rcept_no
      };
    });
}

// KIND는 종목명만 준다. 코드가 있어야 DART·수급·시세를 붙일 수 있어서 순위표에서 찾아본다.
// KIND 링크에서 유추한 코드가 진짜 상장사 코드인지 DART 상장사 목록으로 확인한다.
// 목록에 없으면 유추가 틀린 것이므로 쓰지 않는다 — 엉뚱한 회사의 시세·수급을 보여주느니
// 아무것도 안 보여주는 편이 낫다.
function verifiedKrCode_(code) {
  if (!code || !/^\d{6}$/.test(code)) return null;
  const map = safe_(function () { return readDartCorpMap_(); }) || {};
  if (!map[code]) return null;
  return { code: code, symbol: code + '.KS' };
}

function codeByName_(name) {
  const target = String(name || '').replace(/\s/g, '');
  if (!target) return null;

  // 1) 순위표(상위 100종목)에서 먼저 찾는다 — 추가 호출이 없다.
  const mk = safe_(function () { return getMarket(false); });
  const items = (mk && mk.items) || [];
  for (var i = 0; i < items.length; i++) {
    // 순위표는 코스피 기준이라 .KS로 본다.
    if (String(items[i].name).replace(/\s/g, '') === target) {
      return { code: items[i].code, symbol: items[i].code + '.KS' };
    }
  }

  // 2) 실적 발표는 중소형주가 훨씬 많다. 상위 100종목만 보면 대부분 코드를 못 찾아
  //    주가 반응·수급·공시가 통째로 빠진다. 그래서 종목 검색으로 한 번 더 찾는다.
  const cacheKey = 'code_' + target.slice(0, 60);
  const cached = cacheGet_(cacheKey);
  if (cached) return cached.code ? cached : null;

  const found = safe_(function () { return resolveSymbol_(name); });
  // 국내 종목만 받는다. 해외가 섞여 오면 엉뚱한 회사의 수급을 보여주게 된다.
  // 코스닥은 .KQ다 — 전부 .KS로 붙이면 시세 조회가 통째로 실패한다.
  const ok = found && /^\d{6}\.(KS|KQ)$/.test(found.symbol);
  const out = ok ? { code: krCode_(found.symbol), symbol: found.symbol } : { code: null };
  cachePut_(cacheKey, out, 86400);
  return out.code ? out : null;
}

var EARN_DETAIL_CACHE_SEC_ = 3600;

function getEarningsDetail(market, key, dateStr, noCache) {
  const mk = String(market || 'us');
  const id = String(key || '').trim();
  const date = String(dateStr || '').trim();
  if (!id || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: '잘못된 요청입니다.' };

  // ⚠️ md5_(한글) 결과를 키로 쓰면 서로 다른 종목이 같은 캐시를 공유해 **남의 회사 데이터가
  //    섞여 나온다**(실측: 현대제철 요청에 효성화학 응답). 캐시 키는 해시하지 말고
  //    값 자체를 쓴다 — 짧고, 눈으로 확인할 수 있고, 충돌하지 않는다.
  const cacheKey = 'earndet_' + mk + '_' + date + '_' + id.slice(0, 60);
  // 캐시에서 꺼낸 값이 **정말 요청한 종목인지** 확인하고 쓴다.
  // 배포를 반복하는 동안 다른 회사 데이터가 캐시에 섞여 나온 적이 있다(현대제철 요청에
  // 효성화학 응답). 키를 고쳐도 값이 맞는지 확인하지 않으면 같은 사고가 또 난다 —
  // 종목이 뒤바뀐 화면은 틀렸다는 걸 알아채기가 거의 불가능하다.
  const cached = noCache ? null : cacheGet_(cacheKey);
  if (cached && cached.row && cached.row.date === date &&
      (mk === 'us' ? cached.row.symbol === id : cached.row.name === id)) {
    return cached;
  }

  const list = getEarnings(noCache);
  const row = (list.upcoming || []).concat(list.recent || []).filter(function (x) {
    return x.date === date && (mk === 'us' ? x.symbol === id : x.name === id);
  })[0];
  if (!row) return { error: '해당 실적 일정을 찾지 못했어요.' };

  const data = { row: row, market: mk };

  if (mk === 'us') {
    if (row.done) data.reaction = earningsReaction_(id, date, row.when);
  } else {
    // KIND가 준 코드를 먼저 쓰고(중소형주까지 커버), 없거나 미확인이면 이름으로 찾는다.
    const hit = verifiedKrCode_(row.code) || codeByName_(id);
    const code = hit && hit.code;
    data.code = code || null;
    if (code) {
      // 국내는 발표 시각이 장중인 경우가 많아 그날부터 본다.
      data.reaction = earningsReaction_(hit.symbol, date, '장 시작 전');
      data.flow = safe_(function () { return getFlow(code, false); }) || null;
      const map = safe_(function () { return readDartCorpMap_(); }) || {};
      // 공시 접수일과 IR 일정 날짜가 하루이틀 어긋나는 경우가 많아 앞뒤로 넉넉히 본다.
      data.filings = dartEarningsFilings_(map[code], shiftDate_(date, -4), shiftDate_(date, 2));
    }
  }

  cachePut_(cacheKey, data, EARN_DETAIL_CACHE_SEC_);
  return data;
}

// ================= 14. 차트 분석 =================
// 초보자용 차트의 핵심은 지표를 늘어놓는 게 아니라 **숫자를 문장으로 번역**하고
// **차트 위에 "무슨 일이 있었는지"를 붙이는 것**이다.
//
// ⚠️ 기술적 지표는 초보자에게 곧바로 매수 신호로 읽힌다. "골든크로스 발생!"은 사실상
//    "사라"다. 여기서는 관찰만 제공하고 판단은 사용자에게 남긴다.

var CHART_RANGES_ = { '1M': '1mo', '3M': '3mo', '6M': '6mo', '1Y': '1y' };
var CHART_CACHE_SEC_ = 1800;

function chartUrl_(symbol, range) {
  return 'https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(symbol) +
    '?interval=1d&range=' + range;
}

// 이동평균. 앞쪽 n-1개는 계산할 수 없으므로 null로 둔다(선이 0에서 시작하면 안 된다).
function movingAvg_(vals, n) {
  const out = [];
  var sum = 0;
  for (var i = 0; i < vals.length; i++) {
    sum += vals[i];
    if (i >= n) sum -= vals[i - n];
    out.push(i >= n - 1 ? Math.round((sum / n) * 100) / 100 : null);
  }
  return out;
}

function mean_(a) {
  return a.length ? a.reduce(function (x, y) { return x + y; }, 0) / a.length : 0;
}

function round_(v, d) {
  if (v === null || v === undefined || !isFinite(v)) return null;
  const m = Math.pow(10, d);
  return Math.round(v * m) / m;
}

// 하루 등락률 배열. 첫날은 전일이 없어 제외한다.
function dailyMoves_(pts) {
  const out = [];
  for (var i = 1; i < pts.length; i++) {
    const prev = pts[i - 1].close;
    if (prev) out.push({ i: i, pct: ((pts[i].close - prev) / prev) * 100 });
  }
  return out;
}

// 숫자를 그대로 두면 초보자에게 아무 의미가 없다. "평소 대비 몇 배"로 바꿔야 감이 온다.
function chartStats_(pts, meta) {
  const closes = pts.map(function (p) { return p.close; });
  const moves = dailyMoves_(pts);
  // "평소"의 기준에서 오늘은 빼야 한다. 오늘을 넣으면 크게 움직인 날일수록 평균이 같이
  // 올라가 자기 자신을 작아 보이게 만든다(실측: 실제 4배인데 2.7배로 나왔다).
  const baseMoves = moves.slice(0, -1).map(function (m) { return Math.abs(m.pct); });
  const absMoves = baseMoves.length ? baseMoves : moves.map(function (m) { return Math.abs(m.pct); });
  const avgMove = mean_(absMoves);

  // 거래량도 같은 이유로 마지막 날을 기준에서 뺀다.
  const allVols = pts.map(function (p) { return p.volume || 0; }).filter(function (v) { return v > 0; });
  const baseVols = allVols.slice(0, -1);
  const avgVol = mean_(baseVols.length ? baseVols : allVols);
  const last = pts[pts.length - 1];
  const lastMove = moves.length ? moves[moves.length - 1].pct : null;

  // 52주 위치: 1년 최저~최고 중 지금이 어디쯤인지. 막대 하나로 보여주면 바로 이해된다.
  const hi = meta.fiftyTwoWeekHigh, lo = meta.fiftyTwoWeekLow;
  // 야후의 52주 최고/최저는 갱신이 늦을 때가 있어 현재가가 그 범위를 벗어날 수 있다.
  // 그대로 두면 막대 게이지가 음수/100 초과로 튀어나가 화면이 깨진다.
  var pos52 = (hi && lo && hi > lo) ? ((last.close - lo) / (hi - lo)) * 100 : null;
  if (pos52 !== null) pos52 = Math.max(0, Math.min(100, pos52));

  // 최근 2주 오른 날/내린 날 — RSI를 쓰지 않고도 "요즘 분위기"를 전할 수 있다.
  const recent = moves.slice(-10);
  const up = recent.filter(function (m) { return m.pct > 0; }).length;

  const ma20 = movingAvg_(closes, 20);
  const ma60 = movingAvg_(closes, 60);
  const lastMa20 = ma20[ma20.length - 1];
  const lastMa60 = ma60[ma60.length - 1];

  return {
    close: last.close,
    changePct: round_(lastMove, 2),
    avgMove: round_(avgMove, 2),
    // 오늘 움직임이 평소의 몇 배인가 — "5% 하락"보다 "평소의 3배"가 훨씬 잘 와닿는다
    moveRatio: (avgMove && lastMove !== null) ? round_(Math.abs(lastMove) / avgMove, 1) : null,
    volume: last.volume || null,
    avgVolume: round_(avgVol, 0),
    volRatio: (avgVol && last.volume) ? round_(last.volume / avgVol, 1) : null,
    high52: hi || null,
    low52: lo || null,
    pos52: round_(pos52, 0),
    upDays: up,
    downDays: recent.length - up,
    recentDays: recent.length,
    ma20: lastMa20,
    ma60: lastMa60,
    // 평균선 자체보다 "지금 가격이 한 달 평균보다 몇 % 위/아래인가"가 이해하기 쉽다
    vsMa20: lastMa20 ? round_(((last.close - lastMa20) / lastMa20) * 100, 1) : null,
    periodPct: closes.length > 1 ? round_(((last.close - closes[0]) / closes[0]) * 100, 2) : null
  };
}

var EVENT_MOVE_RATIO_ = 2.5;  // 평소 변동의 몇 배부터 "크게 움직인 날"로 볼지
var EVENT_VOL_RATIO_ = 2.5;
var EVENT_MAX_ = 12;

// 차트 위에 찍을 사건들. 고정 퍼센트(±5%)로 자르면 원래 잘 안 움직이는 종목은
// 아무것도 안 잡히고, 변동성 큰 종목은 전부 잡힌다. 그래서 **그 종목의 평소 대비**로 본다.
function chartEvents_(pts, stats) {
  const moves = dailyMoves_(pts);
  const avg = stats.avgMove || 1;
  const avgVol = stats.avgVolume || 0;
  const out = [];

  moves.forEach(function (m) {
    const p = pts[m.i];
    const ratio = Math.abs(m.pct) / avg;
    const vr = avgVol && p.volume ? p.volume / avgVol : 0;
    if (ratio >= EVENT_MOVE_RATIO_) {
      out.push({
        date: p.date, kind: 'move', pct: round_(m.pct, 2),
        ratio: round_(ratio, 1), volRatio: round_(vr, 1)
      });
    } else if (vr >= EVENT_VOL_RATIO_) {
      // 가격은 그대로인데 거래량만 튄 날도 의미가 있다(관심이 몰렸다는 뜻).
      out.push({
        date: p.date, kind: 'volume', pct: round_(m.pct, 2),
        ratio: round_(ratio, 1), volRatio: round_(vr, 1)
      });
    }
  });

  // 너무 많으면 차트가 점으로 뒤덮인다. 큰 것부터 남긴다.
  return out
    .sort(function (a, b) { return Math.abs(b.ratio) - Math.abs(a.ratio); })
    .slice(0, EVENT_MAX_)
    .sort(function (a, b) { return a.date < b.date ? -1 : 1; });
}

// 실적 발표일을 차트에 겹쳐준다 — "이날 왜 튀었지"의 답이 실적인 경우가 아주 많다.
function earningsMarks_(symbol, name, from, to) {
  const cal = safe_(function () { return getEarnings(false); });
  if (!cal) return [];
  const code = krCode_(symbol);
  const rows = (cal.upcoming || []).concat(cal.recent || []);
  const want = String(name || '').replace(/\s/g, '');
  return rows.filter(function (r) {
    if (r.date < from || r.date > to) return false;
    if (code) return r.code === code || (want && String(r.name).replace(/\s/g, '') === want);
    return r.market === 'us' && r.symbol === String(symbol).toUpperCase();
  }).map(function (r) {
    return { date: r.date, kind: 'earnings', label: r.market === 'kr' ? (r.desc || '실적 발표') : '실적 발표' };
  });
}

// 사용자는 "삼성전자"라고 친다. 야후 차트 API는 티커만 받으므로 먼저 바꿔줘야 한다.
// 야후 종목검색은 한글에서 자주 실패하므로(과거 이슈) 순위표 이름 매칭을 먼저 쓴다.
function resolveChartSymbol_(q) {
  const clean = String(q || '').trim();
  if (!clean) return null;
  // 이미 티커 형태면 그대로. 6자리 숫자만 오면 코스피로 본다.
  if (/^\d{6}$/.test(clean)) return clean + '.KS';
  if (/^[A-Za-z0-9.\-]{1,12}$/.test(clean) && /[A-Za-z]/.test(clean)) return clean.toUpperCase();
  if (/^\d{6}\.(KS|KQ)$/i.test(clean)) return clean.toUpperCase();

  const mapped = KOREAN_TICKER_MAP_[clean.toLowerCase()];
  if (mapped && mapped.symbol) return mapped.symbol;

  const hit = safe_(function () { return codeByName_(clean); });
  if (hit && hit.symbol) return hit.symbol;

  const found = safe_(function () { return resolveSymbol_(clean); });
  return (found && found.symbol) ? found.symbol : null;
}

function getChart(symbol, rangeKey, noCache) {
  const raw = String(symbol || '').trim();
  if (!raw || raw.length > 40) return { error: '종목명 또는 코드를 입력해주세요.' };
  const rk = CHART_RANGES_[rangeKey] ? rangeKey : '3M';

  const sym = resolveChartSymbol_(raw);
  if (!sym) {
    return { error: '"' + raw + '"에 해당하는 종목을 찾지 못했어요. 정확한 회사명이나 코드(예: 005930.KS)로 다시 시도해주세요.' };
  }

  const cacheKey = 'chart_' + rk + '_' + sym.toLowerCase();
  const cached = noCache ? null : cacheGet_(cacheKey);
  if (cached && cached.symbol === sym) return cached;

  var json;
  try {
    json = fetchJson_(chartUrl_(sym, CHART_RANGES_[rk]), { headers: BROWSER_LIKE_HEADERS_ });
  } catch (err) {
    return { error: '차트 데이터를 불러오지 못했어요.' };
  }
  const result = json.chart && json.chart.result && json.chart.result[0];
  if (!result) return { error: '차트 데이터를 찾지 못했어요.' };

  const pts = parseYahooPoints_(json);
  if (pts.length < 5) return { error: '차트를 그릴 만큼 데이터가 없어요.' };

  const meta = result.meta || {};
  const stats = chartStats_(pts, meta);
  const closes = pts.map(function (p) { return p.close; });

  const data = {
    symbol: sym,
    name: meta.shortName || meta.longName || sym,
    currency: meta.currency || null,
    range: rk,
    candles: pts.map(function (p) {
      return [p.date, round_(p.open, 2), round_(p.high, 2), round_(p.low, 2), round_(p.close, 2), p.volume || 0];
    }),
    ma20: movingAvg_(closes, 20),
    ma60: movingAvg_(closes, 60),
    stats: stats,
    events: chartEvents_(pts, stats)
      .concat(earningsMarks_(sym, meta.shortName, pts[0].date, pts[pts.length - 1].date))
      .sort(function (a, b) { return a.date < b.date ? -1 : 1; })
  };
  // 같은 기간 지수. 실패해도 차트 본체는 그대로 보여줘야 하므로 safe_로 감싼다.
  data.priceSeries = toPctSeries_(closes);
  data.bench = buildBench_(sym, pts.map(function (p) { return p.date; }), rk);
  cachePut_(cacheKey, data, CHART_CACHE_SEC_);
  return data;
}

// ---- 비교 지수 (D) ----
// "혼자 빠진 건가, 시장이 다 빠진 건가" — 초보자가 가장 많이 착각하는 지점이다.
// 같은 기간 지수를 겹쳐 그리면 이 질문이 한눈에 풀린다.
var BENCH_ = {
  KS: { symbol: '%5EKS11', name: '코스피' },
  KQ: { symbol: '%5EKQ11', name: '코스닥' },
  US: { symbol: '%5EGSPC', name: 'S&P 500' }
};

function benchFor_(symbol) {
  const s = String(symbol || '').toUpperCase();
  if (/\.KQ$/.test(s)) return BENCH_.KQ;
  if (/\.KS$/.test(s)) return BENCH_.KS;
  return BENCH_.US;
}

// 가격 수준이 다른 둘(24만원 vs 6300포인트)을 같은 축에 그릴 수는 없다.
// 첫날을 0%로 맞춘 **변화율**로 바꿔야 비교가 된다.
function toPctSeries_(closes) {
  const base = closes[0];
  if (!base) return closes.map(function () { return null; });
  return closes.map(function (c) {
    return c === null ? null : Math.round(((c - base) / base) * 1000) / 10;
  });
}

// 종목과 지수는 휴장일이 다를 수 있다(미국 종목 vs 한국 지수 등).
// 종목 날짜를 기준으로 삼고, 지수에 그 날짜가 없으면 **직전 값을 이어 쓴다**.
// 이렇게 안 하면 배열 길이가 어긋나 선이 통째로 밀린다.
function alignTo_(dates, benchPts) {
  const map = {};
  benchPts.forEach(function (p) { map[p.date] = p.close; });
  const out = [];
  var last = null;
  dates.forEach(function (d) {
    if (map[d] !== undefined) last = map[d];
    out.push(last);
  });
  // 앞쪽이 비어 있으면(지수가 늦게 시작) 첫 유효값으로 채운다
  var first = null;
  for (var i = 0; i < out.length; i++) { if (out[i] !== null) { first = out[i]; break; } }
  return out.map(function (v) { return v === null ? first : v; });
}

function buildBench_(symbol, dates, rangeKey) {
  const b = benchFor_(symbol);
  const pts = safe_(function () {
    const json = fetchJson_(
      'https://query1.finance.yahoo.com/v8/finance/chart/' + b.symbol +
      '?interval=1d&range=' + CHART_RANGES_[rangeKey], { headers: BROWSER_LIKE_HEADERS_ });
    return parseYahooPoints_(json);
  });
  if (!pts || !pts.length) return null;
  const aligned = alignTo_(dates, pts);
  if (aligned[0] === null) return null;
  const series = toPctSeries_(aligned);
  return {
    name: b.name,
    series: series,
    periodPct: series[series.length - 1]
  };
}

// ---- 차트 AI 해설 (E) ----
// 숫자를 문장으로 바꾸는 건 화면에서 이미 하고 있다. AI가 더할 수 있는 건 **연결**이다 —
// "평소보다 크게 움직였고, 같은 기간 시장은 올랐다"를 한 흐름으로 읽어주는 것.
//
// ⚠️ 차트 해설은 예측으로 미끄러지기 가장 쉬운 자리다. "지지선을 지켰으니 반등이 예상된다"
//    같은 말은 절대 나오면 안 된다. 스키마와 프롬프트 양쪽에서 막는다.

var CHART_AI_SCHEMA_ = {
  type: 'object',
  properties: {
    summary: {
      type: 'string',
      description: '이 기간 주가 흐름을 초보자에게 설명하는 한국어 2~3문장. ' +
        '주어진 수치에만 근거할 것. 앞으로 어떻게 될지는 절대 쓰지 말 것.'
    },
    vsMarket: {
      type: 'string',
      description: '같은 기간 지수와 비교해 어땠는지 한국어 1~2문장. ' +
        '지수 정보가 없으면 빈 문자열.'
    },
    watch: {
      type: 'string',
      description: '이 차트를 볼 때 초보자가 오해하기 쉬운 점 한국어 1~2문장. ' +
        '매수/매도 판단이 아니라 해석상의 주의점만.'
    }
  },
  required: ['summary', 'vsMarket', 'watch'],
  additionalProperties: false
};

var CHART_AI_CACHE_SEC_ = 3600;

function getChartAi(symbol, rangeKey, noCache) {
  const key = getProp_('ANTHROPIC_API_KEY');
  if (!key) return { error: 'AI 해설은 ANTHROPIC_API_KEY가 설정돼야 동작합니다.' };

  const d = getChart(symbol, rangeKey, false);
  if (!d || d.error) return { error: (d && d.error) || '차트를 불러오지 못했어요.' };

  const s = d.stats;
  // 주가가 움직이면 해설도 달라져야 한다. 수치를 캐시 키에 넣어 자동으로 만료시킨다.
  const cacheKey = 'chartai_' + d.range + '_' + d.symbol.toLowerCase() + '_' +
    [s.close, s.changePct, s.periodPct].join('_');
  const cached = noCache ? null : cacheGet_(cacheKey);
  if (cached) return cached;

  const r = callClaudeChartAi_(key, d);
  if (!r) return { error: '해설을 만들지 못했어요. 잠시 후 다시 시도해주세요.' };

  const out = {
    symbol: d.symbol, name: d.name, range: d.range,
    summary: r.summary, vsMarket: r.vsMarket || null, watch: r.watch,
    at: new Date().toISOString()
  };
  cachePut_(cacheKey, out, CHART_AI_CACHE_SEC_);
  return out;
}

var RANGE_KR_ = { '1M': '1개월', '3M': '3개월', '6M': '6개월', '1Y': '1년' };

function callClaudeChartAi_(apiKey, d) {
  const s = d.stats;
  const lines = [
    '- 기간: 최근 ' + (RANGE_KR_[d.range] || d.range),
    '- 현재가: ' + s.close + (d.currency === 'KRW' ? '원' : ''),
    '- 이 기간 수익률: ' + s.periodPct + '%',
    '- 오늘 등락: ' + s.changePct + '%',
    '- 이 종목의 평소 하루 변동폭: ±' + s.avgMove + '% (오늘은 평소의 ' + s.moveRatio + '배)',
    '- 오늘 거래량: 평소의 ' + s.volRatio + '배',
    '- 최근 ' + s.recentDays + '거래일: 오른 날 ' + s.upDays + ', 내린 날 ' + s.downDays,
    '- 20일 평균 대비: ' + s.vsMa20 + '%',
    '- 최근 1년 최저~최고 중 현재 위치: ' + s.pos52 + '/100'
  ];
  if (d.bench) {
    lines.push('- 같은 기간 ' + d.bench.name + ': ' + d.bench.periodPct + '%');
  }

  const evs = (d.events || []).filter(function (e) { return e.kind !== 'earnings'; }).slice(-5);
  const evText = evs.map(function (e) {
    return '  ' + e.date + ' ' + (e.pct > 0 ? '+' : '') + e.pct + '% (평소의 ' + e.ratio + '배)';
  }).join('\n');
  const earn = (d.events || []).filter(function (e) { return e.kind === 'earnings'; });

  const prompt =
    '[' + d.name + ' 차트 요약]\n' + lines.join('\n') + '\n\n' +
    (evText ? '[평소보다 크게 움직인 날]\n' + evText + '\n\n' : '') +
    (earn.length ? '[이 기간 실적 발표일] ' + earn.map(function (e) { return e.date; }).join(', ') + '\n\n' : '') +
    'summary에는 이 기간 흐름을 초보자에게 2~3문장으로 설명해줘.\n' +
    'vsMarket에는 같은 기간 지수와 비교해 어땠는지 써줘. ' +
    '지수보다 더 오르거나 덜 내렸으면 그 사실을, 반대면 그 사실을 담담하게. ' +
    '지수 정보가 없으면 빈 문자열.\n' +
    'watch에는 이 차트를 볼 때 초보자가 오해하기 쉬운 점을 알려줘.\n\n' +
    '⚠️ 반드시 지킬 것:\n' +
    '- **앞으로 어떻게 될지 절대 쓰지 마.** "반등이 예상된다", "지지선을 지켰다", ' +
    '"추세가 이어질 것" 같은 표현 전부 금지다. 지나간 일만 설명해.\n' +
    '- 매수/매도 추천, 목표가, "지금이 기회" 금지.\n' +
    '- 주어진 수치만 쓰고 없는 숫자를 지어내지 마. 뉴스나 사건 내용을 아는 척하지 마 ' +
    '(날짜와 등락률만 주어졌을 뿐 이유는 모른다).\n' +
    '- "저평가", "싸다", "비싸다" 같은 가치 판단 단어를 쓰지 마.\n' +
    '- 골든크로스·데드크로스 같은 용어를 신호처럼 쓰지 마. 초보자는 그걸 매매 지시로 읽는다.\n' +
    '- 어려운 말을 쓰면 괄호로 짧게 풀어줘.';

  let res;
  try {
    res = UrlFetchApp.fetch(ANTHROPIC_URL_, {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      payload: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 1500,
        output_config: { format: { type: 'json_schema', schema: CHART_AI_SCHEMA_ } },
        system: '너는 초보 투자자에게 주가 차트를 쉽게 풀어주는 도우미야. ' +
          '지나간 움직임만 설명하고, 앞으로의 예측이나 투자 권유는 절대 하지 않는다.',
        messages: [{ role: 'user', content: prompt }]
      })
    });
  } catch (err) {
    console.log('callClaudeChartAi_: 연결 실패 - ' + err);
    return null;
  }
  const code = res.getResponseCode();
  const body = res.getContentText();
  if (code >= 400) { console.log('callClaudeChartAi_: HTTP ' + code + ' - ' + body.slice(0, 300)); return null; }
  const json = JSON.parse(body);
  if (json.stop_reason === 'refusal' || json.stop_reason === 'max_tokens') return null;
  const tb = (json.content || []).filter(function (b) { return b.type === 'text'; })[0];
  if (!tb) return null;
  try { return JSON.parse(tb.text); } catch (err) { return null; }
}

// ================= 15. 특정 날짜의 뉴스 =================
// 차트에서 "이날 왜 움직였나"를 누르면 그날 뉴스를 보여줘야 한다. 그런데 네이버 뉴스 검색에는
// **날짜 범위 파라미터가 없다.** 최신순으로 페이지를 넘기며 과거로 거슬러 갈 수밖에 없다.
// start는 최대 1000까지라 무한정 갈 수 없으므로, 못 닿으면 **솔직히 못 찾았다고 말한다.**

var NEWS_PAGE_SIZE_ = 100;
var NEWS_MAX_PAGES_ = 10;     // 네이버 상한(start 1000)까지 훑는다
var NEWS_START_MAX_ = 1000;   // 네이버 제한

function ymdOf_(pubDate) {
  const t = new Date(pubDate).getTime();
  if (!t) return null;
  return Utilities.formatDate(new Date(t), 'Asia/Seoul', 'yyyy-MM-dd');
}

// targetDate(그리고 그 전날)에 나온 기사만 모은다.
// 전날을 포함하는 이유: 장 마감 후나 새벽에 나온 기사가 다음 날 주가를 움직이는 일이 흔하다.
function searchStockNewsOn_(name, targetDate, query) {
  const headers = {
    'X-Naver-Client-Id': getProp_('NAVER_CLIENT_ID'),
    'X-Naver-Client-Secret': getProp_('NAVER_CLIENT_SECRET')
  };
  const q = query || name;
  const from = shiftDate_(targetDate, -1);
  const out = [];
  const seen = {};
  var reached = false;   // 목표 날짜까지 실제로 거슬러 갔는지
  var oldest = null;

  for (var page = 0; page < NEWS_MAX_PAGES_; page++) {
    const start = page * NEWS_PAGE_SIZE_ + 1;
    if (start > NEWS_START_MAX_) break;
    var items;
    try {
      const res = UrlFetchApp.fetch(
        'https://openapi.naver.com/v1/search/news.json?query=' + encodeURIComponent(q) +
        '&display=' + NEWS_PAGE_SIZE_ + '&start=' + start + '&sort=date',
        { headers: headers, muteHttpExceptions: true });
      if (res.getResponseCode() >= 400) break;
      items = JSON.parse(res.getContentText()).items || [];
    } catch (err) {
      break;
    }
    if (!items.length) break;

    items.forEach(function (it) {
      const d = ymdOf_(it.pubDate);
      if (!d) return;
      if (!oldest || d < oldest) oldest = d;
      if (d < from || d > targetDate) return;
      if (!it.link || seen[it.link]) return;
      seen[it.link] = true;
      out.push({
        title: stripTags_(it.title),
        description: stripTags_(it.description),
        link: it.link,
        pubDate: it.pubDate,
        date: d
      });
    });

    // 이번 페이지의 가장 오래된 기사가 이미 목표 구간보다 과거면 더 볼 필요가 없다.
    const lastDate = ymdOf_(items[items.length - 1].pubDate);
    if (lastDate && lastDate < from) { reached = true; break; }
  }
  // 검색이 목표 날짜보다 과거까지 닿았으면 "그날 기사가 없다"가 확실하고,
  // 못 닿았으면 "너무 오래돼서 찾을 수 없다"가 맞다. 이 둘은 사용자에게 다른 말이다.
  return { items: out.slice(0, 14), reached: reached || (oldest !== null && oldest <= from), oldest: oldest };
}

// 그날의 등락률. 차트 데이터를 그대로 쓰면 추가 호출이 없다.
function moveOnDate_(symbol, date) {
  const pts = safe_(function () { return getYahooHistory_(symbol, '1y'); });
  if (!pts || !pts.length) return null;
  for (var i = 1; i < pts.length; i++) {
    if (pts[i].date === date) {
      const prev = pts[i - 1].close, cur = pts[i].close;
      if (!prev) return null;
      return { close: cur, changePct: Math.round(((cur - prev) / prev) * 1000) / 10 };
    }
  }
  return null;
}

var EXPLAIN_DAY_CACHE_SEC_ = 21600; // 과거 일은 바뀌지 않으므로 길게 잡는다

function getExplainOn(symbol, name, dateStr, noCache) {
  const sym = String(symbol || '').trim();
  const nm = String(name || '').trim() || sym;
  const date = String(dateStr || '').trim();
  if (!sym || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: '잘못된 요청입니다.' };

  const cacheKey = 'explainday_' + date + '_' + sym.toLowerCase();
  const cached = noCache ? null : cacheGet_(cacheKey);
  if (cached) return cached;

  const key = getProp_('ANTHROPIC_API_KEY');
  if (!key) return { error: 'AI 설명 기능은 ANTHROPIC_API_KEY가 설정돼야 동작합니다.' };

  // 종목명만으로 검색하면 대형주는 하루 수백 건이 쏟아져 600~1000건으로도 며칠을 못 간다
  // (실측: 삼성전자는 1000건이 하루치). "주가"를 붙여 범위를 좁히면 훨씬 멀리 닿고,
  // 어차피 우리가 찾는 건 주가를 움직인 기사라 관련도도 올라간다.
  var found = searchStockNewsOn_(nm, date, nm + ' 주가');
  // 좁힌 검색으로 못 찾았고 아직 그날까지 닿지도 못했으면 종목명만으로 한 번 더 시도한다.
  if (!found.items.length && !found.reached) {
    const wide = searchStockNewsOn_(nm, date);
    if (wide.items.length || wide.reached) found = wide;
  }
  const move = moveOnDate_(sym, date);

  if (!found.items.length) {
    const data = {
      symbol: sym, name: nm, date: date, move: move, explanation: null,
      // 못 찾은 이유를 구분해서 알려준다 — "기사가 없다"와 "너무 오래됐다"는 다르다
      error: found.reached
        ? '"' + nm + '"의 ' + date + ' 기사를 찾지 못했어요. 그날 관련 보도가 없었을 수 있습니다.'
        : '뉴스 검색이 ' + date + '까지 닿지 못했어요.' +
          (found.oldest ? ' "' + nm + '" 기사를 ' + found.oldest + '까지 거슬러 올라갔지만 그보다 과거는 볼 수 없었습니다.' : '')
    };
    cachePut_(cacheKey, data, 3600);
    return data;
  }

  const result = callClaudeExplainOn_(key, nm, date, move, found.items);
  if (!result) return { symbol: sym, name: nm, date: date, move: move, explanation: null,
    error: '설명을 만들지 못했어요. 잠시 후 다시 시도해주세요.' };

  const evidence = (result.evidence || [])
    .map(function (e) {
      const it = found.items[e.id];
      return it ? { title: it.title, link: it.link, pubDate: it.pubDate, note: e.note } : null;
    })
    .filter(Boolean)
    .slice(0, 4);

  const data = {
    symbol: sym, name: nm, date: date, move: move,
    explanation: result.explanation, confidence: result.confidence,
    evidence: evidence, newsCount: found.items.length,
    at: new Date().toISOString()
  };
  cachePut_(cacheKey, data, EXPLAIN_DAY_CACHE_SEC_);
  return data;
}

function callClaudeExplainOn_(apiKey, name, date, move, news) {
  const moved = move
    ? name + '은(는) ' + date + '에 ' + move.changePct + '% ' +
      (move.changePct >= 0 ? '올랐다' : '내렸다') + '(종가 ' + move.close + ').'
    : name + '의 ' + date + ' 등락률은 확인되지 않았다.';

  const lines = news.map(function (n, i) {
    return i + '. [' + n.date + '] ' + n.title + ' — ' + String(n.description || '').slice(0, 100);
  }).join('\n');

  const prompt =
    moved + '\n\n[' + date + ' 전후 ' + name + ' 뉴스]\n' + lines + '\n\n' +
    'explanation에는 **그날** 이 종목이 왜 그렇게 움직였는지 초보 투자자도 이해할 수 있게 ' +
    '2~3문장으로 설명해줘. 지나간 날의 이야기이므로 과거형으로 쓴다.\n' +
    'evidence에는 근거가 된 뉴스 번호를 최대 4개까지 골라줘.\n' +
    '⚠️ 뉴스에 없는 사실을 지어내지 마. 뚜렷한 재료가 없으면 솔직히 밝히고 ' +
    'evidence는 비우고 confidence는 low로 해. 종목명만 겹칠 뿐 주가와 무관한 기사는 쓰지 마.\n' +
    '⚠️ 매수/매도 추천이나 목표가, 앞으로의 전망은 절대 쓰지 마. 그날 무슨 일이 있었는지만 설명해.\n' +
    'flowNote는 빈 문자열로 둬.';

  let res;
  try {
    res = UrlFetchApp.fetch(ANTHROPIC_URL_, {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
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
  } catch (err) { return null; }
  if (res.getResponseCode() >= 400) {
    console.log('callClaudeExplainOn_: HTTP ' + res.getResponseCode());
    return null;
  }
  const json = JSON.parse(res.getContentText());
  if (json.stop_reason === 'refusal' || json.stop_reason === 'max_tokens') return null;
  const tb = (json.content || []).filter(function (b) { return b.type === 'text'; })[0];
  if (!tb) return null;
  try { return JSON.parse(tb.text); } catch (err) { return null; }
}

// ================= 16. 국채 금리 =================
// 국채 금리는 "돈의 값"이다. 오르면 대출·기업 자금조달이 비싸지고 주식에 부담이 된다.
//
// 소스가 나라마다 다르다:
//   미국 — FRED (일별, 만기별로 정확한 시리즈가 있다)
//   한국 — ECOS 817Y002 시장금리 (일별). ECOS는 GAS에서 자주 막히므로 **트리거 전용**이다.
//   일본 — 무료로 일별을 주는 곳이 없다. FRED는 월간(OECD)뿐이라 신선도를 밝히고 쓴다.

var ECOS_RATE_STAT_ = '817Y002';   // 시장금리(일별)

// 항목 코드를 하드코딩하면 ECOS가 코드를 바꿀 때 조용히 틀린 값을 가져온다.
// 응답에 항목명이 같이 오므로 **이름으로 찾는다** — 코드보다 안전하다.
var ECOS_BOND_WANT_ = [
  { key: 'kr3y', label: '국고채 3년', re: /국고채.*3년/ },
  { key: 'kr10y', label: '국고채 10년', re: /국고채.*10년/ }
];

function ecosAllItemsUrl_(key, statCode, from, to) {
  return 'https://ecos.bok.or.kr/api/StatisticSearch/' + key +
    '/json/kr/1/200/' + statCode + '/D/' + from + '/' + to;
}

// 같은 항목이 여러 날짜로 오므로 항목별 **가장 최근 값**만 남긴다.
function parseEcosBonds_(json) {
  const rows = (json.StatisticSearch && json.StatisticSearch.row) || [];
  const latest = {};
  rows.forEach(function (r) {
    const name = String(r.ITEM_NAME1 || '');
    const v = parseFloat(r.DATA_VALUE);
    if (!r.TIME || isNaN(v)) return;
    ECOS_BOND_WANT_.forEach(function (w) {
      if (!w.re.test(name)) return;
      const cur = latest[w.key];
      if (!cur || r.TIME > cur.date) {
        latest[w.key] = { value: v, date: r.TIME, name: name };
      }
    });
  });
  return latest;
}

// 미국 국채. FRED는 만기별 일별 시리즈를 준다.
var FRED_BOND_ = [
  { key: 'us3y', series: 'DGS3', label: '미국 3년' },
  { key: 'us10y', series: 'DGS10', label: '미국 10년' }
];
// 일본은 OECD 월간 자료뿐이다. 일별이 없다는 걸 화면에서 밝힌다.
var FRED_BOND_MONTHLY_ = [
  { key: 'jp10y', series: 'IRLTLT01JPM156N', label: '일본 10년' }
];

function bondJobs_(fredKey) {
  if (!fredKey) return [];
  return FRED_BOND_.concat(FRED_BOND_MONTHLY_).map(function (b) {
    return { name: b.key, url: fredSeriesUrl_(b.series, fredKey), parse: parseFred_ };
  });
}

// 장단기 금리차. 10년물이 3년물보다 낮아지는 '역전'은 경기 침체 신호로 자주 인용된다.
// ⚠️ 다만 이건 **관찰이지 예언이 아니다.** 화면 문구에서 단정하지 않는다.
function yieldSpread_(short, long) {
  if (!short || !long || short.error || long.error) return null;
  if (short.value === null || long.value === null) return null;
  return Math.round((long.value - short.value) * 100) / 100;
}
