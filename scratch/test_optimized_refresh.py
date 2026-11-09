import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import asyncio
import time
import pickle
from datetime import datetime
import pytz
from ib_async import IB, Index, util

CACHE_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'data', 'history_cache.pkl')

async def test_cache_and_background():
    # 1. Fetch 6M 30-min and 2Y 1-day once and save cache to test
    ib = IB()
    await ib.connectAsync('127.0.0.1', 7496, clientId=94, timeout=3)
    spx = Index('SPX', 'CBOE', 'USD')
    vix = Index('VIX', 'CBOE', 'USD')
    vix3m = Index('VIX3M', 'CBOE', 'USD')
    ndx = Index('NDX', 'NASDAQ', 'USD')
    vxn = Index('VXN', 'CBOE', 'USD')
    await ib.qualifyContractsAsync(spx, vix, ndx, vxn, vix3m)

    print("Fetching deep history to seed cache...")
    t0 = time.time()
    (b6m_spx, b6m_vix, b6m_vix3m, b6m_ndx, b6m_vxn,
     spx_bars_2y, vix_bars_2y, vix3m_bars_2y, ndx_bars_2y, vxn_bars_2y) = await asyncio.gather(
        ib.reqHistoricalDataAsync(spx, '', '6 M', '30 mins', 'TRADES', True, 1),
        ib.reqHistoricalDataAsync(vix, '', '6 M', '30 mins', 'TRADES', True, 1),
        ib.reqHistoricalDataAsync(vix3m, '', '6 M', '30 mins', 'TRADES', True, 1),
        ib.reqHistoricalDataAsync(ndx, '', '6 M', '30 mins', 'TRADES', True, 1),
        ib.reqHistoricalDataAsync(vxn, '', '6 M', '30 mins', 'TRADES', True, 1),

        ib.reqHistoricalDataAsync(spx, '', '2 Y', '1 day', 'TRADES', True, 1),
        ib.reqHistoricalDataAsync(vix, '', '2 Y', '1 day', 'TRADES', True, 1),
        ib.reqHistoricalDataAsync(vix3m, '', '2 Y', '1 day', 'TRADES', True, 1),
        ib.reqHistoricalDataAsync(ndx, '', '2 Y', '1 day', 'TRADES', True, 1),
        ib.reqHistoricalDataAsync(vxn, '', '2 Y', '1 day', 'TRADES', True, 1),
    )
    print(f"Deep history fetched in {time.time() - t0:.2f}s")
    
    from dashboard import bars_to_df, safe_to_series
    import pandas as pd
    dfs_pool = {
        name: bars_to_df(bars, name)
        for name, bars in zip(['spx', 'vix', 'vix3m', 'ndx', 'vxn'],
                              [b6m_spx, b6m_vix, b6m_vix3m, b6m_ndx, b6m_vxn])
    }
    df_s2y = safe_to_series(spx_bars_2y, 'spx')
    df_v2y = safe_to_series(vix_bars_2y, 'vix')
    df_v32y = safe_to_series(vix3m_bars_2y, 'vix3m')
    df_n2y = safe_to_series(ndx_bars_2y, 'ndx')
    df_vx2y = safe_to_series(vxn_bars_2y, 'vxn')
    df_daily = pd.concat([df_s2y, df_v2y, df_v32y, df_n2y, df_vx2y], axis=1).dropna()
    
    now_et = datetime.now(pytz.timezone('US/Eastern'))
    today_et = now_et.strftime('%Y-%m-%d')
    cache_payload = {
        'cache_date': today_et,
        'dfs_pool': dfs_pool,
        'df_daily': df_daily
    }
    with open(CACHE_PATH, 'wb') as f:
        pickle.dump(cache_payload, f)
    print(f"Cache saved to {CACHE_PATH} ({os.path.getsize(CACHE_PATH)/1024:.1f} KB)")
    
    # Now simulate fast startup using cache!
    print("\n--- SIMULATING FAST STARTUP WITH CACHE ---")
    t_start = time.time()
    # 1. Load cache
    with open(CACHE_PATH, 'rb') as f:
        cached = pickle.load(f)
    t_cache = time.time()
    print(f"1. Cache loaded from disk: {t_cache - t_start:.4f}s")
    
    # 2. Fetch 1D (1-min) and 5D (5-min) from IBKR in parallel
    (b1_spx, b1_vix, b1_vix3m, b1_ndx, b1_vxn,
     b5_spx, b5_vix, b5_vix3m, b5_ndx, b5_vxn) = await asyncio.gather(
        ib.reqHistoricalDataAsync(spx, '', '1 D', '1 min', 'TRADES', True, 1),
        ib.reqHistoricalDataAsync(vix, '', '1 D', '1 min', 'TRADES', True, 1),
        ib.reqHistoricalDataAsync(vix3m, '', '1 D', '1 min', 'TRADES', True, 1),
        ib.reqHistoricalDataAsync(ndx, '', '1 D', '1 min', 'TRADES', True, 1),
        ib.reqHistoricalDataAsync(vxn, '', '1 D', '1 min', 'TRADES', True, 1),

        ib.reqHistoricalDataAsync(spx, '', '5 D', '5 mins', 'TRADES', True, 1),
        ib.reqHistoricalDataAsync(vix, '', '5 D', '5 mins', 'TRADES', True, 1),
        ib.reqHistoricalDataAsync(vix3m, '', '5 D', '5 mins', 'TRADES', True, 1),
        ib.reqHistoricalDataAsync(ndx, '', '5 D', '5 mins', 'TRADES', True, 1),
        ib.reqHistoricalDataAsync(vxn, '', '5 D', '5 mins', 'TRADES', True, 1),
    )
    t_fast_hist = time.time()
    print(f"2. 1D & 5D bars fetched: {t_fast_hist - t_cache:.2f}s")
    print(f"TOTAL STARTUP TIME WITH CACHE: {t_fast_hist - t_start:.2f}s!")
    
    ib.disconnect()

if __name__ == '__main__':
    asyncio.run(test_cache_and_background())
