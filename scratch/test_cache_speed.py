import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import time
import pickle
import pandas as pd
import numpy as np

# Test saving and loading a large dataframe
dates = pd.date_range('2024-01-01', periods=5000, freq='30min')
df = pd.DataFrame({
    'spx': np.random.randn(5000),
    'vix': np.random.randn(5000),
    'vix3m': np.random.randn(5000),
    'ndx': np.random.randn(5000),
    'vxn': np.random.randn(5000),
}, index=dates)

cache_file = os.path.join('data', 'test_cache.pkl')
t0 = time.time()
with open(cache_file, 'wb') as f:
    pickle.dump(df, f)
print(f"Dump took: {time.time() - t0:.4f}s ({os.path.getsize(cache_file)/1024:.1f} KB)")

t0 = time.time()
with open(cache_file, 'rb') as f:
    df_loaded = pickle.load(f)
print(f"Load took: {time.time() - t0:.4f}s (len={len(df_loaded)})")

if os.path.exists(cache_file):
    os.remove(cache_file)
