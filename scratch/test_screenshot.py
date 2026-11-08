import asyncio
import json
import os
import subprocess
import time
import urllib.request
import websockets

async def capture_corr_6m_anchored():
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
        page_target = next(t for t in targets if t.get("type") == "page")
        ws_url = page_target["webSocketDebuggerUrl"]
        
        async with websockets.connect(ws_url) as ws:
            msg_id = 1
            async def send(method, params=None):
                nonlocal msg_id
                msg_id += 1
                await ws.send(json.dumps({"id": msg_id, "method": method, "params": params or {}}))
                while True:
                    resp = json.loads(await ws.recv())
                    if resp.get("id") == msg_id:
                        return resp.get("result", {})

            await send("Page.enable")
            await asyncio.sleep(2)
            
            # Switch to 6M, activate SPX Low anchor, scroll down
            await send("Runtime.evaluate", {
                "expression": """
                switchCorrTf('6M');
                setCorrAnchor('spot_low');
                window.scrollTo(0, document.body.scrollHeight);
                """
            })
            await asyncio.sleep(2)
            
            # Capture screenshot
            res = await send("Page.captureScreenshot", {"format": "png"})
            import base64
            img_data = base64.b64decode(res["data"])
            out_path = r"C:\Users\barla\.gemini\antigravity\brain\44bf4845-2eea-4a88-8c77-148ad69ac382\screenshot_corr_6m_anchored_verified.png"
            with open(out_path, "wb") as f:
                f.write(img_data)
            print(f"Saved verified anchored screenshot to {out_path}")
    finally:
        edge_proc.terminate()

if __name__ == "__main__":
    asyncio.run(capture_corr_6m_anchored())
