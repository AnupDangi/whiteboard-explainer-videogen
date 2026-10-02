# LRU cache

A cache stores a limited number of items so that repeated requests are fast. When the cache is full and a new item arrives, the cache must evict one item. A least recently used cache, or LRU cache, evicts the item that has gone unused for the longest time. The idea rests on temporal locality: an item used recently is likely to be used again soon.

An LRU cache supports two operations, get and put. Get returns the value for a key and marks that key as the most recently used. Put inserts or updates a key, marks it as most recently used, and if the cache is over capacity, removes the least recently used key.

To make both operations run in constant time, O(1), an implementation combines a hash map with a doubly linked list. The hash map maps each key to its node in the list. The list keeps nodes in order from most recently used at the head to least recently used at the tail. A get looks up the node in the map and moves it to the head. A put on a full cache removes the tail node, deletes its key from the map, and adds the new node at the head.

For a cache of capacity 2: put A, put B gives order B, A. Get A gives order A, B. Put C exceeds capacity, so the tail B is evicted, giving order C, A.
