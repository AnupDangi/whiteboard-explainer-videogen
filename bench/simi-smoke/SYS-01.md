# DNS lookup from name to IP address

[S1] DNS maps names to IP addresses via resolver, root, TLD, and authoritative servers. [S2] The resolver asks down the hierarchy and caches answers for their TTL. [S3] A miss walks root to TLD to authoritative server, which returns the IP. [S4] The client then contacts the IP directly.
