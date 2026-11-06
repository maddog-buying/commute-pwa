// 把 GPS 位置對應到路線的路段。位置只在手機上計算，不會送出。

const MIN_TOLERANCE_M = 120;
const MAX_TOLERANCE_M = 250;
const IGNORE_ACCURACY_M = 300; // 定位太差時不更新進度
const BACKTRACK_M = 300; // 進度只往前，容許這點定位飄移
const ELIMINATE_AFTER_MS = 30000; // 離開路線這麼久才算錯過，避免 GPS 飄移誤判
const ARRIVE_M = 150;

function metersBetween(a, b) {
  const scale = Math.cos((a[0] * Math.PI) / 180);
  const dy = (b[0] - a[0]) * 111320;
  const dx = (b[1] - a[1]) * 111320 * scale;
  return Math.hypot(dx, dy);
}

function indexRoutes(routes) {
  return Object.fromEntries(Object.entries(routes).map(([id, segments]) => {
    let total = 0;
    const indexed = segments.map((points) => {
      const startM = total;
      const lengths = points.slice(1).map((p, i) => metersBetween(points[i], p));
      const lengthM = lengths.reduce((a, b) => a + b, 0);
      total += lengthM;
      return { points, lengths, startM, lengthM };
    });
    return [id, { segments: indexed, totalM: total }];
  }));
}

// 上下班 → routeId → 各路段的座標與累計里程
const ROUTE_INDEX = { work: indexRoutes(ROUTE_GEOMETRY.work), home: indexRoutes(ROUTE_GEOMETRY.home) };

// 找出路線上離這個位置最近的點；minM 之前的部分不考慮
function locate(routeId, point, minM = 0) {
  const scale = Math.cos((point[0] * Math.PI) / 180);
  let best = null;
  ROUTE_INDEX[MODE][routeId].segments.forEach((segment, seg) => {
    let walked = segment.startM;
    segment.lengths.forEach((length, i) => {
      const a = segment.points[i];
      const b = segment.points[i + 1];
      const dx = (b[1] - a[1]) * scale;
      const dy = b[0] - a[0];
      const px = (point[1] - a[1]) * scale;
      const py = point[0] - a[0];
      const denom = dx * dx + dy * dy;
      const t = denom ? Math.min(1, Math.max(0, (px * dx + py * dy) / denom)) : 0;
      const m = walked + t * length;
      walked += length;
      if (m < minM) return;
      const distM = Math.hypot(px - t * dx, py - t * dy) * 111320;
      if (!best || distM < best.distM) {
        const inSegment = m - segment.startM;
        best = { distM, m, seg, frac: segment.lengthM ? inSegment / segment.lengthM : 0 };
      }
    });
  });
  return best;
}

function createTracker() {
  const progress = {};
  const offSince = {};
  ROUTES.forEach((r) => { progress[r.id] = { seg: 0, frac: 0, m: 0 }; });
  return {
    progress,
    eliminated: new Set(),
    fix: null,
    fixAt: 0,
    weak: false,
    off: false,
    everMatched: false,
    arrived: false,

    update({ lat, lng, accuracy }, time) {
      const point = [lat, lng];
      this.fix = { lat, lng, accuracy };
      this.fixAt = time;
      this.weak = accuracy > IGNORE_ACCURACY_M;
      if (this.weak) return;
      const tolerance = Math.max(MIN_TOLERANCE_M, Math.min(accuracy * 1.5, MAX_TOLERANCE_M));
      const matched = [];
      const missed = [];
      ROUTES.forEach((r) => {
        const loc = locate(r.id, point, Math.max(0, progress[r.id].m - BACKTRACK_M));
        if (loc && loc.distM <= tolerance) {
          progress[r.id] = loc;
          offSince[r.id] = null;
          matched.push(r.id);
        } else {
          if (!offSince[r.id]) offSince[r.id] = time;
          missed.push(r.id);
        }
      });
      const active = matched.filter((id) => !this.eliminated.has(id));
      // 繞回已錯過的路線時恢復它
      if (matched.length && !active.length) matched.forEach((id) => this.eliminated.delete(id));
      this.off = !matched.length;
      if (matched.length) {
        this.everMatched = true;
        missed.forEach((id) => {
          if (time - offSince[id] >= ELIMINATE_AFTER_MS) this.eliminated.add(id);
        });
      }
      const segments = ROUTE_GEOMETRY[MODE][1];
      const destination = segments[segments.length - 1].slice(-1)[0];
      this.arrived = metersBetween(point, destination) <= ARRIVE_M;
    },
  };
}
