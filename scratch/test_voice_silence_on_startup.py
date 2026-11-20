import asyncio
import json
import subprocess
import urllib.request
import websockets
import tempfile
import shutil

async def main():
    profile_dir = tempfile.mkdtemp(prefix="edge_voice_test_")
    proc = subprocess.Popen([
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        "--remote-debugging-port=9472",
        "--headless=new",
        "--disable-gpu",
        "--window-size=1920,1080",
        f"--user-data-dir={profile_dir}",
        "http://127.0.0.1:8082"
    ])
    
    await asyncio.sleep(4.0)
    try:
        res = urllib.request.urlopen("http://127.0.0.1:9472/json")
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

            # First, set localStorage to voice enabled=true so we test the most critical scenario
            await cmd("Runtime.evaluate", {
                "expression": """(() => {
                    localStorage.setItem('overvix_voice_enabled', 'true');
                })()"""
            })

            # Reload page and inject speech spy before other scripts run
            await cmd("Page.addScriptToEvaluateOnNewDocument", {
                "source": """
                    window.__spokenMessages = [];
                    const origSpeak = window.speechSynthesis.speak.bind(window.speechSynthesis);
                    window.speechSynthesis.speak = function(utter) {
                        window.__spokenMessages.push(utter.text);
                        console.log('[SPY SPEAK]', utter.text);
                        return origSpeak(utter);
                    };
                """
            })

            print("Reloading page with voice ENABLED in localStorage...")
            await cmd("Page.reload")
            
            # Wait 4 seconds for full bootstrap and rendering
            await asyncio.sleep(4.0)

            # Check if any messages were spoken during startup
            check1 = await cmd("Runtime.evaluate", {
                "expression": """(() => {
                    return {
                        spokenCount: window.__spokenMessages.length,
                        spokenList: window.__spokenMessages,
                        btnText: document.getElementById('sound-text')?.textContent,
                        cfgText: document.getElementById('cfg-voice-status')?.textContent
                    };
                })()""",
                "returnByValue": True
            })
            val1 = check1.get("result", {}).get("value")
            print("Startup with Voice ON result:", val1)
            assert val1["spokenCount"] == 0, f"FAIL: Expected 0 messages on startup, got: {val1['spokenList']}"
            assert val1["btnText"] == "Voice ON", f"FAIL: Button should say Voice ON"

            # Now test manual test voice button to confirm speech still works when requested
            testBtnRes = await cmd("Runtime.evaluate", {
                "expression": """(() => {
                    const btn = document.getElementById('btn-test-voice');
                    if (btn) btn.click();
                    return {
                        spokenCount: window.__spokenMessages.length,
                        latest: window.__spokenMessages[window.__spokenMessages.length - 1]
                    };
                })()""",
                "returnByValue": True
            })
            valTest = testBtnRes.get("result", {}).get("value")
            print("After clicking Test Voice Button:", valTest)
            assert valTest["spokenCount"] == 1, "FAIL: Test button should have spoken"
            assert "New VIX high" in valTest["latest"], f"FAIL: Expected 'New VIX high' in '{valTest['latest']}'"

            # Now test with Voice MUTED: reload and check
            await cmd("Runtime.evaluate", {
                "expression": """(() => {
                    localStorage.setItem('overvix_voice_enabled', 'false');
                })()"""
            })
            print("Reloading page with voice MUTED in localStorage...")
            await cmd("Page.reload")
            await asyncio.sleep(4.0)

            check2 = await cmd("Runtime.evaluate", {
                "expression": """(() => {
                    return {
                        spokenCount: window.__spokenMessages.length,
                        spokenList: window.__spokenMessages,
                        btnText: document.getElementById('sound-text')?.textContent
                    };
                })()""",
                "returnByValue": True
            })
            val2 = check2.get("result", {}).get("value")
            print("Startup with Voice MUTED result:", val2)
            assert val2["spokenCount"] == 0, f"FAIL: Expected 0 messages, got: {val2['spokenList']}"
            assert val2["btnText"] == "Muted", f"FAIL: Button should say Muted"

            print("\n>>> ALL TESTS PASSED! Opening the app is 100% silent in both ON and MUTED states. <<<")

    finally:
        proc.terminate()
        try:
            proc.wait(timeout=3)
        except Exception:
            proc.kill()
        shutil.rmtree(profile_dir, ignore_errors=True)

if __name__ == '__main__':
    asyncio.run(main())
