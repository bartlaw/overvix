import numpy as np
import pandas as pd
import yfinance as yf
import matplotlib.pyplot as plt
from scipy import stats

# 1. Fetch SPX and VIX daily close data
tickers = ['^GSPC', '^VIX']
df = yf.download(tickers, period='6mo', progress=False)['Close']

# 2. Daily SPX % change and VIX absolute point change
data = pd.DataFrame()
data['spx_pct'] = df['^GSPC'].pct_change() * 100.0   # X: % change
data['vix_pt']  = df['^VIX'].diff()                 # Y: point change
data = data.dropna()

# 3. Rolling window (last ~60 trading sessions)
window = 60
recent_data = data.iloc[-window:].copy()

x = recent_data['spx_pct'].values
y = recent_data['vix_pt'].values

# 4. OLS Regression
slope, intercept, r_value, p_value, std_err = stats.linregress(x, y)
r_squared = r_value ** 2
vol_slope = 1.0 / slope if slope != 0 else np.nan

# Calculate residuals and threshold
expected_y_all = intercept + slope * x
residuals = y - expected_y_all
residual_std = np.std(residuals)

# Overvix threshold (typically +2.0 standard deviations / ~2-2.5 pts above line)
OVERVIX_STD_MULT = 2.0

# Latest / Current session metrics
curr_x = x[-1]
curr_y = y[-1]
curr_expected = intercept + slope * curr_x
curr_overvix_pts = curr_y - curr_expected
is_overvixed = curr_overvix_pts >= (OVERVIX_STD_MULT * residual_std)
current_ratio = curr_y / curr_x if curr_x != 0 else np.nan

# 5. Plotting
plt.style.use('dark_background')
fig, ax = plt.subplots(figsize=(12, 7))

# Historical points
ax.scatter(x[:-1], y[:-1], color='#E6D385', s=24, alpha=0.75, label='Spot-Vol Points')

# Trendline & Overvix Band
x_grid = np.linspace(x.min() - 0.4, x.max() + 0.4, 200)
y_trend = intercept + slope * x_grid
y_overvix = y_trend + (OVERVIX_STD_MULT * residual_std)

ax.plot(x_grid, y_trend, color='#C5BF85', linewidth=1.8, label='Expected Trendline')
ax.plot(x_grid, y_overvix, color='#FF5252', linestyle='--', linewidth=1.5, label=f'Overvix Threshold (+{OVERVIX_STD_MULT:.1f}σ)')
ax.fill_between(x_grid, y_overvix, y_overvix + 2.5, color='#FF5252', alpha=0.08, label='Overvix Zone')

# Current Point
curr_color = '#FF1744' if is_overvixed else '#00E5FF'
ax.scatter(curr_x, curr_y, color=curr_color, s=55, zorder=5, label='Current Point')

# Annotate current point deviation
ax.annotate(
    f"{curr_overvix_pts:+.2f} pts {'(OVERVIX SIGNAL!)' if is_overvixed else '(No Signal)'}",
    xy=(curr_x, curr_y),
    xytext=(curr_x + 0.15, curr_y + 0.35),
    arrowprops=dict(facecolor=curr_color, arrowstyle='->', lw=1.2),
    fontsize=9,
    fontweight='bold',
    color=curr_color
)

# Reference zero lines and styling
ax.axhline(0, color='#3A4053', linestyle='-', linewidth=0.9)
ax.axvline(0, color='#3A4053', linestyle='-', linewidth=0.9)
ax.grid(True, color='#1E2333', linestyle='-', linewidth=0.7)

# Status title
signal_badge = "🚨 OVERVIX TRIGGERED" if is_overvixed else "🟢 NORMAL REGIME"
metrics_str = (
    f"R² = {r_squared:.2f}  ·  SLOPE = {slope:.2f}  ·  VOL SLOPE = {vol_slope:.2f}  ·  "
    f"CURRENT OVERVIX = {curr_overvix_pts:+.2f} pts  ·  [{signal_badge}]"
)
ax.set_title(f"SPX Statistics — Spot-Vol Correlation & Overvix Monitor\n{metrics_str}", 
             loc='left', fontsize=11, color='#D2D7E5', pad=14)

ax.set_xlabel('SPX % Change', color='#A6B0CF', fontsize=10)
ax.set_ylabel('VIX Point Change', color='#A6B0CF', fontsize=10)
ax.legend(loc='upper right', frameon=False, ncol=2)

plt.tight_layout()
plt.show()