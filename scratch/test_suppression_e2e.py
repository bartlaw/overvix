import asyncio
import json
import os
import subprocess
import time
import urllib.request
import websockets

async def test():
    edge_proc = subprocess.Popen([
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        "--remote-debugging-port=9222",
        "--headless=new",
        "--disable-gpu",
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

            # Wait for chart to be rendered
            for _ in range(30):
                chk = await send_eval("Boolean(document.getElementById('correlation-chart') && document.getElementById('correlation-chart').data && cachedCorr && cachedCorr['1D'])")
                if chk.get("result", {}).get("result", {}).get("value") is True:
                    break
                await asyncio.sleep(0.5)

            # Test 1: Late anchor (5 bars before end of 1D)
            resp1 = await send_eval("""
            (() => {
                const c = cachedCorr['1D'];
                const times = c.times;
                const lateTime = times[times.length - 6];
                setCorrAnchor('custom', lateTime);
                const plotEl = document.getElementById('correlation-chart');
                const traces = plotEl.data ? plotEl.data.map(t => t.name) : [];
                const banner = document.getElementById('corr-recovery-banner');
                return {
                    traceNames: traces,
                    hasAnchoredTrace: traces.some(t => t && t.includes('Anchored Recovery')),
                    bannerText: banner ? banner.innerText : ''
                };
            })()
            """)
            print("Test 1 (5 bars elapsed - suppressed):")
            val1 = resp1.get("result", {}).get("result", {}).get("value", {})
            print("  Banner:", val1.get("bannerText"))
            print("  Has Anchored Trace:", val1.get("hasAnchoredTrace"))
            assert val1.get("hasAnchoredTrace") is False, "Trace must be suppressed for <= 10 bars!"
            assert "Calibrating (≤ 10 bars)" in val1.get("bannerText", ""), "Banner must show calibrating!"

            # Test 2: Early anchor (at bar 50, 339 bars elapsed)
            resp2 = await send_eval("""
            (() => {
                const c = cachedCorr['1D'];
                const times = c.times;
                setCorrAnchor('custom', times[50]);
                const plotEl = document.getElementById('correlation-chart');
                const traces = plotEl.data ? plotEl.data.map(t => t.name) : [];
                const anchTrace = plotEl.data.find(t => t.name && t.name.includes('Anchored Recovery'));
                const anchorIdx = corrAnchor.index;
                const banner = document.getElementById('corr-recovery-banner');
                return {
                    traceNames: traces,
                    hasAnchoredTrace: Boolean(anchTrace),
                    valAt10: anchTrace ? anchTrace.y[anchorIdx + 10] : null,
                    valAt11: anchTrace ? anchTrace.y[anchorIdx + 11] : null,
                    valLatest: anchTrace ? anchTrace.y[anchTrace.y.length - 1] : null,
                    bannerText: banner ? banner.innerText : ''
                };
            })()
            """)
            print("\nTest 2 (339 bars elapsed - active):")
            val2 = resp2.get("result", {}).get("result", {}).get("value", {})
            print("  Banner:", val2.get("bannerText"))
            print("  Has Anchored Trace:", val2.get("hasAnchoredTrace"))
            print("  Value at anchorIdx + 10 (bar 10 post-anchor):", val2.get("valAt10"))
            print("  Value at anchorIdx + 11 (bar 11 post-anchor):", val2.get("valAt11"))
            print("  Latest correlation:", val2.get("valLatest"))
            assert val2.get("hasAnchoredTrace") is True, "Trace must be present for > 10 bars!"
            assert val2.get("valAt10") is None, "Bar 10 post-anchor must be null!"
            assert val2.get("valAt11") is not None, "Bar 11 post-anchor must NOT be null!"
            print("\n>>> ALL TESTS PASSED SUCCESSFULLY! <<<")
    finally:
        edge_proc.terminate()

if __name__ == "__main__":
    asyncio.run(test())
