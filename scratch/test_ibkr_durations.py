import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import asyncio
import time
from ib_async import IB, Index

async def run():
    ib = IB()
    await ib.connectAsync('127.0.0.1', 7496, clientId=97, timeout=3)
    spx = Index('SPX', 'CBOE', 'USD')
    vix = Index('VIX', 'CBOE', 'USD')
    await ib.qualifyContractsAsync(spx, vix)
    
    # Test SPX 2Y 1 day alone
    t0 = time.time()
    b = await ib.reqHistoricalDataAsync(spx, '', '2 Y', '1 day', 'TRADES', True, 1)
    print(f"SPX 2Y 1 day took: {time.time() - t0:.2f}s (len={len(b)})")

    # Test SPX 3M 1 day alone
    t0 = time.time()
    b = await ib.reqHistoricalDataAsync(spx, '', '3 M', '1 day', 'TRADES', True, 1)
    print(f"SPX 3M 1 day took: {time.time() - t0:.2f}s (len={len(b)})")

    # Test SPX 1M 30 mins alone
    t0 = time.time()
    b = await ib.reqHistoricalDataAsync(spx, '', '1 M', '30 mins', 'TRADES', True, 1)
    print(f"SPX 1M 30 mins took: {time.time() - t0:.2f}s (len={len(b)})")

    # Test SPX 6M 30 mins alone
    t0 = time.time()
    b = await ib.reqHistoricalDataAsync(spx, '', '6 M', '30 mins', 'TRADES', True, 1)
    print(f"SPX 6M 30 mins took: {time.time() - t0:.2f}s (len={len(b)})")

    ib.disconnect()

if __name__ == '__main__':
    asyncio.run(run())
