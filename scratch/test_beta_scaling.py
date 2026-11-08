import asyncio
import base64
import json
import os
import subprocess
import time
import urllib.request
import websockets

async def test_beta_scaling():
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

            # Test 1: Check Beta Scaled state (default)
            res1 = await send_eval("""
            (() => {
                const btnScale = document.getElementById('btn-corr-scale');
                const plotEl = document.getElementById('correlation-chart');
                const traces = plotEl.data ? plotEl.data.map(t => t.name || t.type) : [];
                const hasRibbon = plotEl.data.some(t => t.fill === 'tonexty');
                const y1Range = plotEl.layout.yaxis.range;
                const y2Range = plotEl.layout.yaxis2.range;
                const y2Title = plotEl.layout.yaxis2.title.text;
                return {
                    btnText: btnScale ? btnScale.innerText : null,
                    isBetaScaled,
                    hasRibbon,
                    y1Range,
                    y2Range,
                    y2Title,
                    traceCount: plotEl.data.length
                };
            })()
            """)
            val1 = res1.get("result", {}).get("result", {}).get("value", {})
            print("Test 1 (Default Beta Scaled):")
            print("  Button text:", val1.get("btnText"))
            print("  isBetaScaled:", val1.get("isBetaScaled"))
            print("  hasRibbon:", val1.get("hasRibbon"))
            print("  y1Range (SPX %):", val1.get("y1Range"))
            print("  y2Range (VIX pt):", val1.get("y2Range"))
            print("  y2Title:", val1.get("y2Title"))
            assert val1.get("isBetaScaled") is True
            assert val1.get("hasRibbon") is True, "Ribbon must exist when Beta Scaled & Invert Vol!"
            assert "β=" in val1.get("y2Title", ""), "Y2 title must mention beta!"
            
            # Check beta ratio between range 1 and range 2
            r1_span = val1["y1Range"][1] - val1["y1Range"][0]
            r2_span = abs(val1["y2Range"][1] - val1["y2Range"][0])
            ratio = r2_span / r1_span
            print(f"  Measured scale ratio (R2 / R1): {ratio:.4f}")
            assert abs(ratio - 1.9796) < 0.05, f"Scale ratio {ratio} should match beta ~1.98"
            print("  -> PASSED: Dual axes are mathematically locked to Spot-Vol Beta!")

            # Capture screenshot in Beta Scaled mode
            await send_eval("window.scrollTo(0, document.body.scrollHeight);")
            await asyncio.sleep(1)
            mid += 1
            await ws.send(json.dumps({"id": mid, "method": "Page.captureScreenshot", "params": {"format": "png"}}))
            while True:
                resp = json.loads(await ws.recv())
                if resp.get("id") == mid:
                    out1 = r"C:\Users\barla\.gemini\antigravity\brain\44bf4845-2eea-4a88-8c77-148ad69ac382\screenshot_beta_scaled_ribbon.png"
                    with open(out1, "wb") as f:
                        f.write(base64.b64decode(resp["result"]["data"]))
                    print(f"Saved screenshot to: {out1}")
                    break

            # Test 2: Toggle to Auto Fit
            res2 = await send_eval("""
            (() => {
                toggleCorrScaleMode();
                const btnScale = document.getElementById('btn-corr-scale');
                const plotEl = document.getElementById('correlation-chart');
                const hasRibbon = plotEl.data.some(t => t.fill === 'tonexty');
                return {
                    btnText: btnScale ? btnScale.innerText : null,
                    isBetaScaled,
                    hasRibbon
                };
            })()
            """)
            val2 = res2.get("result", {}).get("result", {}).get("value", {})
            print("\nTest 2 (Toggled to Auto Fit):")
            print("  Button text:", val2.get("btnText"))
            print("  isBetaScaled:", val2.get("isBetaScaled"))
            print("  hasRibbon:", val2.get("hasRibbon"))
            assert val2.get("isBetaScaled") is False
            assert val2.get("hasRibbon") is False, "Ribbon should be disabled in Auto Fit!"
            print("  -> PASSED: Toggled to Auto Fit cleanly!")

            # Toggle back to Beta Scaled
            await send_eval("toggleCorrScaleMode();")

            # Test 3: Anchor mode with 6M
            res3 = await send_eval("""
            (() => {
                switchCorrTf('6M');
                setCorrAnchor('spot_low');
                const plotEl = document.getElementById('correlation-chart');
                const hasRibbon = plotEl.data.some(t => t.fill === 'tonexty');
                return {
                    isBetaScaled,
                    hasRibbon,
                    anchorIdx: corrAnchor.index
                };
            })()
            """)
            val3 = res3.get("result", {}).get("result", {}).get("value", {})
            print("\nTest 3 (6M with SPX Low Anchor):")
            print("  isBetaScaled:", val3.get("isBetaScaled"))
            print("  hasRibbon:", val3.get("hasRibbon"))
            print("  anchorIdx:", val3.get("anchorIdx"))
            assert val3.get("hasRibbon") is True

            # Capture screenshot in 6M anchored mode
            await send_eval("window.scrollTo(0, document.body.scrollHeight);")
            await asyncio.sleep(1)
            mid += 1
            await ws.send(json.dumps({"id": mid, "method": "Page.captureScreenshot", "params": {"format": "png"}}))
            while True:
                resp = json.loads(await ws.recv())
                if resp.get("id") == mid:
                    out2 = r"C:\Users\barla\.gemini\antigravity\brain\44bf4845-2eea-4a88-8c77-148ad69ac382\screenshot_beta_scaled_6m_anchored.png"
                    with open(out2, "wb") as f:
                        f.write(base64.b64decode(resp["result"]["data"]))
                    print(f"Saved 6M anchored screenshot to: {out2}")
                    break

            print("\n>>> ALL TESTS PASSED! <<<")
    finally:
        edge_proc.terminate()

if __name__ == "__main__":
    asyncio.run(test_beta_scaling())
