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

function headline(result) {
  const w = result.winner;
  if (w.id === 1) return { kicker: '照平常走', title: `路線 1　${w.name}` };
  return { kicker: '今天建議繞路', title: `路線 ${w.id}　${w.name}` };
}

function verdictNotes(result) {
  const w = result.winner;
  const notes = [];
  if (result.margin < 120) notes.push('前兩名差距不到 2 分鐘，已在估算誤差內，走哪條都可以。');
  if (w.liveShare < 0.5) notes.push(`這條路線只有 ${Math.round(w.liveShare * 100)}% 的時間來自即時資料，其餘是估算車速，出發前建議用 Google 地圖再確認。`);
  return notes;
}

function renderVerdict(result, data, now) {
  const w = result.winner;
  const h = headline(result);
  let delta = '';
  if (w.id !== 1 && result.saved > 0) delta = `比國五直上快 ${result.saved} 分鐘`;
  else if (w.id === 1 && result.routes[1]) delta = `比次快的${result.routes[1].name}快 ${Math.max(1, Math.round(result.margin / 60))} 分鐘`;
  const notes = verdictNotes(result).map((n) => `<p class="note">${esc(n)}</p>`).join('');
  $('verdict').innerHTML = `
    <p class="kicker">${esc(h.kicker)}</p>
    <h2>${esc(h.title)}</h2>
    <p class="via">${esc(w.via)}</p>
    <div class="numbers">
      <div><b>${w.minutes}</b><span>分鐘</span></div>
      <div><b>${hhmm(w.arrive)}</b><span>預估抵達</span></div>
      <div><b>${w.km.toFixed(1)}</b><span>公里</span></div>
    </div>
    ${delta ? `<p class="delta">${esc(delta)}</p>` : ''}
    ${notes}
    <a class="primary-link" href="${esc(mapsUrl(w))}" target="_blank" rel="noopener">用 Google 地圖開這條路線</a>`;
  $('verdict').hidden = false;
  renderDataStatus(data, now, result);
}

function renderDataStatus(data, now, result) {
  const parts = [];
  const nfb = data.updated && data.updated.nfb ? new Date(data.updated.nfb) : null;
  if (nfb && !isNaN(nfb)) parts.push(`國道資料 ${hhmm(nfb)}`);
  parts.push(`分析時間 ${hhmm(now)}`);
  parts.push(result.peak ? '估算路段以尖峰車速計' : '估算路段以離峰車速計');
  let warn = '';
  if (result.stale.length) warn = `<p class="warn-line">${esc(result.stale.map((s) => FEED_TEXT[s]).join('、'))}超過 ${STALE_MINUTES} 分鐘沒更新，相關路段改用估算。</p>`;
  if (data.errors && data.errors.length) warn += `<p class="warn-line">有資料來源讀取失敗，相關路段改用估算：${esc(data.errors.join('；'))}</p>`;
  $('status').innerHTML = `${warn}<p>${esc(parts.join('　·　'))}</p>`;
}

function stripHtml(route) {
  return route.rows.map((r) => `<i class="lv-${r.level}" style="flex-grow:${r.seconds.toFixed(0)}" title="${esc(r.name)}"></i>`).join('');
}

function routeCard(route, index, result) {
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
  const live = Math.round(route.liveShare * 100);
  return `
    <details class="route" ${index === 0 ? 'open' : ''}>
      <summary>
        <span class="rank">${route.id}</span>
        <span class="route-title"><b>${esc(route.name)}</b><small>${esc(route.via)}</small></span>
        <span class="route-time"><b>${route.minutes}</b><small>${diff > 0 ? `慢 ${diff} 分` : '最快'}</small></span>
        <span class="strip" role="img" aria-label="路段狀況">${stripHtml(route)}</span>
      </summary>
      <div class="route-body">
        ${reason}
        ${events ? `<ul class="events">${events}</ul>` : ''}
        <ul class="segments">${rows}</ul>
        <p class="share">即時資料占預估時間 ${live}%</p>
        <h3>監視器</h3>
        <div class="cams">${cams}</div>
        ${route.camNote ? `<p class="share">${esc(route.camNote)}</p>` : ''}
        ${route.camLink ? `<a class="map-link" href="${esc(route.camLink.url)}" target="_blank" rel="noopener">${esc(route.camLink.label)}</a>` : ''}
        <a class="map-link" href="${esc(mapsUrl(route))}" target="_blank" rel="noopener">在 Google 地圖開啟</a>
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

function showResult(data) {
  const now = new Date();
  const result = analyze(data, now);
  renderVerdict(result, data, now);
  $('routes').innerHTML = result.routes.map((r, i) => routeCard(r, i, result)).join('');
  $('legend').hidden = false;
  $('intro').hidden = true;
}

async function runAnalysis() {
  const btn = $('analyze');
  if (!DEMO && !DEV && !window.COMMUTE_API) {
    $('status').innerHTML = '<p class="warn-line">還沒設定資料來源：請依 README 部署 Apps Script，並把網址填進 config.js。<a href="?demo">先看示範畫面</a></p>';
    return;
  }
  btn.disabled = true;
  btn.textContent = '讀取路況中…';
  try {
    showResult(await fetchData());
    btn.textContent = '重新分析';
  } catch (err) {
    const why = err.name === 'AbortError' ? '等太久沒有回應' : err.message;
    $('status').innerHTML = `<p class="warn-line">讀取失敗（${esc(why)}），請確認網路後再試一次。</p>`;
    btn.textContent = '分析';
  } finally {
    btn.disabled = false;
  }
}

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

$('analyze').addEventListener('click', runAnalysis);
if (DEMO) $('demoBanner').hidden = false;
renderIdle();

if ('serviceWorker' in navigator && !DEV) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
