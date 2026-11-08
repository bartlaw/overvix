import numpy as np
import pandas as pd
import urllib.request, json

res = urllib.request.urlopen('http://127.0.0.1:8000/api/bootstrap')
data = json.loads(res.read())

spx_pack = data['intraday_correlation'].get('1D', {})
times = spx_pack.get('times', [])
spx_raw = np.array(spx_pack.get('spot_raw', []))
vix_raw = np.array(spx_pack.get('vol_raw', []))
rolling_corr = spx_pack.get('rolling_corr', [])

for anchor_idx in [50, 150, 250]:
    spx_log = np.log(spx_raw[1:] / spx_raw[:-1])
    vix_log = np.log(vix_raw[1:] / vix_raw[:-1])
    
    sub_s = spx_log[anchor_idx:]
    sub_v = vix_log[anchor_idx:]
    r_post = float(np.corrcoef(sub_s, sub_v)[0, 1])
    print(f"Anchor at {times[anchor_idx]} (idx {anchor_idx}): Post-Anchor Cumulative Corr = {r_post:+.4f} (across {len(sub_s)} bars), Rolling Corr = {rolling_corr[-1]}")
