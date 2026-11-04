// 上班路線分析的資料中繼：開放資料不允許網頁跨網域讀取，由這支 Apps Script 代抓。
// 部署：網頁應用程式、存取權「所有人」。
// 國道資料走 TDX，因為 Google 的主機連不上高公局的 tisvcloud。
// 金鑰放在「專案設定 → 指令碼屬性」：TDX_CLIENT_ID、TDX_CLIENT_SECRET，不要寫進程式碼。
// 路段固定寫在這裡、回應整份快取，所以公開網址不會被人用來消耗金鑰額度。

const TDX_API = 'https://tdx.transportdata.tw/api/basic/';
const TDX_SECTIONS = 'v2/Road/Traffic/Live/Freeway';
const TDX_VD = 'v2/Road/Traffic/Live/VD/Freeway';
const TDX_EVENTS = 'v1/Traffic/RoadEvent/LiveEvent/Freeway';
const TDX_TOKEN = 'https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token';
const TAIPEI_VD = 'https://tcgbusfs.blob.core.windows.net/blobtisv/GetVD.xml.gz'; // 未壓縮的 GetVD.xml 停在 2024 年，不能用

const NFB_IDS = ['0366', '0190', '0194', '0192'];
const VD_IDS = ['VD-N3-N-16-I-EN-南港系統-5N3N', 'VD-N3N-N-0.700-M-LOOP'];
const TPE_IDS = ['Z6310G0', 'Z6330G0', 'Z6330G5', 'ZRPSV00', 'ZSGRX60', 'ZSPRA60', 'ZT5QV00', 'ZHX4E40', 'ZKP4L00'];
const EVENT_ROADS = ['國道五號', '國道三號', '南港聯絡道'];
const DIRECTIONS = ['東向', '西向', '南向', '北向', '雙向']; // TDX 的方向是代碼

const CACHE_SECONDS = 55; // 來源每分鐘更新
const TOKEN_CACHE_SECONDS = 21600; // CacheService 上限 6 小時，token 本身效期一天
const DIAG_CACHE_SECONDS = 300;

function doGet(e) {
  const diag = e && e.parameter && e.parameter.diag;
  const key = diag ? 'diag' : 'result';
  const cache = CacheService.getScriptCache();
  let body = cache.get(key);
  if (!body) {
    body = JSON.stringify(diag ? diagnose() : collect());
    if (body.length < 100000) cache.put(key, body, diag ? DIAG_CACHE_SECONDS : CACHE_SECONDS);
  }
  return ContentService.createTextOutput(body).setMimeType(ContentService.MimeType.JSON);
}

function collect() {
  const out = { fetchedAt: new Date().toISOString(), nfb: {}, vd: {}, tpe: {}, events: [], updated: {}, errors: [] };
  const attempt = function (name, fn) {
    try { fn(); } catch (err) { out.errors.push(name + ': ' + err.message); }
  };

  attempt('nfb', function () {
    const json = tdxJson(TDX_SECTIONS, idFilter('SectionID', NFB_IDS));
    out.updated.nfb = json.UpdateTime || '';
    (json.LiveTraffics || []).forEach(function (s) {
      out.nfb[s.SectionID] = { speed: Number(s.TravelSpeed), time: Number(s.TravelTime) };
    });
  });
  attempt('vd', function () {
    const json = tdxJson(TDX_VD, idFilter('VDID', VD_IDS));
    out.updated.vd = json.UpdateTime || '';
    (json.VDLives || []).forEach(function (v) { out.vd[v.VDID] = vdSpeed(v); });
  });
  // 事件只是提醒，不影響時間計算，讀不到不算錯誤
  try { out.events = fetchEvents(); } catch (err) { out.eventsError = err.message; }
  attempt('tpe', function () {
    const res = UrlFetchApp.fetch(TAIPEI_VD, { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) throw new Error('HTTP ' + res.getResponseCode());
    const xml = xmlText(res);
    out.updated.tpe = tag(xml, 'vd:ExchangeTime');
    TPE_IDS.forEach(function (id) { out.tpe[id] = parseTaipeiSection(xml, id); });
  });
  return out;
}

// ?diag=1：確認金鑰與 TDX 路徑是否可用。只回傳狀態與欄位名稱，不含金鑰或 token
function diagnose() {
  const report = { token: 'ok', paths: {} };
  try {
    getToken();
  } catch (err) {
    report.token = err.message;
    return report;
  }
  [TDX_SECTIONS, TDX_VD, TDX_EVENTS].forEach(function (path) {
    const res = tdxFetch(path, '$top=1');
    const entry = { status: res.getResponseCode() };
    if (entry.status === 200) {
      const json = JSON.parse(res.getContentText('UTF-8'));
      entry.keys = Object.keys(json);
      const list = entry.keys.map(function (k) { return json[k]; }).filter(Array.isArray)[0];
      if (list && list[0]) entry.itemKeys = Object.keys(list[0]);
    }
    report.paths[path] = entry;
  });
  // 事件的原始路名與方向，用來確認 normalizeRoad 與 DIRECTIONS 符合實際資料
  const events = tdxJson(TDX_EVENTS, '$top=500').LiveEvents || [];
  report.eventCount = events.length;
  report.eventRoads = {};
  events.forEach(function (ev) {
    const loc = (ev.Location && ev.Location.FreeExpressHighway) || {};
    const key = loc.Road + ' / ' + loc.Direction + ' → ' + normalizeRoad(loc.Road) + ' / ' + directionText(loc.Direction);
    report.eventRoads[key] = (report.eventRoads[key] || 0) + 1;
  });
  return report;
}

function getToken() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get('tdxToken');
  if (cached) return cached;
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('TDX_CLIENT_ID');
  const secret = props.getProperty('TDX_CLIENT_SECRET');
  if (!id || !secret) throw new Error('指令碼屬性沒有設定 TDX 金鑰');
  const res = UrlFetchApp.fetch(TDX_TOKEN, {
    method: 'post',
    payload: { grant_type: 'client_credentials', client_id: id, client_secret: secret },
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() !== 200) throw new Error('TDX 金鑰驗證失敗 HTTP ' + res.getResponseCode());
  const token = JSON.parse(res.getContentText('UTF-8')).access_token;
  cache.put('tdxToken', token, TOKEN_CACHE_SECONDS);
  return token;
}

function tdxFetch(path, query) {
  return UrlFetchApp.fetch(TDX_API + path + '?$format=JSON&' + query, {
    headers: { Authorization: 'Bearer ' + getToken() },
    muteHttpExceptions: true,
  });
}

function tdxJson(path, query) {
  const res = tdxFetch(path, query);
  if (res.getResponseCode() !== 200) throw new Error('TDX ' + path + ' HTTP ' + res.getResponseCode());
  return JSON.parse(res.getContentText('UTF-8'));
}

function idFilter(field, ids) {
  const clause = ids.map(function (id) { return field + " eq '" + id + "'"; }).join(' or ');
  return '$filter=' + encodeURIComponent(clause);
}

// 各車道速率以車流量加權；沒有車流時回傳 null，由前端改用估算
function vdSpeed(vd) {
  let sum = 0, weight = 0;
  (vd.LinkFlows || []).forEach(function (flow) {
    (flow.Lanes || []).forEach(function (lane) {
      const volume = (lane.Vehicles || []).reduce(function (a, v) { return a + Math.max(0, Number(v.Volume) || 0); }, 0);
      if (lane.Speed > 0 && volume > 0) { sum += lane.Speed * volume; weight += volume; }
    });
  });
  return { speed: weight ? Math.round(sum / weight) : null, volume: weight };
}

function fetchEvents() {
  return (tdxJson(TDX_EVENTS, '$top=500').LiveEvents || []).map(function (ev) {
    const loc = (ev.Location && ev.Location.FreeExpressHighway) || {};
    return {
      title: ev.EventTitle || '',
      description: ev.Description || '',
      road: normalizeRoad(loc.Road),
      direction: directionText(loc.Direction),
      startKm: loc.StartKM || '',
      endKm: loc.EndKM || '',
      severity: (ev.Impact && Number(ev.Impact.Severity)) || 0,
    };
  }).filter(function (ev) { return EVENT_ROADS.indexOf(ev.road) >= 0; });
}

// 路名可能寫成國道5號或國道五號；國道三甲是另一條路
function normalizeRoad(name) {
  const s = String(name || '');
  if (s.indexOf('南港聯絡') >= 0) return '南港聯絡道';
  if (/國道\s*(5|五)號/.test(s)) return '國道五號';
  if (/國道\s*(3|三)號(?!甲)/.test(s)) return '國道三號';
  return s;
}

function directionText(value) {
  return typeof value === 'number' ? (DIRECTIONS[value] || '') : String(value || '');
}

function xmlText(res) {
  const bytes = res.getContent();
  const gzipped = bytes.length > 2 && (bytes[0] & 0xff) === 0x1f && (bytes[1] & 0xff) === 0x8b;
  if (!gzipped) return res.getContentText('UTF-8');
  return Utilities.ungzip(res.getBlob().setContentType('application/x-gzip')).getDataAsString('UTF-8');
}

function tag(xml, name) {
  const open = '<' + name + '>';
  const a = xml.indexOf(open);
  if (a < 0) return '';
  const b = xml.indexOf('</' + name + '>', a);
  return b < 0 ? '' : xml.slice(a + open.length, b).trim();
}

function parseTaipeiSection(xml, id) {
  const a = xml.indexOf('<vd:SectionId>' + id + '</vd:SectionId>');
  if (a < 0) return null;
  const b = xml.slice(a, xml.indexOf('</vd:SectionData>', a));
  return { speed: Number(tag(b, 'vd:AvgSpd')), occ: Number(tag(b, 'vd:AvgOcc')) };
}
