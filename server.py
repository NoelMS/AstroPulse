import json
import math
import os
import re
import subprocess
import sys
import threading
import time
import urllib.request
import webbrowser
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

ROOT = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(ROOT, 'cache')
BAT_BASE = 'https://swift.gsfc.nasa.gov/results/transients/'
ATEL_RSS = 'https://www.astronomerstelegram.org/?rss'
CRAB_RATE = 0.216
BAT_TTL = 3 * 3600
ATEL_TTL = 15 * 60
USER_AGENT = 'AstroPulse/1.0 (research workstation)'

FEEDS = {
    'cyg': 'CygX-1',
    'crab': 'Crab',
    'grs': 'GRS1915p105',
    'v404': 'weak/V404Cyg',
    'maxi': 'weak/MAXIJ1820p070',
    'her': 'HerX-1',
    'sco': 'ScoX-1',
    'vela': 'VelaX-1',
    'cen': 'CenX-3',
    '4u': None,
}

ALIASES = {
    'cyg': [r'Cyg(nus)?\s*X-?1'],
    'crab': [r'Crab'],
    'grs': [r'GRS\s*1915\+105'],
    'v404': [r'V404\s*Cyg(ni)?'],
    'maxi': [r'MAXI\s*J1820\+070', r'ASASSN-18ey'],
    'her': [r'Her(cules)?\s*X-?1'],
    'sco': [r'Sco(rpius)?\s*X-?1'],
    'vela': [r'Vela\s*X-?1'],
    '4u': [r'4U\s*1820-30'],
    'cen': [r'Cen(taurus)?\s*X-?3'],
}

_lock = threading.Lock()
_mem = {}
_last_seen = [time.time()]
_summaries = {}
_refreshing = set()
IDLE_LIMIT = 5 * 60


def fetch(url, ttl, name):
    path = os.path.join(CACHE, name)
    now = time.time()
    with _lock:
        hit = _mem.get(name)
    if hit is None and os.path.exists(path) and now - os.path.getmtime(path) < ttl:
        with open(path, 'rb') as f:
            hit = (os.path.getmtime(path), f.read())
        with _lock:
            _mem[name] = hit
    if hit and now - hit[0] < ttl:
        return hit[1], hit[0], False
    try:
        req = urllib.request.Request(url, headers={'User-Agent': USER_AGENT})
        with urllib.request.urlopen(req, timeout=45) as r:
            body = r.read()
        os.makedirs(CACHE, exist_ok=True)
        with open(path, 'wb') as f:
            f.write(body)
        with _lock:
            _mem[name] = (now, body)
        return body, now, False
    except Exception:
        if hit:
            return hit[1], hit[0], True
        if os.path.exists(path):
            with open(path, 'rb') as f:
                body = f.read()
            return body, os.path.getmtime(path), True
        raise


def mjd_to_date(mjd):
    return (datetime(1858, 11, 17) + timedelta(days=mjd)).strftime('%Y-%m-%d')


def iso(ts):
    return datetime.fromtimestamp(ts, timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def parse_bat(body):
    rows, generated = [], None
    for line in body.decode('ascii', 'replace').splitlines():
        if line.startswith('#'):
            m = re.search(r'Generated (.+)$', line)
            if m and not generated:
                generated = m.group(1).strip()
            continue
        p = line.split()
        if len(p) < 8:
            continue
        try:
            mjd, rate, err, flag = float(p[0]), float(p[1]), float(p[2]), int(p[7])
        except ValueError:
            continue
        if flag == 0 and err > 0:
            rows.append((mjd, rate * 1000 / CRAB_RATE, err * 1000 / CRAB_RATE))
    return rows, generated


def weighted(rows):
    w = [1 / (r[2] ** 2) for r in rows]
    s = sum(w)
    return sum(r[1] * wi for r, wi in zip(rows, w)) / s, math.sqrt(1 / s)


def bat_rows(sid):
    body, fetched, stale = fetch(BAT_BASE + FEEDS[sid] + '.lc.txt', BAT_TTL, 'bat-' + sid + '.txt')
    rows, generated = parse_bat(body)
    if not rows:
        raise ValueError('The feed returned no usable points.')
    return rows, generated, fetched, stale


def summary(sid):
    if not FEEDS.get(sid):
        return {'id': sid, 'available': False, 'reason': 'Not covered by the Swift/BAT transient monitor.'}
    try:
        rows, generated, fetched, stale = bat_rows(sid)
    except Exception as e:
        return {'id': sid, 'available': False, 'reason': 'Feed unreachable: ' + str(e)[:120]}
    with _lock:
        hit = _summaries.get(sid)
    if hit and hit[0] == fetched and hit[1]['stale'] == stale:
        return hit[1]
    data = build_summary(sid, rows, generated, fetched, stale)
    with _lock:
        _summaries[sid] = (fetched, data)
    return data


def build_summary(sid, rows, generated, fetched, stale):
    last = rows[-1][0]
    week = [r for r in rows if r[0] > last - 7]
    year = [r for r in rows if last - 372 < r[0] <= last - 7]
    wmean, werr = weighted(week)
    weekly = []
    for k in range(52):
        chunk = [r for r in year if last - 7 * (k + 2) < r[0] <= last - 7 * (k + 1)]
        if len(chunk) >= 3:
            weekly.append(weighted(chunk)[0])
    z, trend, ymean = None, 'Insufficient history', None
    if len(weekly) >= 8:
        ymean = sum(weekly) / len(weekly)
        sd = math.sqrt(sum((v - ymean) ** 2 for v in weekly) / (len(weekly) - 1))
        z = (wmean - ymean) / math.sqrt(sd ** 2 + werr ** 2) if sd > 0 else 0.0
        trend = 'Brightening' if z > 3 else ('Fading' if z < -3 else 'Steady')
    spark = [[round(r[0], 1), round(r[1], 2)] for r in rows if r[0] > last - 365]
    return {
        'id': sid,
        'available': True,
        'instrument': 'Swift/BAT',
        'band': '15-50 keV',
        'latest_mjd': last,
        'latest_date': mjd_to_date(last),
        'latest_mcrab': round(rows[-1][1], 2),
        'latest_err': round(rows[-1][2], 2),
        'week_mcrab': round(wmean, 2),
        'week_err': round(werr, 2),
        'year_mcrab': round(ymean, 2) if ymean is not None else None,
        'z': round(z, 2) if z is not None else None,
        'trend': trend,
        'points': len(rows),
        'spark': spark,
        'generated': generated,
        'fetched': iso(fetched),
        'stale': stale,
    }


def refresh_in_background(sid):
    with _lock:
        if sid in _refreshing:
            return
        _refreshing.add(sid)

    def run():
        try:
            summary(sid)
        finally:
            with _lock:
                _refreshing.discard(sid)
    threading.Thread(target=run, daemon=True).start()


def pulse():
    now = time.time()
    out = {}
    for sid, feed in FEEDS.items():
        if not feed:
            out[sid] = {'available': False}
            continue
        with _lock:
            hit = _mem.get('bat-' + sid + '.txt')
            summ = _summaries.get(sid)
            busy = sid in _refreshing
        if not hit or now - hit[0] >= BAT_TTL:
            refresh_in_background(sid)
        out[sid] = {
            'available': True,
            'fetched': iso(hit[0]) if hit else None,
            'latest_mjd': summ[1]['latest_mjd'] if summ else None,
            'refreshing': busy,
        }
    return {'time': iso(now), 'ttl_s': BAT_TTL, 'sources': out}


def lightcurve(sid, days):
    if not FEEDS.get(sid):
        return {'id': sid, 'available': False, 'reason': 'Not covered by the Swift/BAT transient monitor.'}
    rows, generated, fetched, stale = bat_rows(sid)
    last = rows[-1][0]
    sel = [r for r in rows if r[0] > last - days]
    return {
        'id': sid,
        'available': True,
        'instrument': 'Swift/BAT',
        'band': '15-50 keV',
        'unit': 'mCrab',
        'mjd': [round(r[0], 4) for r in sel],
        'rate': [round(r[1], 3) for r in sel],
        'err': [round(r[2], 3) for r in sel],
        'generated': generated,
        'fetched': iso(fetched),
        'stale': stale,
    }


def alerts():
    body, fetched, stale = fetch(ATEL_RSS, ATEL_TTL, 'atel.xml')
    root = ET.fromstring(body)
    items = []
    for item in root:
        if not item.tag.endswith('item'):
            continue
        fields = {c.tag.split('}')[-1]: (c.text or '').strip() for c in item}
        text = fields.get('title', '') + ' ' + fields.get('description', '')
        matched = [sid for sid, pats in ALIASES.items() if any(re.search(p, text, re.I) for p in pats)]
        items.append({
            'title': fields.get('title', ''),
            'link': fields.get('link', ''),
            'date': fields.get('date', ''),
            'sources': matched,
        })
    return {'source': "The Astronomer's Telegram", 'items': items, 'fetched': iso(fetched), 'stale': stale}


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def send_json(self, code, data):
        body = json.dumps(data).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        _last_seen[0] = time.time()
        url = urlparse(self.path)
        if not url.path.startswith('/api/'):
            if url.path.startswith('/cache/') or url.path.endswith('.py'):
                self.send_error(404)
                return
            return super().do_GET()
        try:
            parts = url.path.strip('/').split('/')
            if parts == ['api', 'health']:
                return self.send_json(200, {'ok': True, 'app': 'astropulse', 'app_window': bool(app_browser()), 'time': iso(time.time())})
            if parts == ['api', 'live', 'sources']:
                with ThreadPoolExecutor(max_workers=5) as pool:
                    data = list(pool.map(summary, FEEDS.keys()))
                return self.send_json(200, {'sources': data, 'time': iso(time.time())})
            if len(parts) == 4 and parts[:3] == ['api', 'live', 'lightcurve'] and parts[3] in FEEDS:
                q = parse_qs(url.query)
                days = max(30, min(8000, int(q.get('days', ['1095'])[0])))
                return self.send_json(200, lightcurve(parts[3], days))
            if parts == ['api', 'live', 'pulse']:
                return self.send_json(200, pulse())
            if parts == ['api', 'live', 'alerts']:
                return self.send_json(200, alerts())
            return self.send_json(404, {'error': 'Unknown endpoint.'})
        except Exception as e:
            return self.send_json(502, {'error': 'Upstream data unavailable: ' + str(e)[:200]})

    def do_POST(self):
        _last_seen[0] = time.time()
        if urlparse(self.path).path != '/api/app-window':
            return self.send_json(404, {'error': 'Unknown endpoint.'})
        if self.headers.get('X-AstroPulse') != '1':
            return self.send_json(403, {'error': 'Missing request header.'})
        host, port = self.server.server_address[:2]
        name = open_app_window('http://127.0.0.1:%d/' % port)
        if not name:
            return self.send_json(501, {'error': 'No Chrome or Edge installation found for an app window.'})
        return self.send_json(200, {'ok': True, 'browser': name})

    def log_message(self, fmt, *args):
        if sys.stderr and args and '/api/' in str(args[0]) and '/api/health' not in str(args[0]) and '/api/live/pulse' not in str(args[0]):
            sys.stderr.write('%s %s\n' % (self.log_date_time_string(), fmt % args))


BROWSERS = [
    os.path.join(os.environ.get('ProgramFiles', 'C:/Program Files'), 'Google', 'Chrome', 'Application', 'chrome.exe'),
    os.path.join(os.environ.get('LOCALAPPDATA', ''), 'Google', 'Chrome', 'Application', 'chrome.exe'),
    os.path.join(os.environ.get('ProgramFiles(x86)', 'C:/Program Files (x86)'), 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    os.path.join(os.environ.get('ProgramFiles', 'C:/Program Files'), 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
]
APP_FLAGS = [
    '--force_high_performance_gpu',
    '--ignore-gpu-blocklist',
    '--enable-gpu-rasterization',
    '--enable-zero-copy',
    '--no-first-run',
    '--no-default-browser-check',
    '--window-size=1600,960',
]


def app_browser():
    for path in BROWSERS:
        if path and os.path.isfile(path):
            return path
    return None


def open_app_window(url):
    exe = app_browser()
    if not exe:
        return None
    profile = os.path.join(CACHE, 'app-window')
    os.makedirs(profile, exist_ok=True)
    subprocess.Popen([exe, '--app=' + url + '?app=1', '--user-data-dir=' + profile] + APP_FLAGS, close_fds=True)
    return os.path.basename(exe)


def open_ui(url):
    if not open_app_window(url):
        webbrowser.open(url)


def already_running(port):
    try:
        with urllib.request.urlopen('http://127.0.0.1:%d/api/health' % port, timeout=1.5) as r:
            return json.loads(r.read()).get('app') == 'astropulse'
    except Exception:
        return False


def stop_when_idle(server):
    while True:
        time.sleep(15)
        if time.time() - _last_seen[0] > IDLE_LIMIT:
            server.shutdown()
            return


def main(launch=False):
    args = [a for a in sys.argv[1:] if a.isdigit()]
    launch = launch or '--open' in sys.argv
    first = int(args[0]) if args else 8000
    server = None
    for port in range(first, first + 20):
        if already_running(port):
            if launch:
                open_ui('http://127.0.0.1:%d/' % port)
            return
        try:
            server = ThreadingHTTPServer(('127.0.0.1', port), Handler)
            break
        except OSError:
            continue
    if server is None:
        raise SystemExit('No free port between %d and %d.' % (first, first + 19))
    url = 'http://127.0.0.1:%d/' % server.server_address[1]
    if sys.stdout:
        print('AstroPulse on ' + url)
    if launch:
        threading.Timer(0.5, open_ui, [url]).start()
        threading.Thread(target=stop_when_idle, args=(server,), daemon=True).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
