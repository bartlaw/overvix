import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import asyncio
import time
from ib_async import IB, Index, util

async def test_fast_startup():
    ib = IB()
    t0 = time.time()
    await ib.connectAsync('127.0.0.1', 7496, clientId=95, timeout=3)
    t_conn = time.time()
    print(f"Connected: {t_conn - t0:.2f}s")
    
    spx = Index('SPX', 'CBOE', 'USD')
    vix = Index('VIX', 'CBOE', 'USD')
    vix3m = Index('VIX3M', 'CBOE', 'USD')
    ndx = Index('NDX', 'NASDAQ', 'USD')
    vxn = Index('VXN', 'CBOE', 'USD')
    await ib.qualifyContractsAsync(spx, vix, ndx, vxn, vix3m)
    t_qual = time.time()
    print(f"Qualified: {t_qual - t_conn:.2f}s")

    # Fetch 1D (1-min), 5D (5-min), and 4M (1-day) in parallel
    res = await asyncio.gather(
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

        ib.reqHistoricalDataAsync(spx, '', '4 M', '1 day', 'TRADES', True, 1),
        ib.reqHistoricalDataAsync(vix, '', '4 M', '1 day', 'TRADES', True, 1),
        ib.reqHistoricalDataAsync(vix3m, '', '4 M', '1 day', 'TRADES', True, 1),
        ib.reqHistoricalDataAsync(ndx, '', '4 M', '1 day', 'TRADES', True, 1),
        ib.reqHistoricalDataAsync(vxn, '', '4 M', '1 day', 'TRADES', True, 1),
    )
    t_hist = time.time()
    print(f"All 1D, 5D, and 4M (15 historical requests) completed in: {t_hist - t_qual:.2f}s!")
    print(f"Total time from start: {t_hist - t0:.2f}s")
    ib.disconnect()

if __name__ == '__main__':
    asyncio.run(test_fast_startup())
