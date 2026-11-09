import asyncio
import json
import subprocess
import urllib.request
import websockets

async def check_slider_shift():
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

            results = []
            for tf in ['1D', '5D', '1M', '3M', '6M', 'YTD', '1Y', 'MAX']:
                await send_eval(f"switchCorrTf('{tf}', true)")
                await asyncio.sleep(0.3)
                coords = await send_eval('''(() => {
                    const slider = document.querySelector('.timeframe-slider-wrapper').getBoundingClientRect();
                    const btnScale = document.getElementById('btn-corr-scale').getBoundingClientRect();
                    const btnInvert = document.getElementById('btn-corr-invert').getBoundingClientRect();
                    const card = document.getElementById('correlation-chart').parentElement.getBoundingClientRect();
                    return {
                        sliderLeft: slider.left,
                        sliderWidth: slider.width,
                        btnScaleLeft: btnScale.left,
                        btnInvertLeft: btnInvert.left,
                        distanceFromRight: card.right - btnInvert.right
                    };
                })()''')
                results.append((tf, coords))

            for tf, c in results:
                print(f"{tf:4s} -> Slider Left: {c['sliderLeft']:.1f}, Width: {c['sliderWidth']:.1f} | Scale Left: {c['btnScaleLeft']:.1f} | Invert Left: {c['btnInvertLeft']:.1f} | Right Dist: {c['distanceFromRight']:.1f}")

    finally:
        proc.kill()

asyncio.run(check_slider_shift())
