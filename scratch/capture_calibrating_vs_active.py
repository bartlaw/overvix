import asyncio
import base64
import json
import os
import subprocess
import time
import urllib.request
import websockets

async def capture_screenshots():
    edge_proc = subprocess.Popen([
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        "--remote-debugging-port=9222",
        "--headless=new",
        "--disable-gpu",
        "--window-size=1600,1400",
        "http://127.0.0.1:8000"
    ])
    await asyncio.sleep(3)
    try:
        targets_res = urllib.request.urlopen("http://127.0.0.1:9222/json")
        targets = json.loads(targets_res.read())
        page_target = next(t for t in targets if t.get("type") == "page" and "8000" in t.get("url", ""))
        ws_url = page_target["webSocketDebuggerUrl"]
        async with websockets.connect(ws_url) as ws:
            mid = 100
            async def send_eval(expr):
                nonlocal mid
                mid += 1
                await ws.send(json.dumps({"id": mid, "method": "Runtime.evaluate", "params": {"expression": expr, "returnByValue": True}}))
                while True:
                    resp = json.loads(await ws.recv())
                    if resp.get("id") == mid:
                        return resp

            await ws.send(json.dumps({"id": 1, "method": "Page.enable"}))
            
            # Wait for chart
            for _ in range(30):
                chk = await send_eval("Boolean(document.getElementById('correlation-chart') && document.getElementById('correlation-chart').data && cachedCorr && cachedCorr['1D'])")
                if chk.get("result", {}).get("result", {}).get("value") is True:
                    break
                await asyncio.sleep(0.5)

            # 1. Capture late anchor (calibrating, <= 10 bars)
            await send_eval("""
            (() => {
                const c = cachedCorr['1D'];
                const times = c.times;
                setCorrAnchor('custom', times[times.length - 6]);
                window.scrollTo(0, document.body.scrollHeight);
            })()
            """)
            await asyncio.sleep(1)
            mid += 1
            await ws.send(json.dumps({"id": mid, "method": "Page.captureScreenshot", "params": {"format": "png"}}))
            while True:
                resp = json.loads(await ws.recv())
                if resp.get("id") == mid:
                    out1 = r"C:\Users\barla\.gemini\antigravity\brain\44bf4845-2eea-4a88-8c77-148ad69ac382\screenshot_anchor_calibrating.png"
                    with open(out1, "wb") as f:
                        f.write(base64.b64decode(resp["result"]["data"]))
                    print("Saved calibrating screenshot:", out1)
                    break

            # 2. Capture post-anchor active (> 10 bars) on 1D
            await send_eval("""
            (() => {
                const c = cachedCorr['1D'];
                const times = c.times;
                setCorrAnchor('custom', times[50]);
                window.scrollTo(0, document.body.scrollHeight);
            })()
            """)
            await asyncio.sleep(1)
            mid += 1
            await ws.send(json.dumps({"id": mid, "method": "Page.captureScreenshot", "params": {"format": "png"}}))
            while True:
                resp = json.loads(await ws.recv())
                if resp.get("id") == mid:
                    out2 = r"C:\Users\barla\.gemini\antigravity\brain\44bf4845-2eea-4a88-8c77-148ad69ac382\screenshot_anchor_active_10bar_suppressed.png"
                    with open(out2, "wb") as f:
                        f.write(base64.b64decode(resp["result"]["data"]))
                    print("Saved active screenshot:", out2)
                    break
    finally:
        edge_proc.terminate()

if __name__ == "__main__":
    asyncio.run(capture_screenshots())
