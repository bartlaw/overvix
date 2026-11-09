import asyncio
import json
import subprocess
import urllib.request
import websockets

async def test_beacon():
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
            await asyncio.sleep(2.5)
            
            # Switch to 5D
            await send_eval("switchCorrTf('5D', true)")
            await asyncio.sleep(1)

            # Test 1: Click Beacon on Overvix chart (Trace 5)
            click_trace5 = await send_eval('''(() => {
                const el = document.getElementById('overvix-chart');
                el.emit('plotly_click', {
                    points: [{
                        curveNumber: 5,
                        pointIndex: 0
                    }]
                });
                const pill = document.getElementById('anchor-status-pill');
                const banner = document.getElementById('corr-recovery-banner');
                const chart = document.getElementById('correlation-chart');
                const residTrace = chart && chart.data ? chart.data.find(t => t.name === 'Overvix Residual' && t.yaxis === 'y3') : null;
                return {
                    mode: corrAnchor.mode,
                    pillText: pill ? pill.textContent : null,
                    bannerText: banner ? banner.innerText : null,
                    spotBase: corrAnchor.spotBase,
                    volBase: corrAnchor.volBase,
                    lastResidVal: residTrace && residTrace.y ? residTrace.y.slice(-1)[0] : null,
                    lastResidCustom: residTrace && residTrace.customdata ? residTrace.customdata.slice(-1)[0] : null
                };
            })()''')
            print("Test 1 (Click Trace 5 Session Beacon):", json.dumps(click_trace5, indent=2))
            
            await asyncio.sleep(0.5)

            # Test 2: Click tip of Intraday Path (Trace 4 last point)
            click_trace4_tip = await send_eval('''(() => {
                const el = document.getElementById('overvix-chart');
                const trailLen = cachedTrail && cachedTrail.x ? cachedTrail.x.length : 390;
                el.emit('plotly_click', {
                    points: [{
                        curveNumber: 4,
                        pointIndex: trailLen - 1,
                        text: '15:55'
                    }]
                });
                const pill = document.getElementById('anchor-status-pill');
                const banner = document.getElementById('corr-recovery-banner');
                const chart = document.getElementById('correlation-chart');
                const residTrace = chart && chart.data ? chart.data.find(t => t.name === 'Overvix Residual' && t.yaxis === 'y3') : null;
                return {
                    mode: corrAnchor.mode,
                    pillText: pill ? pill.textContent : null,
                    bannerText: banner ? banner.innerText : null,
                    spotBase: corrAnchor.spotBase,
                    volBase: corrAnchor.volBase,
                    lastResidVal: residTrace && residTrace.y ? residTrace.y.slice(-1)[0] : null,
                    lastResidCustom: residTrace && residTrace.customdata ? residTrace.customdata.slice(-1)[0] : null
                };
            })()''')
            print("Test 2 (Click Trace 4 Tip):", json.dumps(click_trace4_tip, indent=2))

            await asyncio.sleep(0.5)

            # Test 3: Click intermediate point on Intraday Path (e.g. 11:30)
            click_mid = await send_eval('''(() => {
                const el = document.getElementById('overvix-chart');
                el.emit('plotly_click', {
                    points: [{
                        curveNumber: 4,
                        pointIndex: 120,
                        text: '11:30'
                    }]
                });
                const pill = document.getElementById('anchor-status-pill');
                return {
                    mode: corrAnchor.mode,
                    time: corrAnchor.time,
                    pillText: pill ? pill.textContent : null
                };
            })()''')
            print("Test 3 (Click Intermediate Point 11:30):", json.dumps(click_mid, indent=2))

    finally:
        proc.kill()

if __name__ == '__main__':
    asyncio.run(test_beacon())
