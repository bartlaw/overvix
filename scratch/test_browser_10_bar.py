import asyncio
import json
import os
import subprocess
import time
import urllib.request
import websockets

async def test_browser():
    edge_proc = subprocess.Popen([
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        "--remote-debugging-port=9222",
        "--headless=new",
        "--disable-gpu",
        "--window-size=1600,1200",
        "http://127.0.0.1:8000"
    ])
    
    await asyncio.sleep(3)
    
    try:
        targets_res = urllib.request.urlopen("http://127.0.0.1:9222/json")
        targets = json.loads(targets_res.read())
        page_target = next(t for t in targets if t.get("type") == "page" and "8000" in t.get("url", ""))
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
            # Wait for cachedCorr to be initialized
            for _ in range(20):
                check = await send("Runtime.evaluate", {
                    "expression": "Boolean(window.cachedCorr && window.cachedCorr['1D'] && window.cachedCorr['1D'].times)",
                    "returnByValue": True
                })
                if check.get("result", {}).get("value") is True:
                    break
                await asyncio.sleep(0.5)
            
            # Test 1: Late anchor (5 bars before end of 1D)
            res1 = await send("Runtime.evaluate", {
                "expression": """
                (() => {
                    const c = cachedCorr['1D'];
                    const times = c.times;
                    const lateTime = times[times.length - 6];
                    setCorrAnchor('custom', lateTime);
                    const banner = document.getElementById('corr-recovery-banner');
                    const plotEl = document.getElementById('chart-correlation');
                    const traces = plotEl.data ? plotEl.data.map(t => t.name) : [];
                    return {
                        lateTime,
                        bannerText: banner ? banner.innerText : '',
                        traceNames: traces
                    };
                })()
                """,
                "returnByValue": True
            })
            val1 = res1.get("result", {}).get("value", {})
            print("Test 1 (Late Anchor <= 10 bars):")
            print(f"  Banner text: {val1.get('bannerText')}")
            print(f"  Trace names in Plotly: {val1.get('traceNames')}")
            assert "Calibrating (≤ 10 bars)" in val1.get("bannerText", "")
            assert not any("Anchored Recovery" in name for name in val1.get("traceNames", []))
            print("  -> PASSED: Banner shows calibrating and trace is suppressed!")
            
            # Test 2: Standard anchor (SPX Low on 6M)
            res2 = await send("Runtime.evaluate", {
                "expression": """
                (() => {
                    switchCorrTf('6M');
                    setCorrAnchor('spot_low');
                    const banner = document.getElementById('corr-recovery-banner');
                    const plotEl = document.getElementById('chart-correlation');
                    const traces = plotEl.data ? plotEl.data.map(t => t.name) : [];
                    const anchTrace = plotEl.data.find(t => t.name && t.name.includes('Anchored Recovery'));
                    const nonNullCount = anchTrace ? anchTrace.y.filter(v => v !== null && v !== undefined).length : 0;
                    const anchorIdx = corrAnchor.index;
                    const valAt10 = anchTrace ? anchTrace.y[anchorIdx + 10] : 'no trace';
                    const valAt11 = anchTrace ? anchTrace.y[anchorIdx + 11] : 'no trace';
                    return {
                        bannerText: banner ? banner.innerText : '',
                        traceNames: traces,
                        nonNullCount,
                        anchorIdx,
                        valAt10,
                        valAt11
                    };
                })()
                """,
                "returnByValue": True
            })
            val2 = res2.get("result", {}).get("value", {})
            print("\nTest 2 (SPX Low Anchor on 6M):")
            print(f"  Banner text: {val2.get('bannerText')}")
            print(f"  Anchor Index: {val2.get('anchorIdx')}")
            print(f"  Value at anchorIdx + 10: {val2.get('valAt10')}")
            print(f"  Value at anchorIdx + 11: {val2.get('valAt11')}")
            print(f"  Non-null count in recovery trace: {val2.get('nonNullCount')}")
            assert val2.get("valAt10") is None, "anchorIdx + 10 must be null (suppressed)"
            assert val2.get("valAt11") is not None, "anchorIdx + 11 must have a value"
            print("  -> PASSED: First 10 bars suppressed, rendering starts on bar 11!")
            
    finally:
        edge_proc.terminate()

if __name__ == "__main__":
    asyncio.run(test_browser())
