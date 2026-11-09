import asyncio
import json
import subprocess
import urllib.request
import websockets

async def test_real_cdp_mouse():
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

            async def send_mouse(evt_type, x, y, button='none'):
                nonlocal mid
                mid += 1
                await ws.send(json.dumps({
                    'id': mid,
                    'method': 'Input.dispatchMouseEvent',
                    'params': {
                        'type': evt_type,
                        'x': x,
                        'y': y,
                        'button': button,
                        'clickCount': 1 if evt_type == 'mousePressed' else 0
                    }
                }))
                while True:
                    resp = json.loads(await ws.recv())
                    if resp.get('id') == mid:
                        return resp

            await ws.send(json.dumps({'id': 10, 'method': 'Page.enable'}))
            await asyncio.sleep(2.0)

            # Attach a global hover & click tracker on overvix-chart
            await send_eval('''(() => {
                window._lastPlotlyHover = null;
                window._lastPlotlyClick = null;
                const gd = document.getElementById('overvix-chart');
                gd.on('plotly_hover', d => { window._lastPlotlyHover = d.points[0]; });
                gd.on('plotly_click', d => { window._lastPlotlyClick = d.points[0]; });
                gd.on('plotly_unhover', () => { window._lastPlotlyHover = null; });
            })()''')

            # Get exact bounding boxes of 11-05 (top-left) and 11-04 (bottom-right)
            coords = await send_eval('''(() => {
                const gd = document.getElementById('overvix-chart');
                const t0 = gd.data[0];
                const dates = t0.text;
                const idx1105 = dates.indexOf('2026-11-05');
                const idx1104 = dates.indexOf('2026-11-04');
                const points = gd.querySelectorAll('.scatterlayer .trace:nth-child(1) .point');
                const p1105 = points[idx1105].getBoundingClientRect();
                const p1104 = points[idx1104].getBoundingClientRect();

                return {
                    pt1105: { x: p1105.left + p1105.width/2, y: p1105.top + p1105.height/2 },
                    pt1104: { x: p1104.left + p1104.width/2, y: p1104.top + p1104.height/2 }
                };
            })()''')
            print('Point Coordinates:', json.dumps(coords, indent=2))

            # Test 1: Hover at exact center of 11-05
            p = coords['pt1105']
            for dy in [-20, -10, 0, 5, 10, 15, 20]:
                await send_mouse('mouseMoved', p['x'], p['y'] + dy)
                await asyncio.sleep(0.1)
                h = await send_eval("window._lastPlotlyHover ? { curve: window._lastPlotlyHover.curveNumber, pt: window._lastPlotlyHover.pointIndex, text: window._lastPlotlyHover.text } : null")
                print(f"11-05 at dy={dy:+3d}px: Hover = {h}")

            print("---")
            # Test 2: Hover at exact center of 11-04
            p4 = coords['pt1104']
            for dy in [-20, -10, 0, 5, 10, 15, 20]:
                await send_mouse('mouseMoved', p4['x'], p4['y'] + dy)
                await asyncio.sleep(0.1)
                h = await send_eval("window._lastPlotlyHover ? { curve: window._lastPlotlyHover.curveNumber, pt: window._lastPlotlyHover.pointIndex, text: window._lastPlotlyHover.text } : null")
                print(f"11-04 at dy={dy:+3d}px: Hover = {h}")

    finally:
        proc.kill()

asyncio.run(test_real_cdp_mouse())
