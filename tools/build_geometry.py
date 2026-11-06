"""產生 routes-geometry.js：每條路線、每個路段的座標，用來把 GPS 位置對應到路段。
只在路線改變時手動執行。路徑來自 OSRM（OpenStreetMap）。

高架與國道的定位點會吸附到對向車道，所以要附上行車方向（度）約束。
一段路徑可以再依 km 比例切成多個路段（順序要和 routes.js 的 segments 一致）。"""
import json
import math
import os
import time
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# (lat, lng, 行車方向)，方向 None 表示不約束
S = (25.0096, 121.6452, None)         # 石碇服務區
N5_ON = (25.024202, 121.639881, 340)  # 國五北向 2.1K（3.8K 還在石碇上匝道匯入點之前）
N5_END = (25.035247, 121.624003, 285) # 國五北向 0K
N3_EXIT = (25.0447381, 121.6257799, 25)  # 國三北向 14.8K 南港出口
LINK_08 = (25.0532814, 121.6208964, 345) # 聯絡道 0.8K
RING_A = (25.061456, 121.619544, 300) # 環東進城起點
RING_B = (25.062867, 121.616821, 265) # 彩虹橋段起點
RING_C = (25.059069, 121.584603, 250) # 彩虹橋段終點
TD_1 = (25.0546, 121.5765, None)      # 堤頂大道一段南端
TD_2 = (25.064893, 121.572434, None)  # 堤頂大道一段中段
OFFICE = (25.0826, 121.5600, None)    # 樂群三路
N3_204 = (25.0052962, 121.5960017, 10)  # 國三北向 20.4K
N3_163 = (25.0335002, 121.6173366, 60)  # 國三北向 16.35K
N3_154 = (25.0394835, 121.6237794, 20)  # 國三北向 15.4K（16.1K 的鏡頭在往國五的匝道上）
SHENNAN_END = (25.017274, 121.623086, None)  # 深南路接南深路
NANSHEN = (25.0268, 121.6237, None)   # 南深路中段
JIUZHUANG = (25.039082, 121.621651, None)    # 舊莊街
RESEARCH_A = (25.042524, 121.616925, None)   # 研究院路
RESEARCH_B = (25.046936, 121.615421, None)   # 研究院路接忠孝東路

# 每個項目：(這段路徑的定位點, 切成哪些路段的 km)
TO_RING = [([N3_EXIT, LINK_08, RING_A], [1.4]), ([RING_A, RING_B], [0.33]), ([RING_B, RING_C], [3.25])]
TAIL = [([RING_C, TD_1, TD_2, OFFICE], [0.9, 1.4, 0.35, 0.5, 0.5, 0.4])]
ROUTES = {
    1: [([S, N5_ON, N5_END], [0.65, 4.0]), ([N5_END, N3_EXIT], [0.4, 1.2])] + TO_RING + TAIL,
    2: [([S, N3_204], [6.0]), ([N3_204, N3_163], [4.3]), ([N3_163, N3_154, N3_EXIT], [0.2, 1.2])] + TO_RING + TAIL,
    3: [([S, SHENNAN_END], [4.9]), ([SHENNAN_END, NANSHEN, JIUZHUANG], [3.6]), ([JIUZHUANG, RESEARCH_A], [1.3]),
        ([RESEARCH_A, RESEARCH_B], [0.9]), ([RESEARCH_B, RING_B], [2.5]), ([RING_B, RING_C], [3.25])] + TAIL,
}


def distance_km(a, b):
    dlat = math.radians(b[0] - a[0])
    dlng = math.radians(b[1] - a[1])
    h = math.sin(dlat / 2) ** 2 + math.cos(math.radians(a[0])) * math.cos(math.radians(b[0])) * math.sin(dlng / 2) ** 2
    return 6371 * 2 * math.asin(math.sqrt(h))


def path_km(path):
    return sum(distance_km(path[i], path[i + 1]) for i in range(len(path) - 1))


def fetch_path(points):
    coords = ';'.join(f'{p[1]},{p[0]}' for p in points)
    bearings = ';'.join('' if p[2] is None else f'{p[2]},70' for p in points)
    url = (f'https://router.project-osrm.org/route/v1/driving/{coords}'
           f'?overview=full&geometries=geojson&bearings={bearings}')
    req = urllib.request.Request(url, headers={'User-Agent': 'commute-pwa-build'})
    with urllib.request.urlopen(req, timeout=40) as res:
        route = json.load(res)['routes'][0]
    path = []
    for lng, lat in route['geometry']['coordinates']:
        pt = [round(lat, 5), round(lng, 5)]
        if not path or path[-1] != pt:
            path.append(pt)
    return path


def split_by_km(path, weights):
    """依 km 比例切開路徑，相鄰路段共用切點。"""
    if len(weights) == 1:
        return [path]
    total = path_km(path)
    sum_weights = sum(weights)
    parts = []
    current = [path[0]]
    index = 0
    walked = 0.0
    target = 0.0
    for w in weights[:-1]:
        target += total * w / sum_weights
        while index < len(path) - 1:
            step = distance_km(path[index], path[index + 1])
            if walked + step >= target:
                break
            walked += step
            index += 1
            current.append(path[index])
        step = distance_km(path[index], path[index + 1]) or 1e-9
        ratio = (target - walked) / step
        cut = [round(path[index][0] + (path[index + 1][0] - path[index][0]) * ratio, 5),
               round(path[index][1] + (path[index + 1][1] - path[index][1]) * ratio, 5)]
        current.append(cut)
        parts.append(current)
        current = [cut]
    parts.append(current + path[index + 1:])
    return parts


def main():
    out = {}
    for route_id, legs in ROUTES.items():
        segments = []
        for points, weights in legs:
            segments += split_by_km(fetch_path(points), weights)
            time.sleep(1.5)
        out[route_id] = segments
        print(route_id, round(sum(path_km(s) for s in segments), 2), [round(path_km(s), 2) for s in segments])
    body = json.dumps(out, separators=(',', ':'))
    with open(os.path.join(ROOT, 'routes-geometry.js'), 'w', encoding='utf-8') as f:
        f.write('// tools/build_geometry.py 產生，路徑資料 © OpenStreetMap contributors\n')
        f.write(f'const ROUTE_GEOMETRY = {body};\n')


if __name__ == '__main__':
    main()
