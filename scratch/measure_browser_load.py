import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import asyncio
import time
import json
import urllib.request
import websockets

async def measure():
    # Check if edge debugging port is active
    try:
        tabs = json.loads(urllib.request.urlopen("http://127.0.0.1:9222/json", timeout=2).read().decode('utf-8'))
    except Exception as e:
        print("Edge debugging port 9222 not reachable:", e)
        return

    target = None
    for t in tabs:
        if t.get('type') == 'page':
            target = t
            break
            
    if not target:
        print("No page target found")
        return

    ws_url = target['webSocketDebuggerUrl']
    async with websockets.connect(ws_url) as ws:
        async def cdp(method, params=None):
            msg_id = int(time.time() * 1000) % 10000000
            await ws.send(json.dumps({'id': msg_id, 'method': method, 'params': params or {}}))
            while True:
                resp = json.loads(await ws.recv())
                if resp.get('id') == msg_id:
                    return resp.get('result', {})

        # Enable Performance metrics
        await cdp("Performance.enable")
        
        # Evaluate performance timing in page
        res = await cdp("Runtime.evaluate", {
            "expression": """
                (() => {
                    const nav = performance.getEntriesByType('navigation')[0];
                    const resources = performance.getEntriesByType('resource').map(r => ({
                        name: r.name.split('/').pop().split('?')[0],
                        duration_ms: Math.round(r.duration),
                        size_kb: Math.round(r.transferSize / 1024)
                    }));
                    return {
                        nav_domContentLoaded_ms: Math.round(nav ? nav.domContentLoadedEventEnd : 0),
                        nav_load_ms: Math.round(nav ? nav.loadEventEnd : 0),
                        resources: resources
                    };
                })()
            """,
            "returnByValue": True
        })
        print("Browser Performance Timings:")
        print(json.dumps(res.get('result', {}).get('value', {}), indent=2))

if __name__ == '__main__':
    asyncio.run(measure())
