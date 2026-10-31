import numpy as np
import pandas as pd
import yfinance as yf
from scipy import stats

# 1. Download SPX and VIX data
df = yf.download(['^GSPC', '^VIX'], period='1y', progress=False)['Close']

data = pd.DataFrame()
data['spx_pct'] = df['^GSPC'].pct_change() * 100.0
data['vix_pt'] = df['^VIX'].diff()
data = data.dropna()

# 2. Fit a 60-day rolling Spot-Vol regression
window = 60
data['expected_vix'] = np.nan
data['residual'] = np.nan
data['std_err'] = np.nan

for i in range(window, len(data)):
    sub = data.iloc[i-window:i]
    slope, intercept, _, _, _ = stats.linregress(sub['spx_pct'], sub['vix_pt'])
    
    actual_spx = data['spx_pct'].iloc[i]
    actual_vix = data['vix_pt'].iloc[i]
    
    expected_vix = intercept + slope * actual_spx
    residuals = sub['vix_pt'] - (intercept + slope * sub['spx_pct'])
    
    data.loc[data.index[i], 'expected_vix'] = expected_vix
    data.loc[data.index[i], 'residual'] = actual_vix - expected_vix
    data.loc[data.index[i], 'std_err'] = np.std(residuals)

# 3. Z-Score: deviation from the regression line
data['overvix_z'] = data['residual'] / data['std_err']

# Overvix signal: VIX moved at least 1.5 standard errors above expected
data['overvix_signal'] = data['overvix_z'] > 1.5

latest = data.iloc[-1]
print(f"Date: {latest.name.date()}")
print(f"Actual SPX move: {latest['spx_pct']:.2f}% | Actual VIX change: {latest['vix_pt']:.2f} pts")
print(f"Expected VIX change: {latest['expected_vix']:.2f} pts")
print(f"Overvix Z-Score: {latest['overvix_z']:.2f}")

if latest['overvix_signal']:
    print("🚨 OVERVIX ALERT: Volatility is overreacting -> Mean-reversion long/short-vol setup active.")
else:
    print("Normal spot-vol pricing regime.")