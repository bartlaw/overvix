import asyncio
import base64
import json
import subprocess
import urllib.request
import websockets

async def test_shading():
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
            
            eval_res = await send_eval('''(() => {
                const chart = document.getElementById('correlation-chart');
                const times = chart.data.find(d => d.name && d.name.includes('SPX')).x;
                const spxY = chart.data.find(d => d.name && d.name.includes('SPX')).y;
                const vixY = chart.data.find(d => d.name && d.name.includes('VIX')).y;
                
                const beta = 1.98;
                const rawIntercept = 0.04;
                const resid = times.map((t, i) => {
                    const s = spxY[i] || 0;
                    const v = vixY[i] || 0;
                    return v - rawIntercept + beta * s;
                });
                
                const posResid = resid.map(v => Math.max(0, v));
                const negResid = resid.map(v => Math.min(0, v));
                
                const upperTraces = chart.data.filter(d => d.yaxis !== 'y3');
                
                const dStart = times[0];
                const dEnd = times[times.length - 1];
                
                const tracePosFill = {
                    x: times,
                    y: posResid,
                    mode: 'lines',
                    line: { color: 'transparent', width: 0 },
                    fill: 'tozeroy',
                    fillcolor: 'rgba(16, 185, 129, 0.22)',
                    xaxis: 'x',
                    yaxis: 'y3',
                    showlegend: false,
                    hoverinfo: 'none'
                };
                
                const traceNegFill = {
                    x: times,
                    y: negResid,
                    mode: 'lines',
                    line: { color: 'transparent', width: 0 },
                    fill: 'tozeroy',
                    fillcolor: 'rgba(244, 63, 94, 0.22)',
                    xaxis: 'x',
                    yaxis: 'y3',
                    showlegend: false,
                    hoverinfo: 'none'
                };
                
                const traceResidual = {
                    x: times,
                    y: resid,
                    mode: 'lines',
                    name: 'Overvix Residual',
                    line: { color: '#00E5FF', width: 1.8 },
                    xaxis: 'x',
                    yaxis: 'y3',
                    customdata: resid.map(v => (v >= 0 ? `+${v.toFixed(2)}` : v.toFixed(2))),
                    hovertemplate: `<b>%{x|%b %d, %H:%M}</b><br>Overvix Residual: %{customdata} pts<extra></extra>`
                };
                
                const traceZeroLine = {
                    x: [dStart, dEnd],
                    y: [0.0, 0.0],
                    mode: 'lines',
                    name: 'Zero Baseline (0.0)',
                    line: { color: 'rgba(148, 163, 184, 0.5)', width: 1.2, dash: 'dash' },
                    xaxis: 'x',
                    yaxis: 'y3',
                    showlegend: false,
                    hoverinfo: 'none'
                };
                
                const traceAlert = {
                    x: [dStart, dEnd],
                    y: [2.0, 2.0],
                    mode: 'lines',
                    name: 'Overvix Alert (+2.0 pts)',
                    line: { color: '#F43F5E', width: 1.5, dash: 'dash' },
                    xaxis: 'x',
                    yaxis: 'y3',
                    showlegend: false,
                    hoverinfo: 'none'
                };
                
                const traceFloor = {
                    x: [dStart, dEnd],
                    y: [-2.0, -2.0],
                    mode: 'lines',
                    name: 'Vol Crush (-2.0 pts)',
                    line: { color: '#06B6D4', width: 1.2, dash: 'dot' },
                    xaxis: 'x',
                    yaxis: 'y3',
                    showlegend: false,
                    hoverinfo: 'none'
                };
                
                const newTraces = [...upperTraces, tracePosFill, traceNegFill, traceResidual, traceZeroLine, traceAlert, traceFloor];
                
                const maxAbs = Math.max(2.0, ...resid.map(v => Math.abs(v)));
                const y3Lim = Math.ceil(maxAbs * 1.2 * 10) / 10;
                
                const newLayout = {
                    ...chart.layout,
                    yaxis3: {
                        domain: [0.0, 0.40],
                        title: { text: 'Residual (pts)', font: { color: '#00E5FF', size: 10 } },
                        gridcolor: '#1e293b',
                        tickfont: { color: '#00E5FF', size: 10 },
                        range: [-y3Lim, y3Lim],
                        zeroline: false,
                        fixedrange: true
                    }
                };
                
                Plotly.react('correlation-chart', newTraces, newLayout);
                return { success: true, count: newTraces.length, y3Lim };
            })()''')
            print("Evaluation result:", eval_res)
            await asyncio.sleep(1)
            await take_screenshot("test_residual_chart_screenshot.png")
            
    finally:
        proc.terminate()

if __name__ == "__main__":
    asyncio.run(test_shading())
