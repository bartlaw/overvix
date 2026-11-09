import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import asyncio
import time
import subprocess
import json
import urllib.request
import websockets

async def test():
    # Check if edge is running with debug port or launch it
    edge_proc = None
    try:
        tabs = json.loads(urllib.request.urlopen("http://127.0.0.1:9222/json", timeout=1).read().decode('utf-8'))
    except Exception:
        # Launch edge
        edge_path = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
        if not os.path.exists(edge_path):
            edge_path = r"C:\Program Files\Microsoft\Edge\Application\msedge.exe"
        cmd = [edge_path, "--headless=new", "--remote-debugging-port=9222", "about:blank"]
        edge_proc = subprocess.Popen(cmd)
        time.sleep(1.5)
        tabs = json.loads(urllib.request.urlopen("http://127.0.0.1:9222/json", timeout=2).read().decode('utf-8'))

    target = [t for t in tabs if t.get('type') == 'page'][0]
    ws_url = target['webSocketDebuggerUrl']
    
    async with websockets.connect(ws_url) as ws:
        async def cdp(method, params=None):
            msg_id = int(time.time() * 1000) % 10000000
            await ws.send(json.dumps({'id': msg_id, 'method': method, 'params': params or {}}))
            while True:
                resp = json.loads(await ws.recv())
                if resp.get('id') == msg_id:
                    return resp.get('result', {})

        print("Testing page load against running server...")
        t0 = time.time()
        await cdp("Page.navigate", {"url": "http://127.0.0.1:8000"})
        
        # Wait for charts to be rendered
        for i in range(50):
            res = await cdp("Runtime.evaluate", {
                "expression": """
                    (() => {
                        const c1 = document.getElementById('overvix-chart');
                        const c2 = document.getElementById('term-structure-chart');
                        const c3 = document.getElementById('correlation-chart');
                        const r1 = c1 && c1.data && c1.data.length > 0;
                        const r2 = c2 && c2.data && c2.data.length > 0;
                        const r3 = c3 && c3.data && c3.data.length > 0;
                        return { r1, r2, r3, allReady: r1 && r2 && r3 };
                    })()
                """,
                "returnByValue": True
            })
            val = res.get('result', {}).get('value', {})
            if val.get('allReady'):
                print(f"All charts rendered in browser in: {time.time() - t0:.2f}s!")
                break
            await asyncio.sleep(0.1)
        else:
            print(f"Timeout waiting for charts. Status: {val}")

    if edge_proc:
        edge_proc.terminate()

if __name__ == '__main__':
    asyncio.run(test())
