# SYS-03

A cache hit answers from nearby storage without contacting origin: fast but possibly stale. A miss pays full origin latency and usually stores the answer for reuse. Freshness is controlled by TTL or validation: longer reuse is faster yet staler. Caching trades latency and load against exact freshness.
