import numpy as np
import urllib.request, json

res = urllib.request.urlopen('http://127.0.0.1:8000/api/bootstrap')
data = json.loads(res.read())

spx_pack = data['intraday_correlation'].get('1D', {})
times = spx_pack.get('times', [])
spx_raw = np.array(spx_pack.get('spot_raw', []))
vix_raw = np.array(spx_pack.get('vol_raw', []))
rolling_corr = spx_pack.get('rolling_corr', [])

print(f"Loaded {len(times)} 1D bars.")

def compute_anchored_stats(spot, vol, anchor_idx):
    s_log = np.log(spot[1:] / spot[:-1])
    v_log = np.log(vol[1:] / vol[:-1])
    
    sub_s = s_log[anchor_idx:]
    sub_v = v_log[anchor_idx:]
    
    if len(sub_s) < 3:
        return None
    r = float(np.corrcoef(sub_s, sub_v)[0, 1])
    return r

# Scenario 1: VIX High (09:30)
vix_high_idx = int(np.argmax(vix_raw))
r1 = compute_anchored_stats(spx_raw, vix_raw, vix_high_idx)
print(f"Scenario 1 (VIX High at {times[vix_high_idx]}): Anchored Corr = {r1:+.4f} (across {len(spx_raw) - vix_high_idx} bars)")

# Scenario 2: Mid-day inflection (idx 120 ~ 11:30)
idx_mid = min(120, len(spx_raw) - 10)
r2 = compute_anchored_stats(spx_raw, vix_raw, idx_mid)
print(f"Scenario 2 (Mid-day at {times[idx_mid]}): Anchored Corr = {r2:+.4f} (across {len(spx_raw) - idx_mid} bars)")

# Scenario 3: Afternoon inflection (idx 240 ~ 13:30)
idx_aft = min(240, len(spx_raw) - 10)
r3 = compute_anchored_stats(spx_raw, vix_raw, idx_aft)
print(f"Scenario 3 (Afternoon at {times[idx_aft]}): Anchored Corr = {r3:+.4f} (across {len(spx_raw) - idx_aft} bars)")

# Scenario 4: SPX Low
spx_low_idx = int(np.argmin(spx_raw))
r4 = compute_anchored_stats(spx_raw, vix_raw, spx_low_idx)
print(f"Scenario 4 (SPX Low at {times[spx_low_idx]}): Anchored Corr = {r4}")
