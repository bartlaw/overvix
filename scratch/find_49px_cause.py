import asyncio
import json
import subprocess
import urllib.request
import websockets

async def find_49px_cause():
    proc = subprocess.Popen([
        r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
        '--remote-debugging-port=9222',
        '--headless=new',
        '--disable-gpu',
        '--window-size=1920,1080',
        'http://127.0.0.1:8000'
    ])
    await asyncio.sleep(2.5)
    try:
        targets_res = urllib.request.urlopen('http://127.0.0.1:9222/json')
        targets = json.loads(targets_res.read())
        page_target = next(t for t in targets if t.get('type') == 'page' and '8000' in t.get('url', ''))
        async with websockets.connect(page_target['webSocketDebuggerUrl']) as ws:
            mid = 1
            async def send_eval(expr):
                nonlocal mid
                mid += 1
                await ws.send(json.dumps({'id': mid, 'method': 'Runtime.evaluate', 'params': {'expression': expr, 'returnByValue': True, 'awaitPromise': True}}))
                while True:
                    resp = json.loads(await ws.recv())
                    if resp.get('id') == mid:
                        if 'exceptionDetails' in resp.get('result', {}):
                            print('Eval Error:', resp['result']['exceptionDetails'])
                        return resp.get('result', {}).get('result', {}).get('value')

            await ws.send(json.dumps({'id': 10, 'method': 'Page.enable'}))
            await asyncio.sleep(2.0)

            dom_inspect = await send_eval('''(() => {
                const gd = document.getElementById('overvix-chart');
                const fl = gd._fullLayout;
                const plotBox = gd.querySelector('.plot-container');
                const svgMain = gd.querySelector('svg.main-svg');
                const svgSubplot = gd.querySelector('.xy');
                const legend = gd.querySelector('.legend');
                const nsewdrag = gd.querySelector('.nsewdrag');

                return {
                    flMargin: fl.margin,
                    flHeight: fl.height,
                    gdClientHeight: gd.clientHeight,
                    svgMainHeight: svgMain ? svgMain.getAttribute('height') : null,
                    legendBox: legend ? legend.getBoundingClientRect() : null,
                    nsewdragBox: nsewdrag ? nsewdrag.getBoundingClientRect() : null,
                    svgSubplotTransform: svgSubplot ? svgSubplot.getAttribute('transform') : null,
                    plotarea: fl._size
                };
            })()''')
            print('DOM Inspect:', json.dumps(dom_inspect, indent=2))

    finally:
        proc.kill()

asyncio.run(find_49px_cause())
