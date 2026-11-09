import asyncio
import base64
import json
import subprocess
import urllib.request
import websockets

async def check_close_btn():
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

            # Check that btn-anchor-close is gone and btn-anchor-prior-close remains
            btn_info = await send_eval('''(() => {
                const btnClose = document.getElementById('btn-anchor-close');
                const btnPriorClose = document.getElementById('btn-anchor-prior-close');
                const btnOpen = document.getElementById('btn-anchor-open');
                const scriptSrc = document.querySelector("script[src*='dashboard.js']").src;
                return {
                    btnCloseExists: !!btnClose,
                    btnPriorCloseExists: !!btnPriorClose,
                    btnOpenExists: !!btnOpen,
                    scriptSrc
                };
            })()''')
            print('Anchor Button Check:', json.dumps(btn_info, indent=2))

            # Test clicking Prior Close
            prior_close_res = await send_eval('''(() => {
                const btnPriorClose = document.getElementById('btn-anchor-prior-close');
                if (btnPriorClose) btnPriorClose.click();
                return {
                    anchorMode: corrAnchor.mode,
                    anchorPill: document.getElementById('anchor-status-pill').textContent
                };
            })()''')
            print('Prior Close Click Result:', json.dumps(prior_close_res, indent=2))

            # Capture screenshot
            await ws.send(json.dumps({'id': 50, 'method': 'Page.captureScreenshot', 'params': {'format': 'png'}}))
            while True:
                resp = json.loads(await ws.recv())
                if resp.get('id') == 50:
                    img_data = base64.b64decode(resp['result']['data'])
                    out_path = r'C:\Users\barla\.gemini\antigravity\brain\44bf4845-2eea-4a88-8c77-148ad69ac382\screenshot_no_close_button.png'
                    with open(out_path, 'wb') as f:
                        f.write(img_data)
                    print(f'Screenshot saved to {out_path}')
                    break

    finally:
        proc.kill()

asyncio.run(check_close_btn())
