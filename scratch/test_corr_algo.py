import numpy as np

# Sample prices
spot = [5000, 5010, 5005, 5020, 5030, 5025, 5040, 5050]
vol = [20.0, 19.5, 19.8, 19.2, 18.9, 19.1, 18.5, 18.2]

# Log returns
s_log = [np.log(spot[i] / spot[i-1]) for i in range(1, len(spot))]
v_log = [np.log(vol[i] / vol[i-1]) for i in range(1, len(vol))]

# Python np.corrcoef
py_corr = np.corrcoef(s_log, v_log)[0, 1]

# Incremental JS algo
sumS = sum(s_log)
sumV = sum(v_log)
sumS2 = sum(x*x for x in s_log)
sumV2 = sum(x*x for x in v_log)
sumSV = sum(x*y for x, y in zip(s_log, v_log))
count = len(s_log)

meanS = sumS / count
meanV = sumV / count
varS = (sumS2 / count) - (meanS * meanS)
varV = (sumV2 / count) - (meanV * meanV)
cov = (sumSV / count) - (meanS * meanV)
js_corr = cov / np.sqrt(varS * varV)

print(f"Python numpy corrcoef: {py_corr:.8f}")
print(f"Incremental JS formula: {js_corr:.8f}")
print(f"Difference: {abs(py_corr - js_corr):.2e}")
