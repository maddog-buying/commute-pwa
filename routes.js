// 路線定義與分析邏輯。src：nfb=高公局路段、vd=高公局偵測器、tpe=臺北市路段、est=無即時資料
// est:[離峰, 尖峰] 是估算車速，即時資料缺漏時也會用它；delay 是路口號誌的秒數，車速資料算不到

const ORIGIN = '25.0096,121.6452'; // 石碇服務區
const DESTINATION = '台北市中山區樂群三路128號'; // 國票金控

const cam = (label, host, id) => ({ label, url: `https://${host}.freeway.gov.tw/abs2mjpg/bmjpg?camera=${id}` });

const CAMS = {
  n3_204: cam('國三 20.4K 木柵上來', 'cctvn', '32040'),
  n3_198: cam('國三 19.9K', 'cctvn', '81981'),
  n3_180: cam('國三 18.0K', 'cctvn', '31800'),
  n3_170: cam('國三 17.1K', 'cctvn', '31700'),
  n3_163: cam('國三 16.4K 南深路', 'cctvn', '31630'),
  n3_159: cam('國三 15.9K 南港系統匝道', 'cctvn', '31590'),
  n3_154: cam('國三 15.4K', 'cctvn', '31540'),
  n3_148: cam('國三 14.8K 南港出口', 'cctvn', '31480'),
  nn_00: cam('南港聯絡道起點', 'cctvn', '31472'),
  nn_08: cam('南港聯絡道 接環東', 'cctvn', '31471'),
};

const TO_LINK_ROAD = [
  { name: '國三 南港系統→南港', km: 1.2, src: 'nfb', id: '0190', free: 85, est: [85, 50] },
  { name: '南港聯絡道', km: 1.4, src: 'vd', id: 'VD-N3N-N-0.700-M-LOOP', free: 60, est: [55, 35] },
];
const RING_FRONT = { name: '環東 聯絡道→南港', group: '環東大道', km: 0.33, src: 'tpe', id: 'Z6310G0', free: 70, est: [70, 45] };
// 臺北市資料有時只提供 Z6330G5（名稱寫出城，但座標是進城方向的同一段）
const RING_MAIN = { name: '環東 彩虹橋段', group: '環東大道', km: 3.25, src: 'tpe', id: 'Z6330G0', altId: 'Z6330G5', free: 70, est: [70, 45] };
const TAIL = [
  { name: '環東下堤頂匝道', group: '堤頂大道→國票金控', km: 0.9, src: 'est', free: 35, est: [35, 25], delay: 30 },
  { name: '堤頂大道 舊宗路→港墘路', group: '堤頂大道→國票金控', km: 1.4, src: 'tpe', id: 'ZRPSV00', free: 50, est: [45, 30], delay: 60 },
  { name: '堤頂大道 港墘路→樂群一路', group: '堤頂大道→國票金控', km: 0.35, src: 'tpe', id: 'ZSGRX60', free: 50, est: [45, 30] },
  { name: '堤頂大道 樂群一路→基湖路', group: '堤頂大道→國票金控', km: 0.5, src: 'tpe', id: 'ZSPRA60', free: 50, est: [45, 30], delay: 30 },
  { name: '堤頂大道 基湖路→樂群二路', group: '堤頂大道→國票金控', km: 0.5, src: 'tpe', id: 'ZT5QV00', free: 50, est: [45, 30], delay: 30 },
  { name: '樂群路→國票金控', group: '堤頂大道→國票金控', km: 0.4, src: 'est', free: 25, est: [25, 18], delay: 60 },
];

const ROUTES = [
  {
    id: 1,
    name: '國五直上',
    via: '國五 → 國三 → 環東 → 堤頂',
    waypoints: ['25.0447,121.6258', '25.0533,121.6209'],
    segments: [
      { name: '服務區→石碇上匝道', km: 0.65, src: 'est', free: 30, est: [30, 20] },
      { name: '國五 石碇→南港系統', km: 4.0, src: 'nfb', id: '0366', free: 80, est: [80, 45] },
      { name: '南港系統匝道（國五接國三）', km: 0.4, src: 'vd', id: 'VD-N3-N-16-I-EN-南港系統-5N3N', free: 60, est: [50, 30] },
      ...TO_LINK_ROAD, RING_FRONT, RING_MAIN, ...TAIL,
    ],
    cams: ['n3_159', 'n3_154', 'n3_148', 'nn_00', 'nn_08'],
    camNote: '國五的鏡頭只開放在 1968 官網觀看，無法在這裡播放。',
    camLink: { label: '到 1968 看國五監視器', url: 'https://1968.freeway.gov.tw/roadcctv' },
    zones: [{ road: '國道五號', dir: '北向', from: 0, to: 4.5 }, { road: '國道三號', dir: '北向', from: 14.5, to: 16.5 }, { road: '南港聯絡道' }],
  },
  {
    id: 2,
    name: '深坑上國三',
    via: '文山路 → 深坑 → 木柵上國三 → 環東 → 堤頂',
    waypoints: ['25.0053,121.5960', '25.0533,121.6209'],
    segments: [
      { name: '文山路→北深路→木柵上匝道', km: 6.0, src: 'est', free: 40, est: [40, 28], delay: 60 },
      { name: '國三 木柵→南深路', km: 4.3, src: 'nfb', id: '0194', free: 85, est: [85, 50] },
      { name: '國三 南深路→南港系統', km: 0.2, src: 'nfb', id: '0192', free: 85, est: [85, 50] },
      ...TO_LINK_ROAD, RING_FRONT, RING_MAIN, ...TAIL,
    ],
    cams: ['n3_204', 'n3_198', 'n3_180', 'n3_170', 'n3_163', 'n3_154', 'n3_148', 'nn_00', 'nn_08'],
    zones: [{ road: '國道三號', dir: '北向', from: 14.5, to: 21 }, { road: '南港聯絡道' }],
  },
  {
    id: 3,
    name: '南深路',
    via: '文山路 → 深坑 → 南深路 → 南港軟體園區 → 環東 → 堤頂',
    waypoints: ['25.0268,121.6237', '25.0469,121.6154', '25.0629,121.6168'],
    segments: [
      { name: '文山路→北深路→深南路', km: 4.9, src: 'est', free: 40, est: [40, 30], delay: 30 },
      { name: '南深路（山路）', km: 3.6, src: 'est', free: 30, est: [30, 22] },
      { name: '舊莊街→研究院路二段', km: 1.3, src: 'tpe', id: 'ZHX4E40', free: 40, est: [35, 22], delay: 45 },
      { name: '研究院路一段', km: 0.9, src: 'tpe', id: 'ZKP4L00', free: 40, est: [35, 22], delay: 45 },
      { name: '經貿二路→環東入口', km: 0.9, src: 'est', free: 30, est: [30, 18], delay: 60 },
      RING_MAIN, ...TAIL,
    ],
    cams: ['nn_08'],
    camNote: '南深路與環東沒有公開影像，這裡只有接環東附近的聯絡道鏡頭。',
    zones: [],
  },
];

// 平日上下班尖峰（用來選估算車速）
function isPeak(date) {
  const day = date.getDay();
  if (day === 0 || day === 6) return false;
  const m = date.getHours() * 60 + date.getMinutes();
  return (m >= 420 && m < 570) || (m >= 1020 && m < 1170);
}

const STALE_MINUTES = 30;

// 來源的更新時間超過門檻就不採用；臺北市格式是 2026/11/04T22:28:02（臺北時間）
function staleFeeds(data, now) {
  return ['nfb', 'vd', 'tpe'].filter((name) => {
    const text = (data.updated || {})[name];
    if (!text) return false;
    const at = new Date(/[+Z]/.test(text) ? text : `${text.replace(/\//g, '-')}+08:00`);
    return !isNaN(at) && now - at > STALE_MINUTES * 60000;
  });
}

function liveReading(seg, data, stale) {
  if (seg.src === 'est' || stale.includes(seg.src)) return null;
  const feed = data[seg.src] || {};
  return [seg.id, seg.altId].map((id) => feed[id]).find((r) => r && r.speed > 0) || null;
}

function evaluateSegment(seg, data, peak, stale) {
  const live = liveReading(seg, data, stale);
  const estSpeed = seg.est[peak ? 1 : 0];
  let seconds;
  let speed;
  if (live) {
    speed = Math.max(live.speed, 5);
    seconds = seg.src === 'nfb' && live.time > 0 ? live.time : (seg.km / speed) * 3600;
  } else {
    speed = estSpeed;
    seconds = (seg.km / speed) * 3600;
  }
  const ratio = speed / seg.free;
  const level = !live ? 'est' : ratio >= 0.75 ? 'good' : ratio >= 0.5 ? 'slow' : 'jam';
  return {
    ...seg,
    speed: Math.round(speed),
    live: !!live,
    seconds: seconds + (seg.delay || 0),
    level,
    missing: seg.src !== 'est' && !live,
  };
}

// 把細分路段併成畫面上的一列；車速是行駛中的平均，不含號誌秒數
function groupRows(segs) {
  const rows = [];
  segs.forEach((s) => {
    const last = rows[rows.length - 1];
    if (s.group && last && last.group === s.group) {
      last.parts.push(s);
    } else {
      rows.push({ group: s.group, parts: [s] });
    }
  });
  const rank = { est: 0, good: 1, slow: 2, jam: 3 };
  return rows.map((r) => {
    const km = r.parts.reduce((a, p) => a + p.km, 0);
    const seconds = r.parts.reduce((a, p) => a + p.seconds, 0);
    const moving = r.parts.reduce((a, p) => a + (p.km / p.speed) * 3600, 0);
    const liveKm = r.parts.filter((p) => p.live).reduce((a, p) => a + p.km, 0);
    return {
      name: r.group || r.parts[0].name,
      km,
      seconds,
      speed: Math.round(km / (moving / 3600)),
      level: r.parts.reduce((w, p) => (rank[p.level] > rank[w] ? p.level : w), 'est'),
      source: liveKm === 0 ? 'est' : liveKm >= km - 0.01 ? 'live' : 'mixed',
      missing: r.parts.some((p) => p.missing),
    };
  });
}

function kmOf(text) {
  const m = /(\d+)K\+(\d+)/.exec(text || '');
  return m ? Number(m[1]) + Number(m[2]) / 1000 : null;
}

function eventsFor(route, events) {
  return (events || []).filter((ev) => route.zones.some((z) => {
    if (z.road !== ev.road) return false;
    if (!z.dir) return true;
    if (ev.direction !== z.dir && ev.direction !== '雙向') return false;
    const a = kmOf(ev.startKm);
    const b = kmOf(ev.endKm);
    if (a === null) return false;
    const lo = Math.min(a, b === null ? a : b);
    const hi = Math.max(a, b === null ? a : b);
    return lo <= z.to && hi >= z.from;
  }));
}

function analyze(data, now) {
  const peak = isPeak(now);
  const stale = staleFeeds(data, now);
  const routes = ROUTES.map((route) => {
    const segs = route.segments.map((s) => evaluateSegment(s, data, peak, stale));
    const seconds = segs.reduce((a, s) => a + s.seconds, 0);
    const liveSeconds = segs.filter((s) => s.live).reduce((a, s) => a + s.seconds, 0);
    const worst = segs.filter((s) => s.level === 'jam' || s.level === 'slow')
      .sort((a, b) => a.speed / a.free - b.speed / b.free)[0] || null;
    return {
      ...route,
      segs,
      rows: groupRows(segs),
      seconds,
      minutes: Math.round(seconds / 60),
      km: segs.reduce((a, s) => a + s.km, 0),
      liveShare: seconds ? liveSeconds / seconds : 0,
      worst,
      events: eventsFor(route, data.events),
      arrive: new Date(now.getTime() + seconds * 1000),
    };
  });
  const ranked = [...routes].sort((a, b) => a.seconds - b.seconds);
  const winner = ranked[0];
  const baseline = routes.find((r) => r.id === 1);
  return {
    peak,
    stale,
    routes: ranked,
    winner,
    saved: Math.round((baseline.seconds - winner.seconds) / 60),
    margin: ranked[1].seconds - winner.seconds,
  };
}

function apiQuery() {
  const ids = { nfb: new Set(), vd: new Set(), tpe: new Set() };
  ROUTES.forEach((r) => r.segments.forEach((s) => {
    if (!ids[s.src]) return;
    ids[s.src].add(s.id);
    if (s.altId) ids[s.src].add(s.altId);
  }));
  return Object.keys(ids).map((k) => `${k}=${encodeURIComponent([...ids[k]].join(','))}`).join('&');
}

function mapsUrl(route) {
  const q = new URLSearchParams({
    api: '1',
    origin: ORIGIN,
    destination: DESTINATION,
    waypoints: route.waypoints.join('|'),
    travelmode: 'driving',
  });
  return `https://www.google.com/maps/dir/?${q}`;
}
