import asyncio
import base64
import json
import subprocess
import urllib.request
import websockets

async def test_layout():
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

            # 1. State: Baseline (Open)
            pos_baseline = await send_eval('''(() => {
                const btnOpen = document.getElementById('btn-anchor-open').getBoundingClientRect();
                const btnPriorClose = document.getElementById('btn-anchor-prior-close').getBoundingClientRect();
                const btnSpotLow = document.getElementById('btn-anchor-spot-low').getBoundingClientRect();
                const pill = document.getElementById('anchor-status-pill');
                return {
                    pillText: pill.textContent.trim(),
                    openLeft: btnOpen.left,
                    priorCloseLeft: btnPriorClose.left,
                    spotLowLeft: btnSpotLow.left
                };
            })()''')
            print('1. Baseline Button Positions:', json.dumps(pos_baseline, indent=2))

            # 2. State: Prior Close clicked (long pill text)
            await send_eval("document.getElementById('btn-anchor-prior-close').click()")
            await asyncio.sleep(0.5)

            pos_prior_close = await send_eval('''(() => {
                const btnOpen = document.getElementById('btn-anchor-open').getBoundingClientRect();
                const btnPriorClose = document.getElementById('btn-anchor-prior-close').getBoundingClientRect();
                const btnSpotLow = document.getElementById('btn-anchor-spot-low').getBoundingClientRect();
                const pill = document.getElementById('anchor-status-pill');
                return {
                    pillText: pill.textContent.trim(),
                    openLeft: btnOpen.left,
                    priorCloseLeft: btnPriorClose.left,
                    spotLowLeft: btnSpotLow.left
                };
            })()''')
            print('2. Prior Close Button Positions:', json.dumps(pos_prior_close, indent=2))

            # 3. State: Nov 04 clicked (historical session close, even longer text)
            await send_eval('''(() => {
                const el = document.getElementById('overvix-chart');
                el.emit('plotly_click', { points: [{ curveNumber: 0, pointIndex: 0, text: '2026-11-04' }] });
            })()''')
            await asyncio.sleep(0.5)

            pos_nov04 = await send_eval('''(() => {
                const btnOpen = document.getElementById('btn-anchor-open').getBoundingClientRect();
                const btnPriorClose = document.getElementById('btn-anchor-prior-close').getBoundingClientRect();
                const btnSpotLow = document.getElementById('btn-anchor-spot-low').getBoundingClientRect();
                const pill = document.getElementById('anchor-status-pill');
                return {
                    pillText: pill.textContent.trim(),
                    openLeft: btnOpen.left,
                    priorCloseLeft: btnPriorClose.left,
                    spotLowLeft: btnSpotLow.left
                };
            })()''')
            print('3. Nov 04 Date Close Button Positions:', json.dumps(pos_nov04, indent=2))

            # Check if button positions moved AT ALL
            open_shift = abs(pos_baseline['openLeft'] - pos_prior_close['openLeft']) + abs(pos_baseline['openLeft'] - pos_nov04['openLeft'])
            prior_close_shift = abs(pos_baseline['priorCloseLeft'] - pos_prior_close['priorCloseLeft']) + abs(pos_baseline['priorCloseLeft'] - pos_nov04['priorCloseLeft'])
            print(f'\n-> Total Button Coordinate Shift: Open = {open_shift}px, Prior Close = {prior_close_shift}px')

            # Capture screenshot
            await ws.send(json.dumps({'id': 50, 'method': 'Page.captureScreenshot', 'params': {'format': 'png'}}))
            while True:
                resp = json.loads(await ws.recv())
                if resp.get('id') == 50:
                    img_data = base64.b64decode(resp['result']['data'])
                    out_path = r'C:\Users\barla\.gemini\antigravity\brain\44bf4845-2eea-4a88-8c77-148ad69ac382\screenshot_two_tier_command_deck.png'
                    with open(out_path, 'wb') as f:
                        f.write(img_data)
                    print(f'Screenshot saved to {out_path}')
                    break

    finally:
        proc.kill()

asyncio.run(test_layout())
