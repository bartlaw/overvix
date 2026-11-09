import asyncio
import base64
import json
import subprocess
import urllib.request
import websockets

async def check_desktop():
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

            results = []
            for tf in ['1D', '5D', '1M', '3M', '6M', 'YTD', '1Y', 'MAX']:
                await send_eval(f"switchCorrTf('{tf}', true)")
                await asyncio.sleep(0.3)
                coords = await send_eval('''(() => {
                    const title = document.getElementById('corr-title').getBoundingClientRect();
                    const slider = document.querySelector('.timeframe-slider-wrapper').getBoundingClientRect();
                    const btnScale = document.getElementById('btn-corr-scale').getBoundingClientRect();
                    const btnInvert = document.getElementById('btn-corr-invert').getBoundingClientRect();
                    const card = document.getElementById('correlation-chart').parentElement.getBoundingClientRect();
                    return {
                        titleLeft: title.left,
                        titleTop: title.top,
                        sliderLeft: slider.left,
                        sliderTop: slider.top,
                        sliderWidth: slider.width,
                        btnScaleLeft: btnScale.left,
                        btnInvertLeft: btnInvert.left,
                        distanceFromRight: card.right - btnInvert.right,
                        sameRow: Math.abs(title.top - slider.top) < 15
                    };
                })()''')
                results.append((tf, coords))

            for tf, c in results:
                print(f"{tf:4s} -> Same Row: {c['sameRow']} | Title Left: {c['titleLeft']:.1f} | Slider Left: {c['sliderLeft']:.1f} | Scale Left: {c['btnScaleLeft']:.1f} | Invert Left: {c['btnInvertLeft']:.1f} | Right Dist: {c['distanceFromRight']:.1f}")

            # Capture screenshot
            await ws.send(json.dumps({'id': 50, 'method': 'Page.captureScreenshot', 'params': {'format': 'png'}}))
            while True:
                resp = json.loads(await ws.recv())
                if resp.get('id') == 50:
                    img_data = base64.b64decode(resp['result']['data'])
                    out_path = r'C:\Users\barla\.gemini\antigravity\brain\44bf4845-2eea-4a88-8c77-148ad69ac382\screenshot_desktop_anchored_right.png'
                    with open(out_path, 'wb') as f:
                        f.write(img_data)
                    print(f'Desktop Screenshot saved to {out_path}')
                    break

    finally:
        proc.kill()

asyncio.run(check_desktop())
