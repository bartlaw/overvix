import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import asyncio
import time
from ib_async import IB, Index

async def run():
    ib = IB()
    await ib.connectAsync('127.0.0.1', 7496, clientId=96, timeout=3)
    spx = Index('SPX', 'CBOE', 'USD')
    vix = Index('VIX', 'CBOE', 'USD')
    vix3m = Index('VIX3M', 'CBOE', 'USD')
    ndx = Index('NDX', 'NASDAQ', 'USD')
    vxn = Index('VXN', 'CBOE', 'USD')
    await ib.qualifyContractsAsync(spx, vix, vix3m, ndx, vxn)
    
    contracts = [('SPX', spx), ('VIX', vix), ('VIX3M', vix3m), ('NDX', ndx), ('VXN', vxn)]
    
    print("--- Testing 6M 30-min per contract ---")
    for name, c in contracts:
        t0 = time.time()
        try:
            b = await ib.reqHistoricalDataAsync(c, '', '6 M', '30 mins', 'TRADES', True, 1)
            print(f"{name} 6M 30m: {time.time() - t0:.2f}s (len={len(b) if b else 0})")
        except Exception as e:
            print(f"{name} 6M 30m: FAILED in {time.time() - t0:.2f}s: {e}")

    print("\n--- Testing 2Y 1-day per contract ---")
    for name, c in contracts:
        t0 = time.time()
        try:
            b = await ib.reqHistoricalDataAsync(c, '', '2 Y', '1 day', 'TRADES', True, 1)
            print(f"{name} 2Y 1d: {time.time() - t0:.2f}s (len={len(b) if b else 0})")
        except Exception as e:
            print(f"{name} 2Y 1d: FAILED in {time.time() - t0:.2f}s: {e}")

    ib.disconnect()

if __name__ == '__main__':
    asyncio.run(run())
