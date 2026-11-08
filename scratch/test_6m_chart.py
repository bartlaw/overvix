import numpy as np
import urllib.request, json

res = urllib.request.urlopen('http://127.0.0.1:8000/api/bootstrap')
data = json.loads(res.read())

c6m = data['intraday_correlation'].get('6M', {})
times = c6m.get('times', [])
spx_pct = c6m.get('spx_pct', [])
vix_pt = c6m.get('vix_pt', [])
rolling_corr = c6m.get('rolling_corr', [])

print(f"Times len: {len(times)}")
print(f"SPX pct len: {len(spx_pct)}, min={min(spx_pct)}, max={max(spx_pct)}")
print(f"VIX pt len: {len(vix_pt)}, min={min(vix_pt)}, max={max(vix_pt)}")
print(f"Rolling corr len: {len(rolling_corr)}, min={min(rolling_corr)}, max={max(rolling_corr)}")

# Check zero aligned dual ranges simulation:
y1Min = min(spx_pct)
y1Max = max(spx_pct)
y2Min = min(vix_pt)
y2Max = max(vix_pt)

pad = 1.15
e1Up = max(y1Max, 0.05) * pad
e1Dn = max(-y1Min, 0.05) * pad

# isVolInverted = true (default!)
isVolInverted = True
e2Up = max(-y2Min, 0.1) * pad if isVolInverted else max(y2Max, 0.1) * pad
e2Dn = max(y2Max, 0.1) * pad if isVolInverted else max(-y2Min, 0.1) * pad

alpha1 = e1Dn / (e1Dn + e1Up)
alpha2 = e2Dn / (e2Dn + e2Up)
alpha = max(0.15, min(0.85, (alpha1 + alpha2) / 2.0))

R1 = max(e1Up / (1.0 - alpha), e1Dn / alpha)
R2 = max(e2Up / (1.0 - alpha), e2Dn / alpha)

range1 = [-R1 * alpha, R1 * (1.0 - alpha)]
range2 = [R2 * alpha, -R2 * (1.0 - alpha)] if isVolInverted else [-R2 * alpha, R2 * (1.0 - alpha)]

print(f"Alpha: {alpha}")
print(f"Range 1 (SPX %): {range1}")
print(f"Range 2 (VIX pt, Inverted={isVolInverted}): {range2}")
