import asyncio
import json
import subprocess
import urllib.request
import websockets

async def test_plotly_hover_math():
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

            # Let's test Plotly's Fx.hover at the exact mathematical data coordinates of 11-05 and 11-04
            hit_results = await send_eval('''(() => {
                const gd = document.getElementById('overvix-chart');
                const t0 = gd.data[0];
                const dates = t0.text;
                const idx1105 = dates.indexOf('2026-11-05');
                const idx1104 = dates.indexOf('2026-11-04');
                const p1105 = { x: t0.x[idx1105], y: t0.y[idx1105] };
                const p1104 = { x: t0.x[idx1104], y: t0.y[idx1104] };

                // Get pixel coordinates from axes
                const xa = gd._fullLayout.xaxis;
                const ya = gd._fullLayout.yaxis;
                
                // Plotly axis pixel mapping
                const calcPixel1105 = {
                    x: xa.c2p(p1105.x) + gd._fullLayout.margin.l,
                    y: ya.c2p(p1105.y) + gd._fullLayout.margin.t
                };

                const calcPixel1104 = {
                    x: xa.c2p(p1104.x) + gd._fullLayout.margin.l,
                    y: ya.c2p(p1104.y) + gd._fullLayout.margin.t
                };

                // Get SVG DOM element coordinates
                const points = gd.querySelectorAll('.scatterlayer .trace:nth-child(1) .point');
                const el1105 = points[idx1105];
                const el1104 = points[idx1104];
                const chartBox = gd.getBoundingClientRect();
                
                const domPixel1105 = el1105 ? {
                    x: el1105.getBoundingClientRect().x + el1105.getBoundingClientRect().width/2 - chartBox.left,
                    y: el1105.getBoundingClientRect().y + el1105.getBoundingClientRect().height/2 - chartBox.top
                } : null;

                const domPixel1104 = el1104 ? {
                    x: el1104.getBoundingClientRect().x + el1104.getBoundingClientRect().width/2 - chartBox.left,
                    y: el1104.getBoundingClientRect().y + el1104.getBoundingClientRect().height/2 - chartBox.top
                } : null;

                return {
                    p1105,
                    calcPixel1105,
                    domPixel1105,
                    diff1105: {
                        dx: domPixel1105.x - calcPixel1105.x,
                        dy: domPixel1105.y - calcPixel1105.y
                    },
                    p1104,
                    calcPixel1104,
                    domPixel1104,
                    diff1104: {
                        dx: domPixel1104.x - calcPixel1104.x,
                        dy: domPixel1104.y - calcPixel1104.y
                    }
                };
            })()''')
            print('Pixel Comparison:', json.dumps(hit_results, indent=2))

    finally:
        proc.kill()

asyncio.run(test_plotly_hover_math())
