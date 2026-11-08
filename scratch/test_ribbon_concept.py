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
        '--window-size=1600,1200',
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
            
            # Inject new ribbon logic into correlation-chart directly and re-plot
            setup_script = """(() => {
                isBetaScaled = true;
                isVolInverted = true;
                switchCorrTf('5D');
                
                const chart = document.getElementById('correlation-chart');
                const data = chart.data;
                const assetTrace = data.find(t => t.name && (t.name.includes('SPX') || t.name.includes('NDX')) && t.yaxis === 'y');
                const volTrace = data.find(t => t.yaxis === 'y2');
                
                const times = assetTrace.x;
                const sPct = assetTrace.y;
                const beta = 1.98;
                const vScaled = volTrace.y.map(v => -v / beta);
                
                // Build interpolated series for zero-overlap crossings
                const xArr = [];
                const vArr = [];
                const minArr = [];
                const maxArr = [];
                
                for (let i = 0; i < times.length; i++) {
                    const t = times[i];
                    const s = sPct[i];
                    const v = vScaled[i];
                    
                    if (i > 0 && typeof sPct[i-1] === 'number' && typeof vScaled[i-1] === 'number' && typeof s === 'number' && typeof v === 'number') {
                        const pDiff = sPct[i-1] - vScaled[i-1];
                        const cDiff = s - v;
                        if ((pDiff > 0 && cDiff < 0) || (pDiff < 0 && cDiff > 0)) {
                            const frac = Math.abs(pDiff) / (Math.abs(pDiff) + Math.abs(cDiff));
                            const prevMs = new Date(times[i-1].replace(' ', 'T')).getTime();
                            const currMs = new Date(t.replace(' ', 'T')).getTime();
                            let crossT = t;
                            if (!isNaN(prevMs) && !isNaN(currMs)) {
                                crossT = new Date(prevMs + frac * (currMs - prevMs)).toISOString().replace('T', ' ').slice(0, 16);
                            }
                            const crossY = sPct[i-1] + frac * (s - sPct[i-1]);
                            xArr.push(crossT);
                            vArr.push(crossY);
                            minArr.push(crossY);
                            maxArr.push(crossY);
                        }
                    }
                    xArr.push(t);
                    vArr.push(v);
                    if (typeof s === 'number' && typeof v === 'number') {
                        minArr.push(Math.min(s, v));
                        maxArr.push(Math.max(s, v));
                    } else {
                        minArr.push(null);
                        maxArr.push(null);
                    }
                }
                
                const traceVolRef1 = {
                    x: xArr, y: vArr, mode: 'lines', line: { color: 'transparent', width: 0 },
                    xaxis: 'x', yaxis: 'y', hoverinfo: 'none', showlegend: false
                };
                const traceRed = {
                    x: xArr, y: minArr, mode: 'lines', line: { color: 'transparent', width: 0 },
                    fill: 'tonexty', fillcolor: 'rgba(244, 63, 94, 0.22)',
                    xaxis: 'x', yaxis: 'y', hoverinfo: 'none', showlegend: false
                };
                const traceVolRef2 = {
                    x: xArr, y: vArr, mode: 'lines', line: { color: 'transparent', width: 0 },
                    xaxis: 'x', yaxis: 'y', hoverinfo: 'none', showlegend: false
                };
                const traceGreen = {
                    x: xArr, y: maxArr, mode: 'lines', line: { color: 'transparent', width: 0 },
                    fill: 'tonexty', fillcolor: 'rgba(16, 185, 129, 0.22)',
                    xaxis: 'x', yaxis: 'y', hoverinfo: 'none', showlegend: false
                };
                
                // Filter out previous ribbon
                const cleanData = data.filter(t => t.fill !== 'tonexty');
                // Insert new 4 traces right before assetTrace
                const newTraces = [traceVolRef1, traceRed, traceVolRef2, traceGreen, ...cleanData];
                Plotly.react('correlation-chart', newTraces, chart.layout);
                return { ok: true, xLen: xArr.length };
            })()"""
            r = await send_eval(setup_script)
            print('React result:', r)
            await asyncio.sleep(1.5)

            # Take screenshot of dual shaded chart
            mid += 1
            await ws.send(json.dumps({'id': mid, 'method': 'Page.captureScreenshot', 'params': {'format': 'png'}}))
            while True:
                resp = json.loads(await ws.recv())
                if resp.get('id') == mid:
                    img_data = base64.b64decode(resp['result']['data'])
                    with open(r'C:\Users\barla\.gemini\antigravity\brain\44bf4845-2eea-4a88-8c77-148ad69ac382\screenshot_dual_shading_test.png', 'wb') as f:
                        f.write(img_data)
                    print('Saved screenshot_dual_shading_test.png')
                    break
    finally:
        proc.terminate()

asyncio.run(check())
