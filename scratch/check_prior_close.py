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
        '--window-size=1600,1600',
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
            await asyncio.sleep(2.5)
            
            # Switch to 5D
            await send_eval("switchCorrTf('5D', true)")
            await asyncio.sleep(1)
            
            # Click Prior Close button
            await send_eval("document.getElementById('btn-anchor-prior-close').click()")
            await asyncio.sleep(1)
            
            # Scroll correlation chart into view
            await send_eval("document.getElementById('correlation-chart').scrollIntoView({ behavior: 'instant', block: 'center' })")
            await asyncio.sleep(0.5)
            await take_screenshot("screenshot_prior_close_5d_exact_match.png")
    finally:
        proc.kill()

if __name__ == '__main__':
    asyncio.run(check())
