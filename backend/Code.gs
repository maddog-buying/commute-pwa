// 上班路線分析的資料中繼：高公局與臺北市的開放資料沒有 CORS，網頁無法直接讀取，
// 由這支 Apps Script 代抓後只回傳前端要的路段。部署：網頁應用程式、存取權「所有人」。
// 查詢參數：nfb=路段ID,... vd=VDID,... tpe=路段ID,...（逗號分隔）

const FEEDS = {
  nfb: 'https://tisvcloud.freeway.gov.tw/history/motc20/LiveTraffic.xml',
  vd: 'https://tisvcloud.freeway.gov.tw/history/motc20/VDLive.xml',
  events: 'https://tisvcloud.freeway.gov.tw/history/motc20/LiveEvents.xml',
  tpe: 'https://tcgbusfs.blob.core.windows.net/blobtisv/GetVD.xml.gz', // 未壓縮的 GetVD.xml 停在 2024 年，不能用
};
const EVENT_ROADS = ['國道五號', '國道三號', '南港聯絡道'];
const CACHE_SECONDS = 55; // 來源每分鐘更新

function doGet(e) {
  const params = (e && e.parameter) || {};
  const cacheKey = 'r:' + Utilities.base64Encode(
    Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, JSON.stringify(params)));
  const cache = CacheService.getScriptCache();
  let body = cache.get(cacheKey);
  if (!body) {
    body = JSON.stringify(collect(params));
    if (body.length < 100000) cache.put(cacheKey, body, CACHE_SECONDS);
  }
  return ContentService.createTextOutput(body).setMimeType(ContentService.MimeType.JSON);
}

function collect(params) {
  const out = { fetchedAt: new Date().toISOString(), nfb: {}, vd: {}, tpe: {}, events: [], updated: {}, errors: [] };

  // 逐一讀取：fetchAll 只要一個來源連線失敗就會整批丟例外
  Object.keys(FEEDS).forEach(function (name) {
    try {
      const res = UrlFetchApp.fetch(FEEDS[name], { muteHttpExceptions: true, followRedirects: true });
      if (res.getResponseCode() !== 200) throw new Error('HTTP ' + res.getResponseCode());
      const xml = xmlText(res);
      if (name === 'nfb') {
        out.updated.nfb = tag(xml, 'UpdateTime');
        idList(params.nfb).forEach(function (id) { out.nfb[id] = parseNfbSection(xml, id); });
      } else if (name === 'vd') {
        out.updated.vd = tag(xml, 'UpdateTime');
        idList(params.vd).forEach(function (id) { out.vd[id] = parseVd(xml, id); });
      } else if (name === 'events') {
        out.updated.events = tag(xml, 'UpdateTime');
        out.events = parseEvents(xml);
      } else {
        out.updated.tpe = tag(xml, 'vd:ExchangeTime');
        idList(params.tpe).forEach(function (id) { out.tpe[id] = parseTaipeiSection(xml, id); });
      }
    } catch (err) {
      out.errors.push(name + ': ' + err.message);
    }
  });
  return out;
}

function xmlText(res) {
  const bytes = res.getContent();
  const gzipped = bytes.length > 2 && (bytes[0] & 0xff) === 0x1f && (bytes[1] & 0xff) === 0x8b;
  if (!gzipped) return res.getContentText('UTF-8');
  return Utilities.ungzip(res.getBlob().setContentType('application/x-gzip')).getDataAsString('UTF-8');
}

function idList(s) {
  return String(s || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean);
}

function tag(xml, name) {
  const open = '<' + name + '>';
  const a = xml.indexOf(open);
  if (a < 0) return '';
  const b = xml.indexOf('</' + name + '>', a);
  return b < 0 ? '' : xml.slice(a + open.length, b).trim();
}

// 從整份 XML 切出 ID 所在的那一筆，避免把數 MB 的檔案全部解析
function block(xml, idTag, id, closeTag) {
  const a = xml.indexOf('<' + idTag + '>' + id + '</' + idTag + '>');
  if (a < 0) return '';
  const b = xml.indexOf('</' + closeTag + '>', a);
  return b < 0 ? '' : xml.slice(a, b);
}

function parseNfbSection(xml, id) {
  const b = block(xml, 'SectionID', id, 'LiveTraffic');
  if (!b) return null;
  return { speed: Number(tag(b, 'TravelSpeed')), time: Number(tag(b, 'TravelTime')) };
}

function parseTaipeiSection(xml, id) {
  const b = block(xml, 'vd:SectionId', id, 'vd:SectionData');
  if (!b) return null;
  return { speed: Number(tag(b, 'vd:AvgSpd')), occ: Number(tag(b, 'vd:AvgOcc')) };
}

// 各車道速率以車流量加權；沒有車流時回傳 null，由前端改用估算
function parseVd(xml, id) {
  const b = block(xml, 'VDID', id, 'VDLive');
  if (!b) return null;
  let sum = 0, weight = 0;
  b.split('<Lane>').slice(1).forEach(function (lane) {
    const head = lane.split('<Vehicles>')[0];
    const speed = Number(tag(head, 'Speed'));
    let volume = 0;
    lane.split('<Vehicle>').slice(1).forEach(function (v) { volume += Math.max(0, Number(tag(v, 'Volume')) || 0); });
    if (speed > 0 && volume > 0) { sum += speed * volume; weight += volume; }
  });
  return { speed: weight ? Math.round(sum / weight) : null, volume: weight };
}

function parseEvents(xml) {
  return xml.split('<LiveEvent>').slice(1).map(function (b) {
    return {
      title: tag(b, 'EventTitle'),
      description: tag(b, 'Description'),
      road: tag(b, 'Road'),
      direction: tag(b, 'Direction'),
      startKm: tag(b, 'StartKM'),
      endKm: tag(b, 'EndKM'),
      severity: Number(tag(b, 'Severity')) || 0,
      effective: tag(b, 'EffectiveTime'),
    };
  }).filter(function (ev) { return EVENT_ROADS.indexOf(ev.road) >= 0; });
}
