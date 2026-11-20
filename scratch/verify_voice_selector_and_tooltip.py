import asyncio
import json
import subprocess
import urllib.request
import websockets
import base64
import os
import random

async def main():
    profile_dir = rf"C:\tmp\edge_profile_unified_{random.randint(10000, 99999)}"
    os.makedirs(profile_dir, exist_ok=True)
    
    proc = subprocess.Popen([
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        "--remote-debugging-port=9466",
        "--headless=new",
        "--disable-gpu",
        "--window-size=1920,1080",
        f"--user-data-dir={profile_dir}",
        "http://127.0.0.1:8082"
    ])
    
    await asyncio.sleep(4.0)
    try:
        res = urllib.request.urlopen("http://127.0.0.1:9466/json")
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
            await cmd("Runtime.enable")
            await cmd("Log.enable")
            
            # Listen for uncaught exceptions
            eval_errs = await cmd("Runtime.evaluate", {
                "expression": """(() => {
                    return window.__errs || [];
                })()""",
                "returnByValue": True
            })
            await cmd("Page.navigate", {"url": "http://127.0.0.1:8082"})
            await asyncio.sleep(5.0)

            # Check if renderCorrelationChart threw any errors
            chart_eval = await cmd("Runtime.evaluate", {
                "expression": """(() => {
                    try {
                        renderCorrelationChart('dual', '1D');
                        const el = document.getElementById('correlation-chart');
                        return {
                            success: true,
                            dataLen: el?.data?.length,
                            traceNames: el?.data?.map(t => t.name)
                        };
                    } catch (e) {
                        return {
                            success: false,
                            error: e.toString(),
                            stack: e.stack
                        };
                    }
                })()""",
                "returnByValue": True
            })
            print("Explicit renderCorrelationChart Call:", json.dumps(chart_eval, indent=2))

            # 1. Test Voice Selector in Config Modal
            cfg_res = await cmd("Runtime.evaluate", {
                "expression": """(() => {
                    const btnCfg = document.getElementById('btn-settings');
                    btnCfg.click();
                    const sel = document.getElementById('select-voice');
                    const opts = sel ? Array.from(sel.options).map(o => ({ value: o.value, text: o.text })) : [];
                    
                    // Select 2nd option if available
                    if (sel && sel.options.length > 1) {
                        sel.selectedIndex = 1;
                        sel.dispatchEvent(new Event('change'));
                    }
                    
                    return {
                        hasSelect: Boolean(sel),
                        optionCount: opts.length,
                        sampleOptions: opts.slice(0, 5),
                        selectedVoiceURI: VoiceManager.selectedVoiceURI,
                        storedVoiceURI: localStorage.getItem('overvix_voice_uri')
                    };
                })()""",
                "returnByValue": True
            })
            print("Voice Selector Test:", json.dumps(cfg_res, indent=2))

            # Capture screenshot of Config modal with Voice Selector
            shot_cfg = await cmd("Page.captureScreenshot", {})
            if "data" in shot_cfg:
                out_path_cfg = r"C:\Users\barla\.gemini\antigravity\brain\44bf4845-2eea-4a88-8c77-148ad69ac382\screenshot_voice_selector.png"
                with open(out_path_cfg, "wb") as f:
                    f.write(base64.b64decode(shot_cfg["data"]))
                print(f"Saved Voice Selector screenshot to: {out_path_cfg}")

            # Close Config Modal
            await cmd("Runtime.evaluate", { "expression": "document.getElementById('modal-close').click();" })
            await asyncio.sleep(0.5)

            # 2. Test Single Unified Hover Tooltip on Chart
            # Trigger hover via Plotly.Fx.hover at the lowest low point
            hover_res = await cmd("Runtime.evaluate", {
                "expression": """(() => {
                    const gd = document.getElementById('correlation-chart');
                    if (!gd || !gd.data) return { error: 'no chart' };
                    
                    // Find vol trace index
                    const volTraceIdx = gd.data.findIndex(t => t.yaxis === 'y2' && t.mode === 'lines');
                    if (volTraceIdx === -1) return { error: 'no vol trace' };
                    
                    // Find point index with max vol (lowest low)
                    const yArr = gd.data[volTraceIdx].y;
                    let maxIdx = 0;
                    let maxVal = -Infinity;
                    for (let i = 0; i < yArr.length; i++) {
                        if (yArr[i] > maxVal) {
                            maxVal = yArr[i];
                            maxIdx = i;
                        }
                    }
                    
                    // Emulate hover at this curve point
                    Plotly.Fx.hover(gd, [{ curveNumber: volTraceIdx, pointNumber: maxIdx }], 'x');
                    
                    // Inspect visible hover text boxes in DOM
                    const hoverTexts = Array.from(document.querySelectorAll('.hovertext, .hovertext text, g.hovertext')).map(el => el.textContent.trim()).filter(Boolean);
                    const hoverBoxes = document.querySelectorAll('g.hovertext');
                    
                    return {
                        volTraceIdx,
                        pointIdx: maxIdx,
                        hoverBoxCount: hoverBoxes.length,
                        hoverTexts: hoverTexts.slice(0, 5)
                    };
                })()""",
                "returnByValue": True
            })
            print("Unified Hover Tooltip Test:", json.dumps(hover_res, indent=2))
            await asyncio.sleep(0.5)

            # Capture screenshot of the chart with the single unified tooltip
            chart_box = await cmd("Runtime.evaluate", {
                "expression": """(() => {
                    const el = document.getElementById('correlation-chart');
                    if (!el) return null;
                    const r = el.getBoundingClientRect();
                    return { x: Math.max(0, r.x - 10), y: Math.max(0, r.y - 10), width: r.width + 20, height: r.height + 20, scale: 1 };
                })()""",
                "returnByValue": True
            })
            clip = chart_box.get("result", {}).get("value")
            shot_chart = await cmd("Page.captureScreenshot", {"clip": clip} if clip else {})
            if "data" in shot_chart:
                out_path_chart = r"C:\Users\barla\.gemini\antigravity\brain\44bf4845-2eea-4a88-8c77-148ad69ac382\screenshot_unified_tooltip.png"
                with open(out_path_chart, "wb") as f:
                    f.write(base64.b64decode(shot_chart["data"]))
                print(f"Saved Unified Tooltip screenshot to: {out_path_chart}")

    finally:
        proc.kill()

asyncio.run(main())
