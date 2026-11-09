import asyncio
import json
import subprocess
import urllib.request
import websockets

async def check_ndx():
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
            
            # Switch to NDX
            await send_eval("switchAssetPair('NDX')")
            await asyncio.sleep(1)

            # Switch to 5D
            await send_eval("switchCorrTf('5D', true)")
            await asyncio.sleep(1)
            
            # Click Prior Close button
            res = await send_eval('''(() => {
                const btn = document.getElementById('btn-anchor-prior-close');
                if (btn) btn.click();
                const pill = document.getElementById('anchor-status-pill');
                const banner = document.getElementById('corr-recovery-banner');
                const chart = document.getElementById('correlation-chart');
                const residTrace = chart && chart.data ? chart.data.find(t => t.name && t.name.includes('Residual') && t.yaxis === 'y3') : null;
                const volTrace = chart && chart.data ? chart.data.find(t => t.yaxis === 'y2') : null;
                return {
                    pillText: pill ? pill.textContent : null,
                    bannerText: banner ? banner.innerText : null,
                    anchorSpotBase: corrAnchor.spotBase,
                    anchorVolBase: corrAnchor.volBase,
                    isOfficialPriorClose: corrAnchor.isOfficialPriorClose,
                    lastResidVal: residTrace && residTrace.y ? residTrace.y.slice(-1)[0] : null,
                    lastResidCustom: residTrace && residTrace.customdata ? residTrace.customdata.slice(-1)[0] : null,
                    lastVolCustom: volTrace && volTrace.customdata ? volTrace.customdata.slice(-1)[0] : null
                };
            })()''')
            print('5D NDX Prior Close Check:', json.dumps(res, indent=2))
    finally:
        proc.kill()

if __name__ == '__main__':
    asyncio.run(check_ndx())
