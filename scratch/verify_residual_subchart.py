import asyncio
import base64
import json
import subprocess
import urllib.request
import websockets

async def verify():
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

            # Scroll chart into view
            await send_eval('''(() => {
                document.getElementById('correlation-chart').scrollIntoView();
            })()''')
            await asyncio.sleep(0.5)

            # 1. Capture 1D Unanchored
            info1d = await send_eval('''(() => {
                const chart = document.getElementById('correlation-chart');
                return {
                    title: document.getElementById('corr-title').textContent,
                    sub: document.getElementById('corr-subtitle').textContent,
                    liveVal: document.getElementById('corr-live-val').textContent,
                    liveLabel: document.getElementById('corr-live-label').textContent,
                    statusPill: document.getElementById('corr-status-pill').textContent,
                    traces: chart.data.map(d => ({ name: d.name, yaxis: d.yaxis, fill: d.fill })),
                    y3Range: chart.layout.yaxis3.range,
                    y3Title: chart.layout.yaxis3.title.text
                };
            })()''')
            print("1D Info:", json.dumps(info1d, indent=2))
            await take_screenshot("screenshot_residual_1d_unanchored.png")

            # 2. Test 1D Anchoring (SPX Low)
            await send_eval('''(() => {
                document.getElementById('btn-anchor-spot-low').click();
            })()''')
            await asyncio.sleep(1)
            info_anchor = await send_eval('''(() => {
                const banner = document.getElementById('corr-recovery-banner');
                return {
                    bannerText: banner.innerText,
                    liveVal: document.getElementById('corr-live-val').textContent,
                    statusPill: document.getElementById('corr-status-pill').textContent
                };
            })()''')
            print("1D Anchored Info:", json.dumps(info_anchor, indent=2))
            await take_screenshot("screenshot_residual_1d_anchored.png")

            # 3. Test 5D Timeframe
            await send_eval('''(() => {
                switchCorrTf('5D', true);
            })()''')
            await asyncio.sleep(1)
            info_5d = await send_eval('''(() => {
                return {
                    title: document.getElementById('corr-title').textContent,
                    sub: document.getElementById('corr-subtitle').textContent,
                    liveVal: document.getElementById('corr-live-val').textContent,
                    statusPill: document.getElementById('corr-status-pill').textContent
                };
            })()''')
            print("5D Info:", json.dumps(info_5d, indent=2))
            await take_screenshot("screenshot_residual_5d.png")

            # 4. Test NDX·VXN Asset Switch
            await send_eval('''(() => {
                document.getElementById('btn-asset-ndx').click();
            })()''')
            await asyncio.sleep(1)
            info_ndx = await send_eval('''(() => {
                const chart = document.getElementById('correlation-chart');
                return {
                    title: document.getElementById('corr-title').textContent,
                    sub: document.getElementById('corr-subtitle').textContent,
                    liveVal: document.getElementById('corr-live-val').textContent,
                    statusPill: document.getElementById('corr-status-pill').textContent,
                    y3Title: chart.layout.yaxis3.title.text
                };
            })()''')
            print("NDX Info:", json.dumps(info_ndx, indent=2))
            await take_screenshot("screenshot_residual_ndx.png")

    finally:
        proc.terminate()

if __name__ == "__main__":
    asyncio.run(verify())
