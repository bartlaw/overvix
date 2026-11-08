import asyncio
import json
import subprocess
import urllib.request
import websockets

async def debug_metric():
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
                        res = resp.get('result', {})
                        if 'exceptionDetails' in res:
                            return {'exception': res['exceptionDetails']}
                        return res.get('result', {}).get('value')

            await ws.send(json.dumps({'id': 10, 'method': 'Page.enable'}))
            await asyncio.sleep(2)

            res = await send_eval('''(() => {
                try {
                    const isNdx = (currentAssetPair === 'NDX');
                    const targetTf = currentCorrTf;
                    const c = isNdx ? (cachedCorrNdx[targetTf] || cachedCorrNdx['1D'] || cachedCorrNdx) : (cachedCorr[targetTf] || cachedCorr['1D'] || cachedCorr);
                    const anchoredSeries = computeAnchoredSeries(c, isNdx);
                    const times = anchoredSeries.times || [];
                    const el = document.getElementById('corr-live-val');
                    const lbl = document.getElementById('corr-live-label');
                    const pill = document.getElementById('corr-status-pill');
                    const { beta, rawIntercept } = getActiveBetaAndIntercept(isNdx);
                    return {
                        targetTf,
                        cExists: !!c,
                        timesLen: times.length,
                        elText: el ? el.textContent : 'no el',
                        lblText: lbl ? lbl.textContent : 'no lbl',
                        pillText: pill ? pill.textContent : 'no pill',
                        beta,
                        rawIntercept
                    };
                } catch(err) {
                    return { error: err.message, stack: err.stack };
                }
            })()''')
            print("Debug Metric Info:", json.dumps(res, indent=2))

    finally:
        proc.terminate()

if __name__ == "__main__":
    asyncio.run(debug_metric())
