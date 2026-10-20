# Headless check: satellites render & move, no console errors, screenshots.
# usage: python3 verify.py URL OUT.png [--mobile] [--block-celestrak] [--select] [--speed=600] [--size=WxH]
import sys, time, json
from playwright.sync_api import sync_playwright
url, out = sys.argv[1], sys.argv[2]
flags = sys.argv[3:]
mobile = '--mobile' in flags
size = next((f[7:] for f in flags if f.startswith('--size=')), None)
w, h = (390, 844) if mobile else (1600, 900)
if size: w, h = map(int, size.split('x'))
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    ctx = b.new_context(viewport={'width': w, 'height': h}, device_scale_factor=3 if mobile else (1 if size else 2) , is_mobile=mobile, has_touch=mobile)
    pg = ctx.new_page()
    if '--block-celestrak' in flags:
        pg.route('**/celestrak.org/**', lambda r: r.abort())
    errs = []
    pg.on('console', lambda m: errs.append(f'{m.type}: {m.text}') if m.type in ('error', 'warning') else None)
    pg.on('pageerror', lambda e: errs.append(f'pageerror: {e}'))
    pg.on('requestfailed', lambda r: errs.append(f'requestfailed: {r.url}') if 'celestrak' not in r.url else None)
    pg.goto(url, wait_until='load')
    pg.wait_for_function('window.__debug && window.__debug().valid > 0', timeout=90000)
    a = pg.evaluate('window.__debug()'); time.sleep(2); c = pg.evaluate('window.__debug()')
    print('source:', a['source'], 'valid:', a['valid'], 'workerMs:', round(a['workerMs'] or 0, 1))
    print('moved:', a['first'] != c['first'])
    sp = next((f[8:] for f in flags if f.startswith('--speed=')), None)
    if sp: pg.click(f'button[data-speed="{sp}"]')
    time.sleep(4)
    if '--select' in flags:
        print('selected:', pg.evaluate('window.__selectFresh() || window.__selectBest()'))
        time.sleep(3)
        print('info:', pg.inner_text('#info').replace('\n', ' | '))
    fps = pg.evaluate('new Promise(r=>{let n=0,t0=performance.now();function f(){n++; if(performance.now()-t0<2000) requestAnimationFrame(f); else r(n/2)} requestAnimationFrame(f)})')
    print('fps (swiftshader, software GL):', fps)
    pg.screenshot(path=out)
    print('count:', pg.inner_text('#count'), '|', pg.inner_text('.count span'))
    print('errors:', errs)
    b.close()
