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
            
            await ws.send(json.dumps({'id': 10, 'method': 'Page.enable'}))
            await asyncio.sleep(2)
            
            # Switch to 5D and apply custom script
            test_js = """(() => {
                switchCorrTf('5D');
                const chart = document.getElementById('correlation-chart');
                chart.scrollIntoView({ behavior: 'instant', block: 'center' });
                
                const c = cachedCorr['5D'];
                const times = c.times;
                const spotRaw = c.spx_raw || c.spot_raw;
                const volRaw = c.vix_raw || c.vol_raw;
                
                // Let's anchor to Nov 05 15:55 like the user
                setCorrAnchor('custom', '2026-11-05 15:55');
                
                return { done: true };
            })()"""
            await send_eval(test_js)
            await asyncio.sleep(1)

            # Screenshot
            mid += 1
            await ws.send(json.dumps({'id': mid, 'method': 'Page.captureScreenshot', 'params': {'format': 'png'}}))
            while True:
                resp = json.loads(await ws.recv())
                if resp.get('id') == mid:
                    img_data = base64.b64decode(resp['result']['data'])
                    with open(r'C:\Users\barla\.gemini\antigravity\brain\44bf4845-2eea-4a88-8c77-148ad69ac382\screenshot_user_scenario.png', 'wb') as f:
                        f.write(img_data)
                    print('Saved screenshot_user_scenario.png')
                    break
    finally:
        proc.terminate()

asyncio.run(check())
