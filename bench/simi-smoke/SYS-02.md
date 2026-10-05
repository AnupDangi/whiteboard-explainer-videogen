# HTTP request through a web service

[S1] The client opens a connection and sends method, path, headers, and optional body. [S2] Routing selects a handler; the handler reads state, computes, and builds a response. [S3] The server returns status code plus body (200 data, 404 missing, 500 server fault). [S4] HTTP is stateless per request; sessions use cookies or tokens.
