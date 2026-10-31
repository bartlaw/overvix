import numpy as np
import pandas as pd
import yfinance as yf
import matplotlib.pyplot as plt
from scipy import stats

# 1. Download daily close data for SPX and VIX
tickers = ['^GSPC', '^VIX']
df = yf.download(tickers, period='6mo', progress=False)['Close']

# 2. Calculate SPX % change and VIX absolute point change
data = pd.DataFrame()
data['spx_pct'] = df['^GSPC'].pct_change() * 100.0   # X-axis: % move
data['vix_pt']  = df['^VIX'].diff()                 # Y-axis: point move
data = data.dropna()

# 3. Rolling window (last 60 trading days)
window = 60
recent_data = data.iloc[-window:].copy()

x = recent_data['spx_pct'].values
y = recent_data['vix_pt'].values

# 4. OLS Regression
slope, intercept, r_value, p_value, std_err = stats.linregress(x, y)
r_squared = r_value ** 2
vol_slope = 1.0 / slope if slope != 0 else np.nan

# 5. Volland Point-Based Overvix Calculation
# An Overvix signal triggers when actual VIX change is >= 2.0 points above the regression line
OVERVIX_PTS_THRESHOLD = 2.0

curr_x = x[-1]
curr_y = y[-1]
curr_expected = intercept + slope * curr_x
curr_residual_pts = curr_y - curr_expected
is_overvixed = curr_residual_pts >= OVERVIX_PTS_THRESHOLD
current_ratio = curr_y / curr_x if curr_x != 0 else np.nan

# 6. Plotting
plt.style.use('dark_background')
fig, ax = plt.subplots(figsize=(12, 7))

# Historical points
ax.scatter(x[:-1], y[:-1], color='#E6D385', s=26, alpha=0.75, label='Spot-Vol Points')

# Trendline and +2.0 pt Overvix Threshold Band
x_grid = np.linspace(x.min() - 0.4, x.max() + 0.4, 200)
y_trend = intercept + slope * x_grid
y_overvix = y_trend + OVERVIX_PTS_THRESHOLD

ax.plot(x_grid, y_trend, color='#C5BF85', linewidth=1.8, label='Trendline (Expected)')
ax.plot(x_grid, y_overvix, color='#FF5370', linestyle='--', linewidth=1.5, 
        label=f'Overvix Threshold (+{OVERVIX_PTS_THRESHOLD:.1f} pts)')
ax.fill_between(x_grid, y_overvix, y_overvix + 2.0, color='#FF5370', alpha=0.10, label='Overvix Zone')

# Current Session Point
curr_color = '#FF1744' if is_overvixed else '#00E5FF'
ax.scatter(curr_x, curr_y, color=curr_color, s=60, zorder=5, label='Current Point')

# Annotate current point deviation
status_text = "OVERVIX SIGNAL" if is_overvixed else "No Signal"
ax.annotate(
    f"{curr_residual_pts:+.2f} pts overvixed ({status_text})",
    xy=(curr_x, curr_y),
    xytext=(curr_x + 0.15, curr_y + 0.4),
    arrowprops=dict(facecolor=curr_color, edgecolor=curr_color, arrowstyle='->', lw=1.2),
    fontsize=9,
    fontweight='bold',
    color=curr_color
)

# Zero lines and grid styling
ax.axhline(0, color='#3B4254', linestyle='-', linewidth=0.8)
ax.axvline(0, color='#3B4254', linestyle='-', linewidth=0.8)
ax.grid(True, color='#1E2230', linestyle='-', linewidth=0.7)

# Header metrics display
signal_status = "🚨 OVERVIX TRIGGERED" if is_overvixed else "⚪ NO SIGNAL"
header_metrics = (
    f"R² = {r_squared:.2f}  ·  SLOPE = {slope:.2f}  ·  VOL SLOPE = {vol_slope:.2f}  ·  "
    f"CURRENT RESIDUAL = {curr_residual_pts:+.2f} pts  [{signal_status}]"
)

ax.set_title(f"SPX Statistics  Spot-Vol Correlation (Point-Based Overvix)\n{header_metrics}", 
             loc='left', fontsize=11, color='#D5DAE6', pad=14)

ax.set_xlabel('SPX % Change', color='#A2ACCA', fontsize=10)
ax.set_ylabel('VIX Point Change', color='#A2ACCA', fontsize=10)
ax.legend(loc='upper right', frameon=False, ncol=2)

plt.tight_layout()
plt.show()