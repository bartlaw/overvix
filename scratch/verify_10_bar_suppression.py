import math
import numpy as np
import urllib.request, json

res = urllib.request.urlopen('http://127.0.0.1:8000/api/bootstrap')
data = json.loads(res.read())

c1d = data['intraday_correlation'].get('1D', {})
times = c1d.get('times', [])
spx_raw = c1d.get('spot_raw', [])
vix_raw = c1d.get('vol_raw', [])

def compute_anchored_corr_py(spot_raw, vol_raw, anchor_idx, min_bars=10):
    length = len(spot_raw)
    series = [None] * length
    if anchor_idx < 0 or anchor_idx >= length - 2:
        return series, None, 0
    
    s_log = []
    v_log = []
    for i in range(1, length):
        s_prev = spot_raw[i-1]
        s_curr = spot_raw[i]
        v_prev = vol_raw[i-1]
        v_curr = vol_raw[i]
        s_log.append(math.log(s_curr / s_prev) if (s_prev > 0 and s_curr > 0) else 0.0)
        v_log.append(math.log(v_curr / v_prev) if (v_prev > 0 and v_curr > 0) else 0.0)
    
    sum_s = 0.0
    sum_v = 0.0
    sum_s2 = 0.0
    sum_v2 = 0.0
    sum_sv = 0.0
    count = 0
    
    for i in range(anchor_idx, length - 1):
        rs = s_log[i]
        rv = v_log[i]
        sum_s += rs
        sum_v += rv
        sum_s2 += rs * rs
        sum_v2 += rv * rv
        sum_sv += rs * rv
        count += 1
        
        # Suppress during first 10 bars post-anchor
        if count > min_bars:
            mean_s = sum_s / count
            mean_v = sum_v / count
            var_s = (sum_s2 / count) - (mean_s * mean_s)
            var_v = (sum_v2 / count) - (mean_v * mean_v)
            if var_s > 1e-12 and var_v > 1e-12:
                cov = (sum_sv / count) - (mean_s * mean_v)
                r = cov / math.sqrt(var_s * var_v)
                clamped_r = max(-1.0, min(1.0, r))
                series[i + 1] = round(clamped_r, 3)
                
    latest = None
    for i in range(length - 1, anchor_idx - 1, -1):
        if series[i] is not None:
            latest = series[i]
            break
            
    return series, latest, count

# Scenario 1: Anchor with only 5 bars elapsed (near end of day)
anchor_late = len(spx_raw) - 6
ser_late, latest_late, count_late = compute_anchored_corr_py(spx_raw, vix_raw, anchor_late)
non_null_late = [x for x in ser_late if x is not None]
print(f"Scenario 1 (late anchor, {count_late} bars elapsed):")
print(f"  Non-null values in series: {len(non_null_late)}")
print(f"  Latest corr: {latest_late}")
assert len(non_null_late) == 0, "Should have 0 values for <= 10 bars"
assert latest_late is None, "Latest corr should be None"

# Scenario 2: Anchor at bar 50 (340 bars elapsed)
anchor_early = 50
ser_early, latest_early, count_early = compute_anchored_corr_py(spx_raw, vix_raw, anchor_early)
print(f"\nScenario 2 (anchor at idx {anchor_early}, {count_early} bars elapsed):")
print(f"  Bars anchor_idx to anchor_idx+10:")
for offset in range(1, 15):
    idx = anchor_early + offset
    val = ser_early[idx]
    print(f"    Post-anchor bar {offset} (idx {idx}): {val}")

# Verify bars 1..10 are None
for offset in range(1, 11):
    assert ser_early[anchor_early + offset] is None, f"Bar {offset} must be None!"

# Verify bar 11 has a value
assert ser_early[anchor_early + 11] is not None, "Bar 11 must have a value!"
print(f"  First valid value at post-anchor bar 11: {ser_early[anchor_early + 11]}")
print(f"  Latest corr: {latest_early}")
print("\nAll mathematical assertions passed successfully!")
