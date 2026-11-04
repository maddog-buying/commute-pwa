// ?dev：在瀏覽器裡執行真正的 backend/Code.gs，只把 Apps Script 的服務換成本機替身
window.UrlFetchApp = {
  fetch(url) {
    const name = Object.keys(window.__FEEDS).find((n) => window.__FEEDS[n] === url);
    const xhr = new XMLHttpRequest();
    xhr.open('GET', `/feed/${name}`, false);
    xhr.send();
    return { getResponseCode: () => xhr.status, getContent: () => [], getContentText: () => xhr.responseText };
  },
};

window.devCollect = async function devCollect() {
  const src = await (await fetch('backend/Code.gs')).text();
  const collect = (0, eval)(`(function(){${src}; window.__FEEDS = FEEDS; return collect;})()`);
  const query = Object.fromEntries(new URLSearchParams(apiQuery()));
  return collect(query);
};
