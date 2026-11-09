import asyncio
import websockets
import json
import urllib.request

async def test():
    req = urllib.request.urlopen('http://127.0.0.1:9222/json')
    tabs = json.loads(req.read())
    tab = [t for t in tabs if t.get('type') == 'page'][0]
    ws_url = tab['webSocketDebuggerUrl']
    async with websockets.connect(ws_url) as ws:
        msg_id = 1
        async def send(method, params=None):
            nonlocal msg_id
            msg_id += 1
            await ws.send(json.dumps({'id': msg_id, 'method': method, 'params': params or {}}))
            while True:
                res = json.loads(await ws.recv())
                if res.get('id') == msg_id:
                    return res.get('result', {})

        # Check script src in current DOM before reload
        script_eval = await send('Runtime.evaluate', {
            'expression': 'document.querySelector("script[src*=\'dashboard.js\']").src',
            'returnByValue': True
        })
        print('Current script src in DOM:', script_eval.get('result', {}).get('value'))

        # Hard reload page ignoring cache
        await send('Page.reload', {'ignoreCache': True})
        await asyncio.sleep(2)

        # Switch to 5D
        await send('Runtime.evaluate', {'expression': 'switchCorrTf("5D", true)', 'returnByValue': True})
        await asyncio.sleep(0.5)

        # Trigger Session Close Beacon click (Trace 5)
        sim_res = await send('Runtime.evaluate', {
            'expression': '''
                (function() {
                    const el = document.getElementById('overvix-chart');
                    const evt = { points: [{ curveNumber: 5, pointIndex: 0 }] };
                    el.emit('plotly_click', evt);
                    return {
                        anchorMode: corrAnchor.mode,
                        anchorTime: corrAnchor.time,
                        anchorSpot: corrAnchor.spotBase,
                        anchorVol: corrAnchor.volBase,
                        isOfficial: corrAnchor.isOfficialPriorClose,
                        residDisplay: document.getElementById('corr-metric-val') ? document.getElementById('corr-metric-val').textContent : null,
                        anchorPill: document.getElementById('anchor-status-pill') ? document.getElementById('anchor-status-pill').textContent : null
                    };
                })()
            ''',
            'returnByValue': True
        })
        print('Sim Beacon click result in 5D:', json.dumps(sim_res.get('result', {}).get('value'), indent=2))

        # Test clicking a historical dot (Trace 0) in 1D mode
        await send('Runtime.evaluate', {'expression': 'switchCorrTf("1D", true)', 'returnByValue': True})
        await asyncio.sleep(0.5)

        dot_res = await send('Runtime.evaluate', {
            'expression': '''
                (function() {
                    const el = document.getElementById('overvix-chart');
                    const evt = { points: [{ curveNumber: 0, pointIndex: 0, text: '2026-11-05' }] };
                    el.emit('plotly_click', evt);
                    return {
                        currentMode: currentViewMode,
                        selectedDate: selectedHistoricalDate,
                        anchorMode: corrAnchor.mode
                    };
                })()
            ''',
            'returnByValue': True
        })
        print('Clicking Nov 05 dot in 1D mode:', json.dumps(dot_res.get('result', {}).get('value'), indent=2))

asyncio.run(test())
