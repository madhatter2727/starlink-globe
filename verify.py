import sys, time, json
from playwright.sync_api import sync_playwright
url = sys.argv[1]; out = sys.argv[2] if len(sys.argv) > 2 else 'shot.png'
mobile = '--mobile' in sys.argv
clicks = '--click' in sys.argv
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'])
    ctx = b.new_context(viewport={'width':390,'height':844} if mobile else {'width':1600,'height':900}, device_scale_factor=2 if mobile else 1, is_mobile=mobile, has_touch=mobile)
    pg = ctx.new_page()
    errs = []
    pg.on('console', lambda m: errs.append(f'{m.type}: {m.text}') if m.type in ('error','warning') else None)
    pg.on('pageerror', lambda e: errs.append(f'pageerror: {e}'))
    pg.goto(url, wait_until='load')
    pg.wait_for_function('window.__debug && window.__debug().valid > 0', timeout=60000)
    a = pg.evaluate('window.__debug()'); time.sleep(2); bb = pg.evaluate('window.__debug()')
    print('debug1', json.dumps(a)); print('debug2', json.dumps(bb))
    moved = a['first'] != bb['first']
    print('moved', moved)
    time.sleep(3)
    if clicks:
        for _ in range(int(sys.argv[sys.argv.index('--click')+1])) if False else []: pass
    extra = [x for x in sys.argv if x.startswith('--eval=')]
    for e in extra:
        print('eval', pg.evaluate(e[7:])); time.sleep(1.5)
    pg.screenshot(path=out)
    try: print('count text:', pg.inner_text('#count'))
    except Exception: pass
    print('errors:', errs)
    b.close()
