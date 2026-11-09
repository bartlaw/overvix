import asyncio
import json
import subprocess
import urllib.request
import websockets

async def inspect_plotly_coordinates():
    proc = subprocess.Popen([
        r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
        '--remote-debugging-port=9222',
        '--headless=new',
        '--disable-gpu',
        '--window-size=1920,1080',
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

            chart_info = await send_eval('''(() => {
                const chart = document.getElementById('overvix-chart');
                const svg = chart.querySelector('svg.main-svg');
                const plotSvg = chart.querySelector('.xy') || chart.querySelector('.gl-canvas') || chart.querySelector('svg');
                const rect = chart.getBoundingClientRect();
                const svgRect = svg ? svg.getBoundingClientRect() : null;
                const gd = chart;
                const fullLayout = gd._fullLayout;
                
                // Inspect all points in trace 0 (historical) and trace 5 (beacon)
                const trace0Points = Array.from(chart.querySelectorAll('.scatterlayer .trace:nth-child(1) .point')).map((pt, i) => {
                    const r = pt.getBoundingClientRect();
                    return { i, x: r.x + r.width / 2, y: r.y + r.height / 2, width: r.width, height: r.height };
                });

                const beaconPoint = chart.querySelector('.scatterlayer .trace:last-child .point') || chart.querySelector('.scatterlayer .trace:nth-child(6) .point');
                const beaconRect = beaconPoint ? beaconPoint.getBoundingClientRect() : null;

                return {
                    chartRect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
                    svgRect: svgRect ? { left: svgRect.left, top: svgRect.top, width: svgRect.width, height: svgRect.height } : null,
                    fullLayout: {
                        width: fullLayout.width,
                        height: fullLayout.height,
                        hovermode: fullLayout.hovermode,
                        hoverdistance: fullLayout.hoverdistance,
                        margin: fullLayout.margin,
                        xaxis: { range: fullLayout.xaxis.range, domain: fullLayout.xaxis.domain },
                        yaxis: { range: fullLayout.yaxis.range, domain: fullLayout.yaxis.domain }
                    },
                    trace0Count: trace0Points.length,
                    firstPoint: trace0Points[0],
                    lastPoint: trace0Points[trace0Points.length - 1],
                    beacon: beaconRect ? { x: beaconRect.x + beaconRect.width/2, y: beaconRect.y + beaconRect.height/2 } : null
                };
            })()''')
            print('Chart Info:', json.dumps(chart_info, indent=2))

    finally:
        proc.kill()

asyncio.run(inspect_plotly_coordinates())
