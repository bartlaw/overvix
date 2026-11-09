import asyncio
import json
import subprocess
import urllib.request
import websockets

async def test_corner_hit():
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

            # Find points for 2026-11-05 (top-left) and 2026-11-04 (bottom-right)
            pts_info = await send_eval('''(() => {
                const chart = document.getElementById('overvix-chart');
                const t0 = chart.data[0];
                const dates = t0.text;
                const idx1105 = dates.indexOf('2026-11-05');
                const idx1104 = dates.indexOf('2026-11-04');
                
                const points = chart.querySelectorAll('.scatterlayer .trace:nth-child(1) .point');
                const el1105 = points[idx1105];
                const el1104 = points[idx1104];
                
                const r1105 = el1105 ? el1105.getBoundingClientRect() : null;
                const r1104 = el1104 ? el1104.getBoundingClientRect() : null;

                // Also check if any element is on top of r1105 or r1104 (elementFromPoint)
                const topElem1105 = r1105 ? document.elementFromPoint(r1105.x + r1105.width/2, r1105.y + r1105.height/2) : null;
                const topElem1104 = r1104 ? document.elementFromPoint(r1104.x + r1104.width/2, r1104.y + r1104.height/2) : null;

                // Also check draglayer / nsewdrag
                const dragLayer = chart.querySelector('.nsewdrag');
                const dragRect = dragLayer ? dragLayer.getBoundingClientRect() : null;

                return {
                    idx1105,
                    val1105: { x: t0.x[idx1105], y: t0.y[idx1105] },
                    rect1105: r1105 ? { x: r1105.x, y: r1105.y, w: r1105.width, h: r1105.height } : null,
                    topElem1105: topElem1105 ? { tag: topElem1105.tagName, class: topElem1105.getAttribute('class') } : null,
                    idx1104,
                    val1104: { x: t0.x[idx1104], y: t0.y[idx1104] },
                    rect1104: r1104 ? { x: r1104.x, y: r1104.y, w: r1104.width, h: r1104.height } : null,
                    topElem1104: topElem1104 ? { tag: topElem1104.tagName, class: topElem1104.getAttribute('class') } : null,
                    dragRect: dragRect ? { x: dragRect.x, y: dragRect.y, w: dragRect.width, h: dragRect.height } : null
                };
            })()''')
            print('Points Info:', json.dumps(pts_info, indent=2))

            # Now test Plotly's internal hover/Fx.hover at exact center of 11-05 vs offset y
            hover_test = await send_eval('''(() => {
                const chart = document.getElementById('overvix-chart');
                const t0 = chart.data[0];
                const dates = t0.text;
                const idx1105 = dates.indexOf('2026-11-05');
                const points = chart.querySelectorAll('.scatterlayer .trace:nth-child(1) .point');
                const el1105 = points[idx1105];
                const r = el1105.getBoundingClientRect();
                const centerX = r.x + r.width / 2;
                const centerY = r.y + r.height / 2;

                // Dispatch mousemove events at:
                // 1) exact center
                // 2) 5px below center
                // 3) 10px below center
                // 4) 15px below center
                function testHoverAt(clientX, clientY) {
                    const evt = new MouseEvent('mousemove', {
                        clientX: clientX,
                        clientY: clientY,
                        bubbles: true,
                        cancelable: true,
                        view: window
                    });
                    const target = document.elementFromPoint(clientX, clientY);
                    if (target) target.dispatchEvent(evt);
                    
                    const hoverLayer = chart.querySelector('.hoverlayer');
                    const hoverText = hoverLayer ? hoverLayer.textContent : null;
                    return { target: target ? target.tagName + '.' + target.getAttribute('class') : null, hoverText };
                }

                return {
                    atCenter: testHoverAt(centerX, centerY),
                    below5: testHoverAt(centerX, centerY + 5),
                    below10: testHoverAt(centerX, centerY + 10),
                    below15: testHoverAt(centerX, centerY + 15),
                    above10: testHoverAt(centerX, centerY - 10)
                };
            })()''')
            print('Hover Test at 11-05:', json.dumps(hover_test, indent=2))

    finally:
        proc.kill()

asyncio.run(test_corner_hit())
