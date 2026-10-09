# SYS-01

DNS maps names to IP addresses via resolver, root, TLD, and authoritative servers. The resolver asks down the hierarchy and caches answers for their TTL. A miss walks root to TLD to authoritative server, which returns the IP. The client then contacts the IP directly.
