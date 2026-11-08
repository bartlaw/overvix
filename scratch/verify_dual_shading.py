import asyncio
import base64
import json
import subprocess
import urllib.request
import websockets

async def check():
    proc = subprocess.Popen([
        r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
        '--remote-debugging-port=9222',
        '--headless=new',
        '--disable-gpu',
        '--window-size=1600,1400',
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
                await ws.send(json.dumps({'id': mid, 'method': 'Runtime.evaluate', 'params': {'expression': expr, 'returnByValue': True}}))
                while True:
                    resp = json.loads(await ws.recv())
                    if resp.get('id') == mid:
                        return resp.get('result', {}).get('result', {}).get('value')

            async def take_screenshot(filename):
                nonlocal mid
                mid += 1
                await ws.send(json.dumps({'id': mid, 'method': 'Page.captureScreenshot', 'params': {'format': 'png'}}))
                while True:
                    resp = json.loads(await ws.recv())
                    if resp.get('id') == mid:
                        img_data = base64.b64decode(resp['result']['data'])
                        with open(rf'C:\Users\barla\.gemini\antigravity\brain\44bf4845-2eea-4a88-8c77-148ad69ac382\{filename}', 'wb') as f:
                            f.write(img_data)
                        print(f'Saved {filename}')
                        break
            
            await ws.send(json.dumps({'id': 10, 'method': 'Page.enable'}))
            await asyncio.sleep(2)
            
            # 1. 1D Unanchored
            await send_eval('''(() => {
                document.getElementById('correlation-chart').scrollIntoView({ behavior: 'instant', block: 'center' });
                switchCorrTf('1D');
            })()''')
            await asyncio.sleep(1)
            await take_screenshot('screenshot_shading_1d.png')

            # 2. 5D Unanchored
            await send_eval('''(() => {
                switchCorrTf('5D');
            })()''')
            await asyncio.sleep(1)
            await take_screenshot('screenshot_shading_5d.png')

            # 3. 5D Anchored to Nov 05 15:55
            await send_eval('''(() => {
                setCorrAnchor('custom', '2026-11-05 15:55');
            })()''')
            await asyncio.sleep(1)
            await take_screenshot('screenshot_shading_5d_anchored.png')
    finally:
        proc.terminate()

asyncio.run(check())
