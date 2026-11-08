import asyncio
import base64
import json
import os
import subprocess
import time
import urllib.request
import websockets

async def test_no_switch():
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

            # Test 1: Buttons removed
            res1 = await send_eval("""
            (() => {
                const btnDual = document.getElementById('btn-corr-dual');
                const btnOnly = document.getElementById('btn-corr-only');
                const btnInvert = document.getElementById('btn-corr-invert');
                const plotEl = document.getElementById('correlation-chart');
                const traces = plotEl.data ? plotEl.data.map(t => t.name) : [];
                return {
                    btnDualExists: Boolean(btnDual),
                    btnOnlyExists: Boolean(btnOnly),
                    btnInvertExists: Boolean(btnInvert),
                    traceNames: traces
                };
            })()
            """)
            val1 = res1.get("result", {}).get("result", {}).get("value", {})
            print("Test 1 (Switch buttons removed):")
            print("  btn-corr-dual exists:", val1.get("btnDualExists"))
            print("  btn-corr-only exists:", val1.get("btnOnlyExists"))
            print("  btn-corr-invert exists:", val1.get("btnInvertExists"))
            print("  Traces on correlation chart:", val1.get("traceNames"))
            assert val1.get("btnDualExists") is False, "btn-corr-dual must be removed!"
            assert val1.get("btnOnlyExists") is False, "btn-corr-only must be removed!"
            assert val1.get("btnInvertExists") is True, "btn-corr-invert must remain!"
            assert any("SPX" in t for t in val1.get("traceNames", [])), "Must have SPX trace!"
            assert any("VIX" in t for t in val1.get("traceNames", [])), "Must have VIX trace!"
            assert any("Correlation" in t for t in val1.get("traceNames", [])), "Must have Correlation trace!"
            print("  -> PASSED: Switch removed and both subplots rendered!")

            # Test 2: Invert toggle works
            res2 = await send_eval("""
            (() => {
                toggleCorrVolInvert();
                const plotEl = document.getElementById('correlation-chart');
                const volTrace = plotEl.data.find(t => t.name && t.name.includes('VIX'));
                const yaxis2Title = plotEl.layout.yaxis2.title.text;
                return {
                    volTraceName: volTrace ? volTrace.name : null,
                    yaxis2Title: yaxis2Title,
                    isVolInverted: isVolInverted
                };
            })()
            """)
            val2 = res2.get("result", {}).get("result", {}).get("value", {})
            print("\nTest 2 (Invert Vol toggle):")
            print("  Vol trace name:", val2.get("volTraceName"))
            print("  yaxis2 title:", val2.get("yaxis2Title"))
            print("  isVolInverted:", val2.get("isVolInverted"))
            assert val2.get("isVolInverted") is False
            print("  -> PASSED: Invert toggle works!")

            # Toggle back to inverted (default)
            await send_eval("toggleCorrVolInvert();")

            # Capture screenshot
            await send_eval("window.scrollTo(0, document.body.scrollHeight);")
            await asyncio.sleep(1)
            mid += 1
            await ws.send(json.dumps({"id": mid, "method": "Page.captureScreenshot", "params": {"format": "png"}}))
            while True:
                resp = json.loads(await ws.recv())
                if resp.get("id") == mid:
                    out = r"C:\Users\barla\.gemini\antigravity\brain\44bf4845-2eea-4a88-8c77-148ad69ac382\screenshot_no_switch_both_subplots.png"
                    with open(out, "wb") as f:
                        f.write(base64.b64decode(resp["result"]["data"]))
                    print(f"\nSaved screenshot to: {out}")
                    break
    finally:
        edge_proc.terminate()

if __name__ == "__main__":
    asyncio.run(test_no_switch())
