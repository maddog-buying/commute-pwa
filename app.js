const params = new URLSearchParams(location.search);
const DEMO = params.has('demo');
const DEV = params.has('dev');

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hhmm = (d) => d.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false });
const FEED_TEXT = { nfb: '國道路段資料', vd: '國道偵測器資料', tpe: '臺北市路段資料' };
const SOURCE_TEXT = { live: '即時', mixed: '部分即時', est: '估算' };

async function fetchData() {
  if (DEMO) return window.DEMO_DATA;
  if (DEV) return window.devCollect();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45000);
  try {
    const res = await fetch(`${window.COMMUTE_API}?${apiQuery()}`, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

const REFRESH_MS = 60000; // TDX 基礎會員約每分鐘 5 次，每次分析用 3 次
const RERENDER_MS = 15000; // 位置變化時重算的間隔；太頻繁會打斷畫面上的點按
const SWITCH_MARGIN_S = 60; // 新路線要快這麼多才換推薦，避免來回跳
const MAX_RUN_MS = 2 * 60 * 60000; // 忘記關時自動停止，保護金鑰額度

const live = {
  running: false,
  timer: null,
  watchId: null,
  wakeLock: null,
  startedAt: 0,
  tracker: null,
  data: null,
  fetching: false,
  lastFetchAt: 0,
  lastRenderAt: 0,
  dirty: false,
  recommendedId: null,
  change: null,
  geoProblem: '',
  fetchProblem: '',
};

// 這次讀取失敗的來源暫用上一筆，避免路況瞬間變成估算、推薦路線跟著亂跳
function keepLastGood(data, last) {
  const kept = [];
  ['nfb', 'vd', 'tpe'].forEach((name) => {
    if (!(data.errors || []).some((e) => e.startsWith(`${name}:`)) || !last || !last.updated || !last.updated[name]) return;
    data[name] = last[name];
    data.updated = { ...data.updated, [name]: last.updated[name] };
    kept.push(name);
  });
  if (data.eventsError && last) data.events = last.events;
  data.kept = kept;
  return data;
}

// 維持目前的推薦，除非別條路明顯更快
function chooseRecommended(result, now) {
  const best = result.winner;
  const current = result.routes.find((r) => r.id === live.recommendedId);
  if (current && current.seconds - best.seconds < SWITCH_MARGIN_S) {
    result.winner = current;
    return;
  }
  if (current && current.id !== best.id) {
    live.change = {
      from: current.name,
      saved: Math.max(1, Math.round((current.seconds - best.seconds) / 60)),
      at: now,
    };
  }
  live.recommendedId = best.id;
}

function headline(result) {
  const w = result.winner;
  const title = `路線 ${w.id}　${w.name}`;
  if (result.routes.length === 1) return { kicker: '繼續走這條', title };
  if (w.id === 1) return { kicker: '照平常走', title };
  return { kicker: '建議繞路', title };
}

function verdictNotes(result) {
  const w = result.winner;
  const others = result.routes.filter((r) => r.id !== w.id);
  const notes = [];
  if (others.length && Math.abs(others[0].seconds - w.seconds) < 120) notes.push('前兩名差距不到 2 分鐘，已在估算誤差內，走哪條都可以。');
  if (w.liveShare < 0.5 && w.km > 1) notes.push(`這條路線只有 ${Math.round(w.liveShare * 100)}% 的時間來自即時資料，其餘是估算車速，建議用 Google 地圖再確認。`);
  return notes;
}

function renderVerdict(result) {
  const w = result.winner;
  const h = headline(result);
  const others = result.routes.filter((r) => r.id !== w.id);
  let delta = '';
  if (others.length) {
    const next = others[0];
    const diff = Math.round((next.seconds - w.seconds) / 60);
    delta = diff >= 1 ? `比${next.name}快 ${diff} 分鐘` : `和${next.name}差不多`;
  }
  const change = live.change && Date.now() - live.change.at < 5 * 60000
    ? `<p class="change">${hhmm(live.change.at)} 路況改變：改走這條比${esc(live.change.from)}快 ${live.change.saved} 分鐘</p>`
    : '';
  const notes = verdictNotes(result).map((n) => `<p class="note">${esc(n)}</p>`).join('');
  $('verdict').innerHTML = `
    ${change}
    <p class="kicker">${esc(h.kicker)}</p>
    <h2>${esc(h.title)}</h2>
    <p class="via">${esc(w.via)}</p>
    <div class="numbers">
      <div><b>${w.minutes}</b><span>剩餘分鐘</span></div>
      <div><b>${hhmm(w.arrive)}</b><span>預估抵達</span></div>
      <div><b>${w.km.toFixed(1)}</b><span>剩餘公里</span></div>
    </div>
    ${delta ? `<p class="delta">${esc(delta)}</p>` : ''}
    ${notes}
    <a class="primary-link" href="${esc(mapsUrl(w, live.tracker))}" target="_blank" rel="noopener">用 Google 地圖開這條路線</a>`;
  $('verdict').hidden = false;
}

function renderDataStatus(data, now, result) {
  const parts = [];
  const nfb = data.updated && data.updated.nfb ? new Date(data.updated.nfb) : null;
  if (nfb && !isNaN(nfb)) parts.push(`國道資料 ${hhmm(nfb)}`);
  parts.push(`分析時間 ${hhmm(now)}`);
  parts.push(result.peak ? '估算路段以尖峰車速計' : '估算路段以離峰車速計');
  let warn = '';
  if (live.fetchProblem) warn += `<p class="warn-line">${esc(live.fetchProblem)}</p>`;
  if (result.stale.length) warn += `<p class="warn-line">${esc(result.stale.map((s) => FEED_TEXT[s]).join('、'))}超過 ${STALE_MINUTES} 分鐘沒更新，相關路段改用估算。</p>`;
  if (data.kept && data.kept.length) warn += `<p class="warn-line">${esc(data.kept.map((s) => FEED_TEXT[s]).join('、'))}這次讀取失敗，暫用上一筆。</p>`;
  const failed = (data.errors || []).filter((e) => !(data.kept || []).some((k) => e.startsWith(`${k}:`)));
  if (failed.length) warn += `<p class="warn-line">有資料來源讀取失敗，相關路段改用估算：${esc(failed.join('；'))}</p>`;
  $('status').innerHTML = `${warn}<p>${esc(parts.join('　·　'))}</p>`;
}

function stripHtml(route) {
  return route.rows.map((r) => `<i class="lv-${r.level}" style="flex-grow:${r.seconds.toFixed(0)}" title="${esc(r.name)}"></i>`).join('');
}

function routeCard(route, isOpen, result) {
  const diff = Math.round((route.seconds - result.winner.seconds) / 60);
  const rows = route.rows.map((r) => `
    <li>
      <span class="dot lv-${r.level}"></span>
      <span class="seg-name">${esc(r.name)}<small>${r.km.toFixed(1)} km · ${esc(SOURCE_TEXT[r.source])}${r.missing ? '（缺資料）' : ''}</small></span>
      <span class="seg-speed">${r.speed}<small>km/h</small></span>
      <span class="seg-min">${(r.seconds / 60).toFixed(1)}<small>分</small></span>
    </li>`).join('');
  const events = route.events.map((ev) => `<li>${esc(ev.description || ev.title)}</li>`).join('');
  const cams = route.cams.map((key) => `<button type="button" class="cam-chip" data-route="${route.id}" data-cam="${esc(key)}">${esc(CAMS[key].label)}</button>`).join('');
  const reason = route.worst ? `<p class="reason">最慢：${esc(route.worst.name)} ${route.worst.speed} km/h</p>` : '';
  const liveShare = Math.round(route.liveShare * 100);
  return `
    <details class="route" data-route="${route.id}" ${isOpen ? 'open' : ''}>
      <summary>
        <span class="rank">${route.id}</span>
        <span class="route-title"><b>${esc(route.name)}</b><small>${esc(route.via)}</small></span>
        <span class="route-time"><b>${route.minutes}</b><small>${route.id === result.winner.id ? '建議' : diff > 0 ? `慢 ${diff} 分` : '差不多'}</small></span>
        <span class="strip" role="img" aria-label="路段狀況">${stripHtml(route)}</span>
      </summary>
      <div class="route-body">
        ${reason}
        ${events ? `<ul class="events">${events}</ul>` : ''}
        <ul class="segments">${rows}</ul>
        <p class="share">即時資料占預估時間 ${liveShare}%</p>
        <h3>監視器</h3>
        <div class="cams">${cams}</div>
        ${route.camNote ? `<p class="share">${esc(route.camNote)}</p>` : ''}
        ${route.camLink ? `<a class="map-link" href="${esc(route.camLink.url)}" target="_blank" rel="noopener">${esc(route.camLink.label)}</a>` : ''}
        <a class="map-link" href="${esc(mapsUrl(route, live.tracker))}" target="_blank" rel="noopener">在 Google 地圖開啟</a>
      </div>
    </details>`;
}

function renderIdle() {
  $('routes').innerHTML = ROUTES.map((r) => `
    <div class="route idle">
      <span class="rank">${r.id}</span>
      <span class="route-title"><b>${esc(r.name)}</b><small>${esc(r.via)}</small></span>
    </div>`).join('');
}

// 每次重畫都保留使用者展開或收起的狀態
function openRouteIds(defaultId) {
  const cards = [...document.querySelectorAll('details.route')];
  if (!cards.length) return new Set([defaultId]);
  return new Set(cards.filter((c) => c.open).map((c) => Number(c.dataset.route)));
}

function render() {
  if (!live.data) return;
  const now = new Date();
  const result = analyze(live.data, now, live.tracker);
  chooseRecommended(result, now);
  renderVerdict(result);
  renderDataStatus(live.data, now, result);
  const open = openRouteIds(result.winner.id);
  const missed = result.missed.map((r) => `
    <div class="route idle missed">
      <span class="rank">${r.id}</span>
      <span class="route-title"><b>${esc(r.name)}</b><small>已經過岔路，無法再走這條</small></span>
    </div>`).join('');
  $('routes').innerHTML = result.routes.map((r) => routeCard(r, open.has(r.id), result)).join('') + missed;
  $('legend').hidden = false;
  $('intro').hidden = true;
  live.lastRenderAt = Date.now();
  live.dirty = false;
}

function whereText() {
  const t = live.tracker;
  if (live.geoProblem) return live.geoProblem;
  if (!t || !t.fix) return '等待定位中，時間先從石碇服務區算起';
  const accuracy = `定位誤差約 ${Math.round(t.fix.accuracy)} 公尺`;
  if (t.weak) return `定位不穩（${accuracy}），暫用上一個位置`;
  if (t.off && !t.everMatched) return `不在路線上，時間從石碇服務區算起（${accuracy}）`;
  if (t.off) return `偏離路線，以最後位置計算（${accuracy}）`;
  const id = live.recommendedId && !t.eliminated.has(live.recommendedId) ? live.recommendedId : ROUTES.find((r) => !t.eliminated.has(r.id)).id;
  const route = ROUTES.find((r) => r.id === id);
  return `目前在 ${route.segments[t.progress[id].seg].name}（${accuracy}）`;
}

function renderLiveBar() {
  const left = Math.max(0, Math.ceil((REFRESH_MS - (Date.now() - live.lastFetchAt)) / 1000));
  $('liveState').textContent = live.fetching ? '讀取路況中…' : `下次更新 ${left} 秒`;
  $('liveWhere').textContent = whereText();
}

async function refresh() {
  if (live.fetching) return;
  live.fetching = true;
  live.lastFetchAt = Date.now();
  renderLiveBar();
  try {
    live.data = keepLastGood(await fetchData(), live.data);
    live.fetchProblem = '';
  } catch (err) {
    const why = err.name === 'AbortError' ? '等太久沒有回應' : err.message;
    live.fetchProblem = live.data
      ? `這次更新失敗（${why}），顯示上一筆，下一分鐘會再試。`
      : `讀取失敗（${why}），下一分鐘會再試。`;
    if (!live.data) $('status').innerHTML = `<p class="warn-line">${esc(live.fetchProblem)}</p>`;
  } finally {
    live.fetching = false;
  }
  if (!live.running) return;
  render();
  renderLiveBar();
}

function handleFix(fix) {
  if (!live.running) return;
  live.geoProblem = '';
  live.tracker.update(fix, Date.now());
  live.dirty = true;
  if (live.tracker.arrived) {
    render();
    stopLive('已抵達國票金控，自動停止分析。');
  }
}

function startGeolocation() {
  if (!('geolocation' in navigator)) {
    live.geoProblem = '這台裝置無法定位，時間從石碇服務區算起';
    return;
  }
  live.watchId = navigator.geolocation.watchPosition(
    (pos) => handleFix({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }),
    (err) => {
      if (err.code === err.PERMISSION_DENIED) {
        live.geoProblem = '沒有定位權限，時間從石碇服務區算起；路況仍會每分鐘更新';
      } else if (!live.tracker.fix) {
        live.geoProblem = '暫時抓不到定位，時間從石碇服務區算起';
      }
    },
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
  );
}

// 螢幕關掉後瀏覽器會暫停定位與更新，所以分析中盡量讓螢幕保持亮著
async function keepScreenOn() {
  if (!live.running || !('wakeLock' in navigator) || document.hidden) return;
  try {
    live.wakeLock = await navigator.wakeLock.request('screen');
  } catch (err) {
    live.wakeLock = null;
  }
}

function tick() {
  if (document.hidden) return; // 不在前景就不呼叫，回來時立刻更新
  if (Date.now() - live.startedAt > MAX_RUN_MS) {
    stopLive('已連續分析 2 小時，自動停止。');
    return;
  }
  if (Date.now() - live.lastFetchAt >= REFRESH_MS) refresh();
  else if (live.dirty && Date.now() - live.lastRenderAt >= RERENDER_MS) render();
  renderLiveBar();
}

function startLive() {
  if (!DEMO && !DEV && !window.COMMUTE_API) {
    $('status').innerHTML = '<p class="warn-line">還沒設定資料來源：請依 README 部署 Apps Script，並把網址填進 config.js。<a href="?demo">先看示範畫面</a></p>';
    return;
  }
  Object.assign(live, {
    running: true,
    startedAt: Date.now(),
    tracker: createTracker(),
    data: null,
    recommendedId: null,
    change: null,
    geoProblem: '',
    fetchProblem: '',
  });
  document.querySelectorAll('details.route').forEach((c) => c.remove());
  $('analyze').textContent = '停止分析';
  $('analyze').classList.add('running');
  $('liveBar').hidden = false;
  $('stopNote').hidden = true;
  startGeolocation();
  keepScreenOn();
  live.timer = setInterval(tick, 1000);
  refresh();
}

function stopLive(note) {
  live.running = false;
  clearInterval(live.timer);
  if (live.watchId !== null) navigator.geolocation.clearWatch(live.watchId);
  live.watchId = null;
  if (live.wakeLock) live.wakeLock.release().catch(() => {});
  live.wakeLock = null;
  $('analyze').textContent = '開始分析';
  $('analyze').classList.remove('running');
  $('liveBar').hidden = true;
  $('stopNote').hidden = !note;
  $('stopNote').textContent = note || '';
}

document.addEventListener('visibilitychange', () => {
  if (!live.running || document.hidden) return;
  keepScreenOn();
  tick();
});

// 監視器：MJPEG 串流會一直占用連線與流量，同時間只開一支，關閉時要清掉 src
const viewer = { list: [], index: 0 };

function showCam() {
  const c = CAMS[viewer.list[viewer.index]];
  $('camTitle').textContent = c.label;
  $('camCount').textContent = `${viewer.index + 1} / ${viewer.list.length}`;
  $('camError').hidden = true;
  $('camImage').hidden = false;
  $('camImage').src = c.url;
  $('camPrev').disabled = viewer.list.length < 2;
  $('camNext').disabled = viewer.list.length < 2;
}

function stepCam(delta) {
  viewer.index = (viewer.index + delta + viewer.list.length) % viewer.list.length;
  showCam();
}

$('camImage').addEventListener('error', () => {
  if (!$('camImage').getAttribute('src')) return;
  $('camImage').hidden = true;
  $('camError').hidden = false;
});
$('camPrev').addEventListener('click', () => stepCam(-1));
$('camNext').addEventListener('click', () => stepCam(1));
$('camClose').addEventListener('click', () => {
  $('camImage').removeAttribute('src');
  $('camDialog').close();
});
$('camDialog').addEventListener('close', () => $('camImage').removeAttribute('src')); // Esc 關閉時
$('routes').addEventListener('click', (e) => {
  const chip = e.target.closest('.cam-chip');
  if (!chip) return;
  const route = ROUTES.find((r) => r.id === Number(chip.dataset.route));
  viewer.list = route.cams;
  viewer.index = route.cams.indexOf(chip.dataset.cam);
  showCam();
  $('camDialog').showModal();
});

$('analyze').addEventListener('click', () => (live.running ? stopLive('') : startLive()));
if (DEMO) $('demoBanner').hidden = false;
renderIdle();

if ('serviceWorker' in navigator && !DEV) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
