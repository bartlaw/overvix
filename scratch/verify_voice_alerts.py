import asyncio
import json
import subprocess
import urllib.request
import websockets
import base64
import os
import random

async def main():
    profile_dir = rf"C:\tmp\edge_profile_voice_{random.randint(10000, 99999)}"
    os.makedirs(profile_dir, exist_ok=True)
    
    proc = subprocess.Popen([
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        "--remote-debugging-port=9464",
        "--headless=new",
        "--disable-gpu",
        "--window-size=1920,1080",
        f"--user-data-dir={profile_dir}",
        "http://127.0.0.1:8082"
    ])
    
    await asyncio.sleep(4.0)
    try:
        res = urllib.request.urlopen("http://127.0.0.1:9464/json")
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

            # Instrument SpeechSynthesis spy in browser window
            spy_res = await cmd("Runtime.evaluate", {
                "expression": """(() => {
                    window.__speechLogs = [];
                    const origSpeak = window.speechSynthesis.speak.bind(window.speechSynthesis);
                    window.speechSynthesis.speak = function(utterance) {
                        window.__speechLogs.push({
                            text: utterance.text,
                            rate: utterance.rate,
                            pitch: utterance.pitch,
                            time: Date.now()
                        });
                        console.log('[SPY SPEAK]', utterance.text);
                        return origSpeak(utterance);
                    };
                    return 'spy installed';
                })()""",
                "returnByValue": True
            })
            print("Spy installed:", spy_res)

            # 1. Check initial navbar button state
            btn_state_initial = await cmd("Runtime.evaluate", {
                "expression": """(() => {
                    const btn = document.getElementById('btn-sound');
                    const icon = document.getElementById('sound-icon');
                    const text = document.getElementById('sound-text');
                    return {
                        hasBtn: Boolean(btn),
                        icon: icon?.textContent,
                        text: text?.textContent,
                        enabled: VoiceManager.enabled
                    };
                })()""",
                "returnByValue": True
            })
            print("Initial Sound/Voice Button State:", json.dumps(btn_state_initial, indent=2))

            # 2. Click navbar button to toggle Voice ON
            click_toggle = await cmd("Runtime.evaluate", {
                "expression": """(() => {
                    const btn = document.getElementById('btn-sound');
                    btn.click();
                    const icon = document.getElementById('sound-icon');
                    const text = document.getElementById('sound-text');
                    return {
                        icon: icon?.textContent,
                        text: text?.textContent,
                        enabled: VoiceManager.enabled,
                        speechLogs: window.__speechLogs
                    };
                })()""",
                "returnByValue": True
            })
            print("After Click Toggle:", json.dumps(click_toggle, indent=2))

            # 3. Open Config Modal and click [Test Voice Alert]
            config_test = await cmd("Runtime.evaluate", {
                "expression": """(() => {
                    const btnCfg = document.getElementById('btn-settings');
                    btnCfg.click();
                    const modal = document.getElementById('modal-settings');
                    const status = document.getElementById('cfg-voice-status')?.textContent;
                    const btnTest = document.getElementById('btn-test-voice');
                    if (btnTest) btnTest.click();
                    return {
                        modalVisible: modal ? !modal.classList.contains('hidden') : false,
                        cfgStatus: status,
                        speechLogs: window.__speechLogs
                    };
                })()""",
                "returnByValue": True
            })
            print("Config Modal & Test Button Result:", json.dumps(config_test, indent=2))

            # Capture screenshot of Config Modal with Voice Alert Section
            shot_cfg = await cmd("Page.captureScreenshot", {})
            if "data" in shot_cfg:
                out_path = r"C:\Users\barla\.gemini\antigravity\brain\44bf4845-2eea-4a88-8c77-148ad69ac382\screenshot_voice_alerts_modal.png"
                with open(out_path, "wb") as f:
                    f.write(base64.b64decode(shot_cfg["data"]))
                print(f"Saved Config modal screenshot to: {out_path}")

            # Close Config Modal
            await cmd("Runtime.evaluate", {
                "expression": """document.getElementById('modal-close').click();"""
            })
            await asyncio.sleep(0.5)

            # 4. Test Red Triangle Alert Trigger & Cooldown logic
            red_triangle_test = await cmd("Runtime.evaluate", {
                "expression": """(() => {
                    const logsBefore = window.__speechLogs.length;
                    
                    // Simulate Event 1: New lowest low
                    const evt1 = { time: '14:30', vixLevel: 25.40, idx: 10 };
                    VoiceManager.checkRedTriangleAlert(evt1, 'SPX', -1.65, 'VIX', 25.40);
                    const fired1 = window.__speechLogs.length > logsBefore;
                    const text1 = window.__speechLogs[window.__speechLogs.length - 1]?.text;

                    // Simulate Event 2: Immediate consecutive drop (within cooldown)
                    const evt2 = { time: '14:31', vixLevel: 25.80, idx: 11 };
                    VoiceManager.checkRedTriangleAlert(evt2, 'SPX', -1.90, 'VIX', 25.80);
                    const fired2 = (window.__speechLogs.length > logsBefore + 1);

                    // Simulate Event 3: After cooldown expires (mocking cooldown)
                    VoiceManager.lastAlertTime = Date.now() - 65000;
                    VoiceManager.checkRedTriangleAlert(evt2, 'SPX', -1.90, 'VIX', 25.80);
                    const fired3 = (window.__speechLogs.length > logsBefore + 1);
                    const text3 = window.__speechLogs[window.__speechLogs.length - 1]?.text;

                    // Simulate Tech (NDX) Mode
                    VoiceManager.lastAlertTime = Date.now() - 65000;
                    const evtNdx = { time: '14:35', vixLevel: 28.10, idx: 15 };
                    VoiceManager.checkRedTriangleAlert(evtNdx, 'Nasdaq', -2.15, 'VXN', 28.10);
                    const textNdx = window.__speechLogs[window.__speechLogs.length - 1]?.text;

                    return {
                        fired1,
                        text1,
                        cooldownSuppressed: !fired2,
                        firedAfterCooldown: fired3,
                        text3,
                        textNdx
                    };
                })()""",
                "returnByValue": True
            })
            print("Red Triangle Trigger & Cooldown Verification:", json.dumps(red_triangle_test, indent=2))

            # Capture screenshot of Navbar in Voice ON state
            clip_res = await cmd("Runtime.evaluate", {
                "expression": """(() => {
                    const bar = document.querySelector('header') || document.querySelector('nav') || document.getElementById('btn-sound').parentElement;
                    const r = bar.getBoundingClientRect();
                    return {x: 0, y: 0, width: 1920, height: 80, scale: 1};
                })()""",
                "returnByValue": True
            })
            clip = clip_res.get("result", {}).get("value")
            if clip:
                shot_nav = await cmd("Page.captureScreenshot", {"clip": clip})
                if "data" in shot_nav:
                    out_path2 = r"C:\Users\barla\.gemini\antigravity\brain\44bf4845-2eea-4a88-8c77-148ad69ac382\screenshot_voice_alerts_navbar.png"
                    with open(out_path2, "wb") as f:
                        f.write(base64.b64decode(shot_nav["data"]))
                    print(f"Saved Navbar screenshot to: {out_path2}")

    finally:
        proc.kill()

asyncio.run(main())
