import asyncio
import base64
import json
import subprocess
import urllib.request
import websockets

async def main():
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
            await asyncio.sleep(2.5)

            # Check script src version
            script_src = await send_eval('document.querySelector("script[src*=\'dashboard.js\']").src')
            print('Dashboard Script Source in Browser:', script_src)

            # 1. Test 1D mode: click historical dot for 2026-11-05
            print('\n--- Testing 1D Mode Historical Click ---')
            await send_eval("switchCorrTf('1D', true)")
            await asyncio.sleep(0.5)

            click_1d_dot = await send_eval('''(() => {
                const el = document.getElementById('overvix-chart');
                el.emit('plotly_click', {
                    points: [{
                        curveNumber: 0,
                        pointIndex: 0,
                        text: '2026-11-05'
                    }]
                });
                return 'clicked';
            })()''')
            print('Simulated click on 2026-11-05 in 1D mode...')
            await asyncio.sleep(2.0)

            archive_state = await send_eval('''(() => {
                const banner = document.getElementById('historical-archive-banner');
                const bannerText = document.getElementById('historical-banner-text');
                const badge = document.getElementById('header-mode-badge');
                return {
                    currentViewMode,
                    selectedHistoricalDate,
                    bannerHidden: banner.classList.contains('hidden'),
                    bannerText: bannerText ? bannerText.textContent : null,
                    headerBadge: badge ? badge.textContent : null
                };
            })()''')
            print('Historical Archive Loaded:', json.dumps(archive_state, indent=2))

            # Return to live mode
            await send_eval('returnToLiveMode()')
            await asyncio.sleep(1.0)

            # 2. Test 5D mode: click Session Close Beacon (Trace 5)
            print('\n--- Testing 5D Mode Session Close Beacon Click ---')
            await send_eval("switchCorrTf('5D', true)")
            await asyncio.sleep(0.8)

            beacon_click_res = await send_eval('''(() => {
                const el = document.getElementById('overvix-chart');
                el.emit('plotly_click', {
                    points: [{
                        curveNumber: 5,
                        pointIndex: 0
                    }]
                });
                const pill = document.getElementById('anchor-status-pill');
                const banner = document.getElementById('corr-recovery-banner');
                const metricVal = document.getElementById('corr-metric-val');
                const metricBadge = document.getElementById('corr-metric-badge');
                return {
                    anchorMode: corrAnchor.mode,
                    anchorPill: pill ? pill.textContent.trim() : null,
                    bannerText: banner ? banner.textContent.trim() : null,
                    metricVal: metricVal ? metricVal.textContent.trim() : null,
                    metricBadge: metricBadge ? metricBadge.textContent.trim() : null,
                    spotBase: corrAnchor.spotBase,
                    volBase: corrAnchor.volBase,
                    isOfficialPriorClose: corrAnchor.isOfficialPriorClose
                };
            })()''')
            print('5D Mode Beacon Click Anchor State:', json.dumps(beacon_click_res, indent=2))

            # Inspect tooltip text for the latest bar on the bottom chart
            tooltip_data = await send_eval('''(() => {
                const chart = document.getElementById('correlation-chart');
                const traceAsset = chart.data.find(t => t.yaxis === 'y');
                const traceVol = chart.data.find(t => t.yaxis === 'y2');
                const traceResid = chart.data.find(t => t.yaxis === 'y3');
                const n = chart.data[0].x.length;
                return {
                    time: chart.data[0].x[n - 1],
                    assetCustomdataLast: traceAsset ? traceAsset.customdata[n - 1] : null,
                    volCustomdataLast: traceVol ? traceVol.customdata[n - 1] : null,
                    residCustomdataLast: traceResid ? traceResid.customdata[n - 1] : null
                };
            })()''')
            print('Latest Bar Tooltip Data:', json.dumps(tooltip_data, indent=2))

            # Capture screenshot
            await ws.send(json.dumps({'id': 50, 'method': 'Page.captureScreenshot', 'params': {'format': 'png'}}))
            while True:
                resp = json.loads(await ws.recv())
                if resp.get('id') == 50:
                    img_data = base64.b64decode(resp['result']['data'])
                    out_path = r'C:\Users\barla\.gemini\antigravity\brain\44bf4845-2eea-4a88-8c77-148ad69ac382\screenshot_dual_mode_verified.png'
                    with open(out_path, 'wb') as f:
                        f.write(img_data)
                    print(f'Screenshot saved to {out_path}')
                    break

    finally:
        proc.kill()

asyncio.run(main())
