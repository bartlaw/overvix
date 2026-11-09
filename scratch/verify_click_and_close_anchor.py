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
                await ws.send(json.dumps({'id': mid, 'method': 'Runtime.evaluate', 'params': {'expression': expr, 'returnByValue': True, 'awaitPromise': True}}))
                while True:
                    resp = json.loads(await ws.recv())
                    if resp.get('id') == mid:
                        if 'exceptionDetails' in resp.get('result', {}):
                            print("Eval Exception:", resp['result']['exceptionDetails'])
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

            # 1. Switch to 5D timeframe
            print("--- Testing 5D Timeframe ---")
            await send_eval("switchCorrTf('5D', true)")
            await asyncio.sleep(1)

            # 2. Click Prior Close
            res_prior = await send_eval('''(() => {
                const btn = document.getElementById('btn-anchor-prior-close');
                if (btn) btn.click();
                const pill = document.getElementById('anchor-status-pill');
                const banner = document.getElementById('corr-recovery-banner');
                return {
                    pillText: pill ? pill.textContent : null,
                    bannerText: banner ? banner.innerText : null,
                    mode: corrAnchor.mode,
                    time: corrAnchor.time,
                    active: corrAnchor.active
                };
            })()''')
            print("Prior Close result:", json.dumps(res_prior, indent=2))
            await asyncio.sleep(0.5)

            # Scroll into correlation chart view & take screenshot
            await send_eval('''(() => {
                const el = document.getElementById('correlation-chart');
                if (el) el.scrollIntoView({ behavior: 'instant', block: 'center' });
            })()''')
            await asyncio.sleep(0.5)
            await take_screenshot("screenshot_prior_close_5d.png")

            # 3. Click Close
            res_close = await send_eval('''(() => {
                const btn = document.getElementById('btn-anchor-close');
                if (btn) btn.click();
                const pill = document.getElementById('anchor-status-pill');
                const banner = document.getElementById('corr-recovery-banner');
                return {
                    pillText: pill ? pill.textContent : null,
                    bannerText: banner ? banner.innerText : null,
                    mode: corrAnchor.mode,
                    time: corrAnchor.time,
                    active: corrAnchor.active
                };
            })()''')
            print("Close result:", json.dumps(res_close, indent=2))
            await asyncio.sleep(0.5)
            await take_screenshot("screenshot_close_5d.png")

            # 4. Test Cross-chart click on Spot-Vol Regression
            print("--- Testing Cross-Chart Click on Spot-Vol Regression ---")
            click_res = await send_eval('''(() => {
                const el = document.getElementById('overvix-chart');
                if (!el) return { error: 'No overvix-chart' };
                // Simulate plotly_click on Intraday Path (curve 4) at '12:00'
                const clickHandler = el._events && el._events.plotly_click;
                // Emit click
                el.emit('plotly_click', {
                    points: [{
                        curveNumber: 4,
                        text: '12:00'
                    }]
                });
                const pill = document.getElementById('anchor-status-pill');
                return {
                    anchorMode: corrAnchor.mode,
                    anchorTime: corrAnchor.time,
                    anchorLabel: corrAnchor.label,
                    pillText: pill ? pill.textContent : null
                };
            })()''')
            print("Intraday click result:", json.dumps(click_res, indent=2))
            await asyncio.sleep(0.5)
            await take_screenshot("screenshot_cross_click_anchor.png")

            # 5. Check tooltip formatting on correlation chart
            tooltip_check = await send_eval('''(() => {
                const el = document.getElementById('correlation-chart');
                if (!el || !el.data) return { error: 'No chart data' };
                const assetTrace = el.data.find(t => t.name && (t.name.includes('SPX %') || t.name.includes('NDX %')));
                const volTrace = el.data.find(t => t.name && (t.name.includes('VIX Pt') || t.name.includes('VXN Pt')));
                return {
                    assetName: assetTrace ? assetTrace.name : null,
                    volName: volTrace ? volTrace.name : null,
                    assetHoverFmt: assetTrace ? assetTrace.hovertemplate : null,
                    volHoverFmt: volTrace ? volTrace.hovertemplate : null,
                    assetSampleCustom: assetTrace && assetTrace.customdata ? assetTrace.customdata.slice(-3) : null,
                    volSampleCustom: volTrace && volTrace.customdata ? volTrace.customdata.slice(-3) : null
                };
            })()''')
            print("Tooltip formatting check:", json.dumps(tooltip_check, indent=2))

    finally:
        proc.kill()

if __name__ == '__main__':
    asyncio.run(verify())
