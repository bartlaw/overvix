import asyncio
import json
import subprocess
import urllib.request
import websockets
import tempfile
import shutil

async def main():
    profile_dir = tempfile.mkdtemp(prefix="edge_voice_persist_")
    proc = subprocess.Popen([
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        "--remote-debugging-port=9470",
        "--headless=new",
        "--disable-gpu",
        "--window-size=1920,1080",
        f"--user-data-dir={profile_dir}",
        "http://127.0.0.1:8082"
    ])
    
    await asyncio.sleep(4.0)
    try:
        res = urllib.request.urlopen("http://127.0.0.1:9470/json")
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
            await asyncio.sleep(3.0)

            # 1. Check default state (muted)
            res1 = await cmd("Runtime.evaluate", {
                "expression": """(() => {
                    const btn = document.getElementById('btn-sound');
                    const text = document.getElementById('sound-text')?.textContent;
                    const icon = document.getElementById('sound-icon')?.textContent;
                    const cfg = document.getElementById('cfg-voice-status')?.textContent;
                    const ls = localStorage.getItem('overvix_voice_enabled');
                    return {
                        vmEnabled: window.VoiceManager ? window.VoiceManager.enabled : null,
                        btnText: text,
                        btnIcon: icon,
                        cfgText: cfg,
                        lsValue: ls
                    };
                })()""",
                "returnByValue": True
            })
            print("Initial state (default):", res1.get("result", {}).get("value"))

            # 2. Click btn-sound to turn it ON
            res2 = await cmd("Runtime.evaluate", {
                "expression": """(() => {
                    const btn = document.getElementById('btn-sound');
                    btn.click();
                    return {
                        vmEnabled: window.VoiceManager ? window.VoiceManager.enabled : null,
                        btnText: document.getElementById('sound-text')?.textContent,
                        btnIcon: document.getElementById('sound-icon')?.textContent,
                        cfgText: document.getElementById('cfg-voice-status')?.textContent,
                        lsValue: localStorage.getItem('overvix_voice_enabled')
                    };
                })()""",
                "returnByValue": True
            })
            print("After clicking btn-sound ON:", res2.get("result", {}).get("value"))

            # 3. Reload page to test persistence across page loads
            await cmd("Page.reload")
            await asyncio.sleep(3.0)

            res3 = await cmd("Runtime.evaluate", {
                "expression": """(() => {
                    return {
                        vmEnabled: window.VoiceManager ? window.VoiceManager.enabled : null,
                        btnText: document.getElementById('sound-text')?.textContent,
                        btnIcon: document.getElementById('sound-icon')?.textContent,
                        cfgText: document.getElementById('cfg-voice-status')?.textContent,
                        lsValue: localStorage.getItem('overvix_voice_enabled'),
                        hasOpacity60: document.getElementById('btn-sound')?.classList.contains('opacity-60')
                    };
                })()""",
                "returnByValue": True
            })
            print("After Page Reload (should still be Voice ON):", res3.get("result", {}).get("value"))

            # 4. Open Settings modal and click cfg-voice-status to toggle OFF
            res4 = await cmd("Runtime.evaluate", {
                "expression": """(() => {
                    const cfg = document.getElementById('cfg-voice-status');
                    cfg.click();
                    return {
                        vmEnabled: window.VoiceManager ? window.VoiceManager.enabled : null,
                        btnText: document.getElementById('sound-text')?.textContent,
                        btnIcon: document.getElementById('sound-icon')?.textContent,
                        cfgText: document.getElementById('cfg-voice-status')?.textContent,
                        lsValue: localStorage.getItem('overvix_voice_enabled')
                    };
                })()""",
                "returnByValue": True
            })
            print("After clicking modal badge to toggle OFF:", res4.get("result", {}).get("value"))

            # 5. Reload again to verify persisted OFF state
            await cmd("Page.reload")
            await asyncio.sleep(3.0)

            res5 = await cmd("Runtime.evaluate", {
                "expression": """(() => {
                    return {
                        vmEnabled: window.VoiceManager ? window.VoiceManager.enabled : null,
                        btnText: document.getElementById('sound-text')?.textContent,
                        btnIcon: document.getElementById('sound-icon')?.textContent,
                        cfgText: document.getElementById('cfg-voice-status')?.textContent,
                        lsValue: localStorage.getItem('overvix_voice_enabled')
                    };
                })()""",
                "returnByValue": True
            })
            print("After second reload (should still be Muted):", res5.get("result", {}).get("value"))

    finally:
        proc.terminate()
        try:
            proc.wait(timeout=3)
        except Exception:
            proc.kill()
        shutil.rmtree(profile_dir, ignore_errors=True)

if __name__ == '__main__':
    asyncio.run(main())
