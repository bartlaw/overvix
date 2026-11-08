import numpy as np
import pandas as pd
import urllib.request, json

res = urllib.request.urlopen('http://127.0.0.1:8000/api/bootstrap')
data = json.loads(res.read())

for tf in ['1D', '5D', '1M', '3M', '6M', 'YTD', '1Y', 'MAX']:
    spx_pack = data['intraday_correlation'].get(tf, {})
    spx_raw = spx_pack.get('spot_raw', [])
    vix_raw = spx_pack.get('vol_raw', [])
    if len(spx_raw) > 10:
        df = pd.DataFrame({'spx': spx_raw, 'vix': vix_raw})
        # Raw levels corr
        corr_raw = df['spx'].corr(df['vix'])
        # Log returns corr (Δ ln S vs Δ ln VIX)
        spx_log = np.log(df['spx']).diff()
        vix_log = np.log(df['vix']).diff()
        corr_log_full = spx_log.corr(vix_log)
        
        # Rolling window
        win = 30 if tf == '1D' else (78 if tf == '5D' else (39 if tf == '1M' else (130 if tf == '3M' else (195 if tf == '6M' else (20 if tf == 'YTD' else 60)))))
        rolling_log = spx_log.rolling(win, min_periods=5).corr(vix_log).iloc[-1]
        
        print(f"[{tf:4s}] N={len(df):4d} | Raw level corr (spurious): {corr_raw:+.4f} | Full Log corr: {corr_log_full:+.4f} | Roll Win={win:3d} Log corr: {rolling_log:+.4f}")
