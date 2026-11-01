import numpy as np
import pandas as pd
import yfinance as yf
import matplotlib.pyplot as plt

# 1. Fetch VIX and VIX3M daily closing data
# Cboe tickers on Yahoo Finance: ^VIX (30-day) and ^VIX3M (90-day, formerly ^VXV)
tickers = ['^VIX', '^VIX3M']
raw = yf.download(tickers, period='1y', progress=False)['Close']

df = pd.DataFrame()
df['VIX'] = raw['^VIX']
df['VIX3M'] = raw['^VIX3M']
df = df.dropna()

# 2. Calculate the Term Structure Ratio
df['ratio'] = df['VIX'] / df['VIX3M']

# 3. Identify Signals
# Normal contango: ratio < 0.90
# Flattening curve: 0.90 <= ratio < 1.00
# Backwardation / Capitulation Signal: ratio >= 1.00
df['inversion_signal'] = df['ratio'] >= 1.00

latest_date = df.index[-1].strftime('%Y-%m-%d')
latest_vix = df['VIX'].iloc[-1]
latest_vix3m = df['VIX3M'].iloc[-1]
latest_ratio = df['ratio'].iloc[-1]

print(f"Latest Date: {latest_date}")
print(f"VIX: {latest_vix:.2f} | VIX3M: {latest_vix3m:.2f}")
print(f"VIX / VIX3M Ratio: {latest_ratio:.4f}")
if latest_ratio >= 1.00:
    print("🚨 CAPITULATION ALERT: Ratio >= 1.00 (Inversion / Backwardation). Favorable swing long conditions.")
elif latest_ratio >= 0.90:
    print("⚠️ Curve Flattening: Ratio between 0.90 and 1.00. Monitor for spike to 1.00.")
else:
    print("Normal Regime: Implied volatility in contango (< 0.90).")

# 4. Visualization
plt.style.use('dark_background')
fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(12, 8), sharex=True, gridspec_kw={'height_ratios': [2, 1]})

# Top subplot: Individual VIX vs VIX3M paths
ax1.plot(df.index, df['VIX'], label='VIX (30-day)', color='#00E5FF', linewidth=1.5)
ax1.plot(df.index, df['VIX3M'], label='VIX3M (90-day)', color='#FFA726', linewidth=1.5)
ax1.set_ylabel('Index Level', color='#A6B0CF')
ax1.grid(True, color='#202535', linestyle='-', linewidth=0.7)
ax1.legend(loc='upper left', frameon=False)
ax1.set_title(f'VIX vs VIX3M Term Structure & Inversion Monitor (Latest: {latest_ratio:.2f})', 
              loc='left', fontsize=12, color='#D2D7E5', pad=10)

# Bottom subplot: Ratio line with 1.0 threshold & shaded inversion zones
ax2.plot(df.index, df['ratio'], color='#E6D385', linewidth=1.5, label='VIX / VIX3M')
ax2.axhline(1.00, color='#FF5252', linestyle='--', linewidth=1.4, label='Inversion Threshold (1.00)')
ax2.axhline(0.90, color='#FFA726', linestyle=':', linewidth=1.0, label='Flattening Zone (0.90)')

# Highlight periods where the ratio touched or crossed 1.00
ax2.fill_between(df.index, 1.00, df['ratio'], where=(df['ratio'] >= 1.00),
                 color='#FF5252', alpha=0.35, label='Backwardation (Swing Long Trigger)')

ax2.set_ylabel('Ratio', color='#A6B0CF')
ax2.set_xlabel('Date', color='#A6B0CF')
ax2.grid(True, color='#202535', linestyle='-', linewidth=0.7)
ax2.legend(loc='upper left', frameon=False, ncol=4)

plt.tight_layout()
plt.show()