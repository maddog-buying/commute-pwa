// ?demo：虛構的「國五塞車」情境，只用來看畫面，不是真實路況
window.DEMO_DATA = {
  fetchedAt: new Date().toISOString(),
  updated: { nfb: new Date().toISOString() },
  errors: [],
  nfb: {
    '0366': { speed: 12, time: 1200 },
    '0190': { speed: 42, time: 103 },
    '0194': { speed: 74, time: 209 },
    '0192': { speed: 66, time: 11 },
  },
  vd: {
    'VD-N3-N-16-I-EN-南港系統-5N3N': { speed: 14 },
    'VD-N3N-N-0.700-M-LOOP': { speed: 38 },
  },
  tpe: {
    Z6310G0: { speed: 55 },
    Z6330G0: { speed: 48 },
    ZRPSV00: { speed: 26 },
    ZSGRX60: { speed: 34 },
    ZSPRA60: { speed: 38 },
    ZT5QV00: { speed: 31 },
    ZHX4E40: { speed: 24 },
    ZKP4L00: { speed: 19 },
  },
  events: [{
    title: '事故',
    description: '示範：國道五號 北向 2K+300 事故，外側車道阻塞',
    road: '國道五號',
    direction: '北向',
    startKm: '2K+300',
    endKm: '2K+000',
    severity: 2,
  }],
};
