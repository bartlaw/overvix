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
            
            await asyncio.sleep(2)
            code = """(() => {
                switchCorrTf('5D');
                setCorrAnchor('custom', '2026-11-05 15:55');
                const chart = document.getElementById('correlation-chart');
                const annot = chart.layout.annotations.find(a => a.text && a.text.includes('Anchor:'));
                const volTrace = chart.data.find(t => t.yaxis === 'y2');
                const last = volTrace.customdata[volTrace.customdata.length - 1];
                return {
                    anchorText: annot ? annot.text : null,
                    tooltipResid: last ? last[1] : null,
                    timesEnd: chart.data[0].x[chart.data[0].x.length - 1]
                };
            })()"""
            res = await send_eval(code)
            print('5D Anchored Evaluation:', res)
    finally:
        proc.terminate()

asyncio.run(check())
