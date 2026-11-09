import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import asyncio
import time
from ib_async import IB, Index

async def run():
    ib = IB()
    t0 = time.time()
    await ib.connectAsync('127.0.0.1', 7496, clientId=98, timeout=3)
    print(f"connectAsync took: {time.time() - t0:.2f}s")
    
    t0 = time.time()
    spx = Index('SPX', 'CBOE', 'USD')
    vix = Index('VIX', 'CBOE', 'USD')
    vix3m = Index('VIX3M', 'CBOE', 'USD')
    ndx = Index('NDX', 'NASDAQ', 'USD')
    vxn = Index('VXN', 'CBOE', 'USD')
    await ib.qualifyContractsAsync(spx, vix, ndx, vxn, vix3m)
    print(f"qualifyContractsAsync took: {time.time() - t0:.2f}s")
    
    # 1. 1D 1-min
    t0 = time.time()
    res1 = await asyncio.gather(
        ib.reqHistoricalDataAsync(spx, '', '1 D', '1 min', 'TRADES', True, 1),
        ib.reqHistoricalDataAsync(vix, '', '1 D', '1 min', 'TRADES', True, 1),
        ib.reqHistoricalDataAsync(vix3m, '', '1 D', '1 min', 'TRADES', True, 1),
        ib.reqHistoricalDataAsync(ndx, '', '1 D', '1 min', 'TRADES', True, 1),
        ib.reqHistoricalDataAsync(vxn, '', '1 D', '1 min', 'TRADES', True, 1),
    )
    print(f"1D (1-min) 5 contracts took: {time.time() - t0:.2f}s")

    # 2. 5D 5-mins
    t0 = time.time()
    res2 = await asyncio.gather(
        ib.reqHistoricalDataAsync(spx, '', '5 D', '5 mins', 'TRADES', True, 1),
        ib.reqHistoricalDataAsync(vix, '', '5 D', '5 mins', 'TRADES', True, 1),
        ib.reqHistoricalDataAsync(vix3m, '', '5 D', '5 mins', 'TRADES', True, 1),
        ib.reqHistoricalDataAsync(ndx, '', '5 D', '5 mins', 'TRADES', True, 1),
        ib.reqHistoricalDataAsync(vxn, '', '5 D', '5 mins', 'TRADES', True, 1),
    )
    print(f"5D (5-mins) 5 contracts took: {time.time() - t0:.2f}s")

    # 3. 6M 30-mins
    t0 = time.time()
    res3 = await asyncio.gather(
        ib.reqHistoricalDataAsync(spx, '', '6 M', '30 mins', 'TRADES', True, 1),
        ib.reqHistoricalDataAsync(vix, '', '6 M', '30 mins', 'TRADES', True, 1),
        ib.reqHistoricalDataAsync(vix3m, '', '6 M', '30 mins', 'TRADES', True, 1),
        ib.reqHistoricalDataAsync(ndx, '', '6 M', '30 mins', 'TRADES', True, 1),
        ib.reqHistoricalDataAsync(vxn, '', '6 M', '30 mins', 'TRADES', True, 1),
    )
    print(f"6M (30-mins) 5 contracts took: {time.time() - t0:.2f}s")

    # 4. 2Y 1-day
    t0 = time.time()
    res4 = await asyncio.gather(
        ib.reqHistoricalDataAsync(spx, '', '2 Y', '1 day', 'TRADES', True, 1),
        ib.reqHistoricalDataAsync(vix, '', '2 Y', '1 day', 'TRADES', True, 1),
        ib.reqHistoricalDataAsync(vix3m, '', '2 Y', '1 day', 'TRADES', True, 1),
        ib.reqHistoricalDataAsync(ndx, '', '2 Y', '1 day', 'TRADES', True, 1),
        ib.reqHistoricalDataAsync(vxn, '', '2 Y', '1 day', 'TRADES', True, 1),
    )
    print(f"2Y (1-day) 5 contracts took: {time.time() - t0:.2f}s")

    ib.disconnect()

if __name__ == '__main__':
    asyncio.run(run())
