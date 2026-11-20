import asyncio
import json
import subprocess
import urllib.request
import websockets
import base64
import os
import random

async def main():
    profile_dir = rf"C:\tmp\edge_profile_hover_{random.randint(10000, 99999)}"
    os.makedirs(profile_dir, exist_ok=True)
    
    proc = subprocess.Popen([
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        "--remote-debugging-port=9468",
        "--headless=new",
        "--disable-gpu",
        "--window-size=1920,2160",
        f"--user-data-dir={profile_dir}",
        "http://127.0.0.1:8082"
    ])
    
    await asyncio.sleep(4.0)
    try:
        res = urllib.request.urlopen("http://127.0.0.1:9468/json")
        targets = json.loads(res.read())
        pages = [t for t in targets if t.get("type") == "page" and "sync-confirmation" not in t.get("url", "") and "edge://" not in t.get("url", "")]
        target = pages[0] if pages else targets[0]
        print("Selected target:", target.get("url"))
        
        async with websockets.connect(target["webSocketDebuggerUrl"]) as ws:
            mid = 1
            async def cmd(m, p=None):
                nonlocal mid
                mid += 1
                await ws.send(json.dumps({"id": mid, "method": m, "params": p or {}}))
                while True:
                    r = json.loads(await ws.recv())
                    if r.get("id") == mid:
                        return r.get("result", {})
            
            await cmd("Page.enable")
            await cmd("Page.navigate", {"url": "http://127.0.0.1:8082"})
            await asyncio.sleep(5.0)

            # Find coordinates of the lowest low red triangle marker
            pos_res = await cmd("Runtime.evaluate", {
                "expression": """(() => {
                    const gd = document.getElementById('correlation-chart');
                    if (!gd || !gd.data) return null;
                    const r = gd.getBoundingClientRect();
                    const fl = gd._fullLayout;
                    if (fl && fl.xaxis && fl.yaxis2) {
                        const trace = gd.data.find(t => t.name === 'VIX Highs');
                        if (trace && trace.x && trace.x.length > 0) {
                            const xVal = trace.x[trace.x.length - 1];
                            const yVal = trace.y[trace.y.length - 1];
                            const pixelX = fl.xaxis.d2p(xVal) + fl.margin.l;
                            const pixelY = fl.yaxis2.d2p(yVal) + fl.margin.t;
                            return {
                                clientX: r.x + pixelX,
                                clientY: r.y + pixelY,
                                rX: r.x,
                                rY: r.y,
                                rW: r.width,
                                rH: r.height,
                                xVal, yVal
                            };
                        }
                    }
                    return null;
                })()""",
                "returnByValue": True
            })
            pos = pos_res.get("result", {}).get("value")
            print("Calculated Target Position:", pos)

            if pos:
                await cmd("Input.dispatchMouseEvent", {
                    "type": "mouseMoved",
                    "x": pos["clientX"],
                    "y": pos["clientY"]
                })
                await asyncio.sleep(1.0)

            # Inspect hover texts
            hover_info = await cmd("Runtime.evaluate", {
                "expression": """(() => {
                    const hoverG = document.querySelectorAll('#correlation-chart g.hovertext');
                    return {
                        hoverGCount: hoverG.length,
                        hoverGTexts: Array.from(hoverG).map(g => g.textContent.trim())
                    };
                })()""",
                "returnByValue": True
            })
            print("Hover DOM Inspection:", json.dumps(hover_info, indent=2))

            clip = {
                "x": pos["rX"],
                "y": pos["rY"],
                "width": pos["rW"],
                "height": pos["rH"],
                "scale": 1
            } if pos else None
            shot = await cmd("Page.captureScreenshot", {"clip": clip} if clip else {})
            if "data" in shot:
                out_path = r"C:\Users\barla\.gemini\antigravity\brain\44bf4845-2eea-4a88-8c77-148ad69ac382\screenshot_unified_tooltip_clean.png"
                with open(out_path, "wb") as f:
                    f.write(base64.b64decode(shot["data"]))
                print(f"Saved Clean Unified Tooltip screenshot to: {out_path}")

    finally:
        proc.kill()

asyncio.run(main())
