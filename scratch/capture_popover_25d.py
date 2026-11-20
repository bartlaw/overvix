import asyncio
import json
import subprocess
import urllib.request
import websockets
import base64
import os
import random

async def main():
    profile_dir = rf"C:\tmp\edge_profile_25d_{random.randint(10000, 99999)}"
    os.makedirs(profile_dir, exist_ok=True)
    
    proc = subprocess.Popen([
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        "--remote-debugging-port=9462",
        "--headless=new",
        "--disable-gpu",
        "--window-size=1920,1080",
        f"--user-data-dir={profile_dir}",
        "http://127.0.0.1:8082"
    ])
    
    await asyncio.sleep(4.0)
    try:
        res = urllib.request.urlopen("http://127.0.0.1:9462/json")
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
            await asyncio.sleep(3.0)
            
            # Wait for card-rr25 to appear in DOM
            for _ in range(20):
                chk = await cmd("Runtime.evaluate", {
                    "expression": "Boolean(document.getElementById('card-rr25'))",
                    "returnByValue": True
                })
                if chk.get("result", {}).get("value") is True:
                    break
                await asyncio.sleep(0.5)

            # Click Card 7 to open 25Δ popover
            click_res = await cmd("Runtime.evaluate", {
                "expression": """(() => {
                    const card = document.getElementById('card-rr25');
                    const pop = document.getElementById('popover-rr25');
                    if (!card) return 'no card';
                    card.click();
                    return {
                        hasPop: Boolean(pop),
                        popHidden: pop ? pop.classList.contains('hidden') : null
                    };
                })()""",
                "returnByValue": True
            })
            print("Click res:", click_res)
            await asyncio.sleep(1.0)

            # Get DOM values in Baseline state
            info1 = await cmd("Runtime.evaluate", {
                "expression": """(() => {
                    return {
                        refLabel: document.getElementById('pop-rr25-ref-label')?.textContent,
                        refPrice: document.getElementById('pop-rr25-ref-price')?.textContent,
                        refBadge: document.getElementById('pop-rr25-ref-mode-badge')?.textContent,
                        refSub: document.getElementById('pop-rr25-ref-sub')?.textContent,
                        btnSpot: document.getElementById('btn-recalibrate-25-spot')?.textContent,
                        btnReset: document.getElementById('btn-reset-25-close')?.textContent,
                    };
                })()""",
                "returnByValue": True
            })
            print("Baseline UI state:", json.dumps(info1, indent=2))

            # Capture clip of popover in Baseline state
            box_res = await cmd("Runtime.evaluate", {
                "expression": """(() => {
                    const pop = document.getElementById('popover-rr25');
                    if (!pop) return null;
                    const r = pop.getBoundingClientRect();
                    return {x: r.x - 10, y: r.y - 10, width: r.width + 20, height: r.height + 20, scale: 1};
                })()""",
                "returnByValue": True
            })
            clip = box_res.get("result", {}).get("value")
            if clip:
                shot1 = await cmd("Page.captureScreenshot", {"clip": clip})
                if "data" in shot1:
                    out_path1 = r"C:\Users\barla\.gemini\antigravity\brain\44bf4845-2eea-4a88-8c77-148ad69ac382\screenshot_rr25_popover.png"
                    with open(out_path1, "wb") as f:
                        f.write(base64.b64decode(shot1["data"]))
                    print(f"Saved baseline screenshot to: {out_path1}")

            # Click [↺ Spot] button
            btn_spot_click = await cmd("Runtime.evaluate", {
                "expression": """(() => {
                    const btn = document.getElementById('btn-recalibrate-25-spot');
                    if (!btn) return 'no btn';
                    btn.click();
                    return 'clicked';
                })()""",
                "returnByValue": True
            })
            print("Clicked [Spot]:", btn_spot_click)
            await asyncio.sleep(2.0)

            # Check UI state after Spot click
            info2 = await cmd("Runtime.evaluate", {
                "expression": """(() => {
                    return {
                        refLabel: document.getElementById('pop-rr25-ref-label')?.textContent,
                        refPrice: document.getElementById('pop-rr25-ref-price')?.textContent,
                        refBadge: document.getElementById('pop-rr25-ref-mode-badge')?.textContent,
                        refSub: document.getElementById('pop-rr25-ref-sub')?.textContent
                    };
                })()""",
                "returnByValue": True
            })
            print("After Spot recalibration UI state:", json.dumps(info2, indent=2))

            if clip:
                shot2 = await cmd("Page.captureScreenshot", {"clip": clip})
                if "data" in shot2:
                    out_path2 = r"C:\Users\barla\.gemini\antigravity\brain\44bf4845-2eea-4a88-8c77-148ad69ac382\screenshot_rr25_popover_recalibrated.png"
                    with open(out_path2, "wb") as f:
                        f.write(base64.b64decode(shot2["data"]))
                    print(f"Saved recalibrated screenshot to: {out_path2}")

    finally:
        proc.kill()

asyncio.run(main())
