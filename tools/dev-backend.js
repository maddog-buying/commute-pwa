// ?dev：在瀏覽器裡執行真正的 backend/Code.gs，把 Apps Script 服務換成本機替身。
// TDX 回應是用高公局 XML 的即時數值組出來的，欄位形狀是依 TDX 標準推定，實際回應要用 ?diag=1 確認
function getXml(name) {
  const xhr = new XMLHttpRequest();
  xhr.open('GET', `/feed/${name}`, false);
  xhr.send();
  return xhr.responseText;
}

function xmlDoc(name) {
  return new DOMParser().parseFromString(getXml(name), 'application/xml');
}

const text = (el, tagName) => (el.getElementsByTagName(tagName)[0] || {}).textContent;

function requestedIds(url) {
  return [...decodeURIComponent(url).matchAll(/eq '([^']+)'/g)].map((m) => m[1]);
}

function fakeTdx(url) {
  const ids = requestedIds(url);
  if (url.includes('Live/VD/Freeway')) {
    const doc = xmlDoc('vd');
    const VDLives = [...doc.getElementsByTagName('VDLive')].filter((v) => ids.includes(text(v, 'VDID'))).map((v) => ({
      VDID: text(v, 'VDID'),
      LinkFlows: [{
        Lanes: [...v.getElementsByTagName('Lane')].map((lane) => ({
          Speed: Number(text(lane, 'Speed')),
          Vehicles: [...lane.getElementsByTagName('Vehicle')].map((x) => ({ Volume: Number(text(x, 'Volume')) })),
        })),
      }],
    }));
    return { UpdateTime: text(doc, 'UpdateTime'), VDLives };
  }
  if (url.includes('Live/Freeway')) {
    const doc = xmlDoc('nfb');
    const LiveTraffics = [...doc.getElementsByTagName('LiveTraffic')].filter((s) => ids.includes(text(s, 'SectionID'))).map((s) => ({
      SectionID: text(s, 'SectionID'),
      TravelSpeed: Number(text(s, 'TravelSpeed')),
      TravelTime: Number(text(s, 'TravelTime')),
    }));
    return { UpdateTime: text(doc, 'UpdateTime'), LiveTraffics };
  }
  const doc = xmlDoc('events');
  return {
    LiveEvents: [...doc.getElementsByTagName('LiveEvent')].map((ev) => ({
      EventTitle: text(ev, 'EventTitle'),
      Description: text(ev, 'Description'),
      Location: { FreeExpressHighway: { Road: text(ev, 'Road'), Direction: text(ev, 'Direction'), StartKM: text(ev, 'StartKM'), EndKM: text(ev, 'EndKM') } },
      Impact: { Severity: Number(text(ev, 'Severity')) },
    })),
  };
}

window.UrlFetchApp = {
  fetch(url) {
    if (url.includes('/token')) return { getResponseCode: () => 200, getContentText: () => '{"access_token":"dev"}' };
    if (url.includes('tcgbusfs')) {
      const body = getXml('tpe');
      return { getResponseCode: () => 200, getContent: () => [], getContentText: () => body };
    }
    const body = JSON.stringify(fakeTdx(url));
    return { getResponseCode: () => 200, getContentText: () => body };
  },
};
window.PropertiesService = { getScriptProperties: () => ({ getProperty: () => 'dev' }) };
const devCache = new Map();
window.CacheService = { getScriptCache: () => ({ get: (k) => devCache.get(k) || null, put: (k, v) => devCache.set(k, v) }) };

window.devCollect = async function devCollect() {
  const src = await (await fetch('backend/Code.gs')).text();
  return (0, eval)(`(function(){${src}; return collect;})()`)();
};
