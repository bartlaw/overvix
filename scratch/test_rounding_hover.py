import asyncio
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
            
            # Wait for readyState
            for _ in range(20):
                ready = await send_eval('document.readyState === "complete" && typeof switchCorrTf === "function"')
                if ready:
                    break
                await asyncio.sleep(0.5)
            
            code = """(() => {
                document.getElementById('correlation-chart').scrollIntoView({ behavior: 'instant', block: 'center' });
                switchCorrTf('5D');
                setCorrAnchor('custom', '2026-11-06 11:55');
                const chart = document.getElementById('correlation-chart');
                const c = cachedCorr['5D'];
                const idx1530 = c.times.findIndex(t => t.includes('11-06 15:30'));
                
                const assetIdx = chart.data.findIndex(t => t.name && t.name.includes('SPX'));
                const volIdx = chart.data.findIndex(t => t.yaxis === 'y2');
                
                Plotly.Fx.hover('correlation-chart', [
                    { curveNumber: assetIdx, pointNumber: idx1530 },
                    { curveNumber: volIdx, pointNumber: idx1530 }
                ]);
                const divs = Array.from(document.querySelectorAll('.hovertext text'));
                return {
                    time: c.times[idx1530],
                    hoverTexts: divs.map(d => d.textContent)
                };
            })()"""
            res = await send_eval(code)
            print(json.dumps(res, indent=2))
            await asyncio.sleep(1)

            await ws.send(json.dumps({'id': 50, 'method': 'Page.enable'}))
            mid += 1
            await ws.send(json.dumps({'id': mid, 'method': 'Page.captureScreenshot', 'params': {'format': 'png'}}))
            while True:
                resp = json.loads(await ws.recv())
                if resp.get('id') == mid:
                    import base64
                    img_data = base64.b64decode(resp['result']['data'])
                    with open(r'C:\Users\barla\.gemini\antigravity\brain\44bf4845-2eea-4a88-8c77-148ad69ac382\screenshot_hover_rounding_fixed.png', 'wb') as f:
                        f.write(img_data)
                    print('Saved screenshot_hover_rounding_fixed.png')
                    break
    finally:
        proc.terminate()

asyncio.run(check())
