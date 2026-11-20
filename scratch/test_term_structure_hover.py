import asyncio
import json
import subprocess
import urllib.request
import websockets
import tempfile
import shutil

async def main():
    profile_dir = tempfile.mkdtemp(prefix="edge_ts_hover_")
    proc = subprocess.Popen([
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        "--remote-debugging-port=9475",
        "--headless=new",
        "--disable-gpu",
        "--window-size=1920,2160",
        f"--user-data-dir={profile_dir}",
        "http://127.0.0.1:8082"
    ])
    
    await asyncio.sleep(4.0)
    try:
        res = urllib.request.urlopen("http://127.0.0.1:9475/json")
        targets = json.loads(res.read())
        pages = [t for t in targets if t.get("type") == "page" and "sync-confirmation" not in t.get("url", "") and "edge://" not in t.get("url", "")]
        target = pages[0] if pages else targets[0]
        print("Connected to target:", target.get("url"))
        
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
            await asyncio.sleep(4.0)

            # Find coordinates of term-structure-chart
            pos_res = await cmd("Runtime.evaluate", {
                "expression": """(() => {
                    const gd = document.getElementById('term-structure-chart');
                    if (!gd || !gd.data) return null;
                    const r = gd.getBoundingClientRect();
                    const fl = gd._fullLayout;
                    if (fl && fl.xaxis && fl.yaxis) {
                        const trace = gd.data[0]; // traceVIX
                        if (trace && trace.x && trace.x.length > 0) {
                            const lastIdx = Math.floor(trace.x.length * 0.75);
                            const xVal = trace.x[lastIdx];
                            const yVal = trace.y[lastIdx];
                            const px = fl.xaxis.d2p(new Date(xVal).getTime());
                            const py = fl.yaxis.d2p(yVal);
                            return {
                                clientX: r.left + px,
                                clientY: r.top + py,
                                rX: r.left,
                                rY: r.top,
                                rW: r.width,
                                rH: r.height,
                                xVal: xVal,
                                yVal: yVal
                            };
                        }
                    }
                    return { clientX: r.left + r.width * 0.75, clientY: r.top + r.height * 0.4, rX: r.left, rY: r.top, rW: r.width, rH: r.height };
                })()""",
                "returnByValue": True
            })
            pos = pos_res.get("result", {}).get("value")
            print("Calculated Target Position on Term Structure Chart:", pos)

            # Move mouse over that point to trigger hover
            await cmd("Input.dispatchMouseEvent", {
                "type": "mouseMoved",
                "x": pos["clientX"],
                "y": pos["clientY"]
            })
            await asyncio.sleep(1.0)

            # Inspect hover DOM on term-structure-chart
            hover_info = await cmd("Runtime.evaluate", {
                "expression": """(() => {
                    const gd = document.getElementById('term-structure-chart');
                    if (!gd) return null;
                    const hoverLayers = gd.querySelectorAll('.hoverlayer');
                    const hoverTexts = [];
                    let hoverGCount = 0;
                    hoverLayers.forEach(hl => {
                        const hoverGs = hl.querySelectorAll('g.hovertext');
                        hoverGCount += hoverGs.length;
                        hoverGs.forEach(g => {
                            hoverTexts.push(g.textContent);
                        });
                    });
                    return {
                        hoverGCount: hoverGCount,
                        hoverGTexts: hoverTexts
                    };
                })()""",
                "returnByValue": True
            })
            print("Hover DOM Inspection on Term Structure Chart:", json.dumps(hover_info, indent=2))

            # Take clean screenshot of the term-structure-chart
            ss = await cmd("Page.captureScreenshot", {
                "format": "png",
                "clip": {
                    "x": max(0, pos["rX"] - 10),
                    "y": max(0, pos["rY"] - 10),
                    "width": min(1900, pos["rW"] + 20),
                    "height": pos["rH"] + 20,
                    "scale": 1
                }
            })
            import base64
            out_path = r"C:\Users\barla\.gemini\antigravity\brain\44bf4845-2eea-4a88-8c77-148ad69ac382\screenshot_term_structure_unified_tooltip.png"
            with open(out_path, "wb") as f:
                f.write(base64.b64decode(ss.get("data", "")))
            print("Saved Term Structure Unified Tooltip screenshot to:", out_path)

    finally:
        proc.terminate()
        try:
            proc.wait(timeout=3)
        except Exception:
            proc.kill()
        shutil.rmtree(profile_dir, ignore_errors=True)

if __name__ == '__main__':
    asyncio.run(main())
