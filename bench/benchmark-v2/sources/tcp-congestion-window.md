# TCP congestion window

TCP limits how much unacknowledged data a sender may have in flight. Besides the receiver's advertised window, the sender keeps a congestion window, cwnd, which estimates how much the network can carry. The sender may send at most the smaller of cwnd and the receiver window.

A connection starts in slow start. cwnd begins at a small number of segments and doubles every round-trip time, because each acknowledgment increases cwnd by one segment. Growth is exponential until cwnd reaches the slow start threshold, ssthresh.

After that, TCP enters congestion avoidance. cwnd grows by about one segment per round-trip time, which is linear growth. This is the additive increase part of AIMD.

Packet loss signals congestion. In TCP Reno, if loss is detected by three duplicate acknowledgments, the sender sets ssthresh to half of cwnd, sets cwnd to the new ssthresh and continues in congestion avoidance. This is multiplicative decrease. If loss is detected by a timeout, the sender sets ssthresh to half of cwnd and resets cwnd to one segment, returning to slow start.

The result is a sawtooth pattern: cwnd rises linearly, then drops by half on loss, then rises again. Many flows following this rule tend to share a bottleneck link fairly.
