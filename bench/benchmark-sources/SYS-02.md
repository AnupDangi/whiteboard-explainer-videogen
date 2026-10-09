# SYS-02

The client opens a connection and sends method, path, headers, and optional body. Routing selects a handler; the handler reads state, computes, and builds a response. The server returns status code plus body (200 data, 404 missing, 500 server fault). HTTP is stateless per request; sessions use cookies or tokens.
