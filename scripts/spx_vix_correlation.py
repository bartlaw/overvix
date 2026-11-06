import numpy as np
import pandas as pd
import yfinance as yf
import matplotlib.pyplot as plt
from scipy import stats

# 1. Download SPX and VIX daily closing data
tickers = ['^GSPC', '^VIX']
df = yf.download(tickers, period='6mo', progress=False)['Close']

# 2. Compute SPX percentage change and VIX absolute point change
data = pd.DataFrame()
data['spx_pct'] = df['^GSPC'].pct_change() * 100.0   # X-axis: % change
data['vix_pt']  = df['^VIX'].diff()                 # Y-axis: point change
data = data.dropna()

# 3. Filter to the last ~60 trading days (~3 months)
window = 60
recent_data = data.iloc[-window:].copy()

x = recent_data['spx_pct'].values
y = recent_data['vix_pt'].values

# 4. Perform Linear Regression (OLS)
slope, intercept, r_value, p_value, std_err = stats.linregress(x, y)
r_squared = r_value ** 2
vol_slope = 1.0 / slope if slope != 0 else np.nan

# Current (latest) point metrics
curr_x = x[-1]
curr_y = y[-1]
current_ratio = curr_y / curr_x if curr_x != 0 else np.nan

# 5. Plotting (styled after the dark-themed Volland dashboard)
plt.style.use('dark_background')
fig, ax = plt.subplots(figsize=(11, 6))

# Plot all historical window points
ax.scatter(x[:-1], y[:-1], color='#E6D385', s=24, alpha=0.85, label='Spot-Vol Points')

# Plot the latest point
ax.scatter(curr_x, curr_y, color='#00CED1', s=35, zorder=5, label='Current Point')

# Plot regression trendline
x_vals = np.linspace(x.min() - 0.2, x.max() + 0.2, 100)
ax.plot(x_vals, intercept + slope * x_vals, color='#A29F68', linewidth=1.8, label='Trendline')

# Reference axes
ax.axhline(0, color='#555A6E', linestyle='-', linewidth=0.8)
ax.axvline(0, color='#555A6E', linestyle='-', linewidth=0.8)
ax.grid(True, color='#262C3D', linestyle='-', linewidth=0.7)

# Title & Metrics Header
metrics_str = f"R² = {r_squared:.2f}  ·  SLOPE = {slope:.2f}  ·  VOL SLOPE = {vol_slope:.2f}  ·  CURRENT RATIO = {current_ratio:.2f}"
ax.set_title(f"SPX Statistics  Spot-Vol Correlation\n{metrics_str}", 
             loc='left', fontsize=11, color='#C5C8D8', pad=12)

ax.set_xlabel('SPX % Change', color='#A6B0CF', fontsize=10)
ax.set_ylabel('VIX Point Change', color='#A6B0CF', fontsize=10)
ax.legend(loc='upper center', frameon=False, ncol=3)

plt.tight_layout()
output_path = 'spx_vix_correlation.png'
plt.savefig(output_path, dpi=300, bbox_inches='tight')
print(f"Plot saved successfully to {output_path}")
plt.show()