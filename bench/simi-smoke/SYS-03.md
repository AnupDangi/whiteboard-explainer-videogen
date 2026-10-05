# Caching, latency, and stale data

[S1] A cache hit answers from nearby storage without contacting origin: fast but possibly stale. [S2] A miss pays full origin latency and usually stores the answer for reuse. [S3] Freshness is controlled by TTL or validation: longer reuse is faster yet staler. [S4] Caching trades latency and load against exact freshness.
