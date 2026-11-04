"""本機預覽：提供靜態檔，並在 /feed/<名稱> 代抓開放資料（快取 60 秒，避免打太兇）。
真實部署不會用到這支；搭配 ?dev 可在瀏覽器裡直接跑 backend/Code.gs。"""
import gzip
import http.server
import os
import ssl
import time
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FEEDS = {
    'nfb': 'https://tisvcloud.freeway.gov.tw/history/motc20/LiveTraffic.xml',
    'vd': 'https://tisvcloud.freeway.gov.tw/history/motc20/VDLive.xml',
    'events': 'https://tisvcloud.freeway.gov.tw/history/motc20/LiveEvents.xml',
    'tpe': 'https://tcgbusfs.blob.core.windows.net/blobtisv/GetVD.xml.gz',
}
cache = {}
# 高公局憑證缺 Subject Key Identifier，Python 3.13+ 的嚴格模式會拒絕；其餘驗證照舊
SSL_CONTEXT = ssl.create_default_context()
SSL_CONTEXT.verify_flags &= ~ssl.VERIFY_X509_STRICT


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def do_GET(self):
        if not self.path.startswith('/feed/'):
            return super().do_GET()
        name = self.path[len('/feed/'):]
        if name not in FEEDS:
            return self.send_error(404)
        at, body = cache.get(name, (0, b''))
        if time.time() - at > 60:
            with urllib.request.urlopen(FEEDS[name], timeout=30, context=SSL_CONTEXT) as res:
                body = res.read()
            if body[:2] == b'\x1f\x8b':
                body = gzip.decompress(body)
            cache[name] = (time.time(), body)
        self.send_response(200)
        self.send_header('Content-Type', 'application/xml; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)


if __name__ == '__main__':
    http.server.ThreadingHTTPServer(('127.0.0.1', 8091), Handler).serve_forever()
