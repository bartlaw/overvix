import asyncio
import json
import subprocess
import urllib.request
import websockets

async def test_fix():
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

            # Apply the fix in browser runtime:
            # 1. Update traces 1, 2, 3 to hoverinfo: 'skip'
            # 2. Update layout to hovermode: 'closest', hoverdistance: 35
            await send_eval('''(() => {
                const gd = document.getElementById('overvix-chart');
                Plotly.restyle(gd, { hoverinfo: 'skip' }, [1, 2, 3]);
                Plotly.relayout(gd, { hovermode: 'closest', hoverdistance: 35 });
            })()''')

            # Attach hover tracker
            await send_eval('''(() => {
                window._lastPlotlyHover = null;
                const gd = document.getElementById('overvix-chart');
                gd.on('plotly_hover', d => { window._lastPlotlyHover = d.points[0]; });
                gd.on('plotly_unhover', () => { window._lastPlotlyHover = null; });
            })()''')

            # Get coordinates of 11-05
            coords = await send_eval('''(() => {
                const gd = document.getElementById('overvix-chart');
                const t0 = gd.data[0];
                const dates = t0.text;
                const idx1105 = dates.indexOf('2026-11-05');
                const points = gd.querySelectorAll('.scatterlayer .trace:nth-child(1) .point');
                const p1105 = points[idx1105].getBoundingClientRect();
                return { x: p1105.left + p1105.width/2, y: p1105.top + p1105.height/2 };
            })()''')

            print('Testing 11-05 after hoverinfo:skip fix...')
            for dy in [-15, -10, -5, 0, 5, 10, 15]:
                await send_mouse('mouseMoved', coords['x'], coords['y'] + dy)
                await asyncio.sleep(0.08)
                h = await send_eval("window._lastPlotlyHover ? { curve: window._lastPlotlyHover.curveNumber, text: window._lastPlotlyHover.text } : null")
                print(f"dy={dy:+3d}px: Hover = {h}")

            # Get coordinates of 11-04
            coords4 = await send_eval('''(() => {
                const gd = document.getElementById('overvix-chart');
                const t0 = gd.data[0];
                const dates = t0.text;
                const idx1104 = dates.indexOf('2026-11-04');
                const points = gd.querySelectorAll('.scatterlayer .trace:nth-child(1) .point');
                const p1104 = points[idx1104].getBoundingClientRect();
                return { x: p1104.left + p1104.width/2, y: p1104.top + p1104.height/2 };
            })()''')

            print('\nTesting 11-04 after hoverinfo:skip fix...')
            for dy in [-15, -10, -5, 0, 5, 10, 15]:
                await send_mouse('mouseMoved', coords4['x'], coords4['y'] + dy)
                await asyncio.sleep(0.08)
                h = await send_eval("window._lastPlotlyHover ? { curve: window._lastPlotlyHover.curveNumber, text: window._lastPlotlyHover.text } : null")
                print(f"dy={dy:+3d}px: Hover = {h}")

    finally:
        proc.kill()

asyncio.run(test_fix())
