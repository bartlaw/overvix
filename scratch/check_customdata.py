import asyncio
import json
import subprocess
import urllib.request
import websockets

async def check_customdata():
    proc = subprocess.Popen([
        r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
        '--remote-debugging-port=9222',
        '--headless=new',
        '--disable-gpu',
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

            # Switch to 5D
            await send_eval("switchCorrTf('5D', true)")
            await asyncio.sleep(0.8)

            # Click beacon
            await send_eval('''(() => {
                const el = document.getElementById('overvix-chart');
                el.emit('plotly_click', { points: [{ curveNumber: 5, pointIndex: 0 }] });
            })()''')
            await asyncio.sleep(0.5)

            # Check customdata array at the latest bar
            tooltip_info = await send_eval('''(() => {
                const chart = document.getElementById('correlation-chart');
                const traceAsset = chart.data.find(t => t.name && t.name.includes('SPX'));
                const traceVol = chart.data.find(t => t.name && t.name.includes('VIX'));
                const traceResid = chart.data.find(t => t.name && t.name.includes('Residual'));
                const n = traceAsset.x.length;
                return {
                    latestTime: traceAsset.x[n - 1],
                    assetHoverFmt: traceAsset.hovertemplate,
                    assetCustomdataLast: traceAsset.customdata[n - 1],
                    volHoverFmt: traceVol.hovertemplate,
                    volCustomdataLast: traceVol.customdata[n - 1],
                    residHoverFmt: traceResid.hovertemplate,
                    residCustomdataLast: traceResid.customdata[n - 1]
                };
            })()''')
            print('Tooltip Info:', json.dumps(tooltip_info, indent=2))

    finally:
        proc.kill()

asyncio.run(check_customdata())
