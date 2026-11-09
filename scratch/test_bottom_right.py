import asyncio
import json
import subprocess
import urllib.request
import websockets

async def test_bottom_right():
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

            # Attach tracker
            await send_eval('''(() => {
                window._lastPlotlyHover = null;
                const gd = document.getElementById('overvix-chart');
                gd.on('plotly_hover', d => { window._lastPlotlyHover = d.points[0]; });
                gd.on('plotly_unhover', () => { window._lastPlotlyHover = null; });
            })()''')

            # Find points in the bottom right corner (positive x, negative y)
            br_points = await send_eval('''(() => {
                const gd = document.getElementById('overvix-chart');
                const t0 = gd.data[0];
                const res = [];
                for (let i = 0; i < t0.x.length; i++) {
                    if (t0.x[i] > 1.5 && t0.y[i] < -2.0) {
                        res.push({ i, date: t0.text[i], x: t0.x[i], y: t0.y[i] });
                    }
                }
                const ptElements = gd.querySelectorAll('.scatterlayer .trace:nth-child(1) .point');
                const trailElements = gd.querySelectorAll('.scatterlayer .trace:nth-child(5) .point');
                const beaconElement = gd.querySelector('.scatterlayer .trace:nth-child(6) .point');

                return {
                    res,
                    beaconPos: beaconElement ? beaconElement.getBoundingClientRect() : null
                };
            })()''')
            print('Bottom Right Points:', json.dumps(br_points, indent=2))

            # Also check Trace 5 (Beacon): where is the Beacon?
            #currX = +0.29%, currY = -2.62 pts!
            # The Session Close Beacon IS IN THE BOTTOM RIGHT QUADRANT!
            bPos = br_points['beaconPos']
            if bPos:
                bx = bPos['x'] + bPos['width'] / 2
                by = bPos['y'] + bPos['height'] / 2
                print(f"Testing Session Close Beacon at ({bx}, {by})...")
                for dy in [-20, -10, -5, 0, 5, 10, 15, 20]:
                    await send_mouse('mouseMoved', bx, by + dy)
                    await asyncio.sleep(0.1)
                    h = await send_eval("window._lastPlotlyHover ? { curve: window._lastPlotlyHover.curveNumber, pt: window._lastPlotlyHover.pointIndex, text: window._lastPlotlyHover.text } : null")
                    print(f"Beacon at dy={dy:+3d}px: Hover = {h}")

    finally:
        proc.kill()

asyncio.run(test_bottom_right())
