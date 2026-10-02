# Hash table collisions

A hash table stores key-value pairs. A hash function turns a key into an integer, and the integer modulo the table size gives a bucket index. Looking up a key means hashing it and going to that bucket, which takes constant time on average.

Because there are more possible keys than buckets, two different keys can map to the same bucket. This is a collision. Two common strategies handle it.

In separate chaining, each bucket holds a linked list of entries. A colliding key is added to the list in its bucket, and a lookup searches that list. In open addressing, all entries live in the array itself. A colliding key is placed in the next free slot found by probing, for example linear probing tries the next index, then the next.

The load factor is the number of entries divided by the number of buckets. As it grows, collisions become more likely and operations slow down, so tables resize, usually doubling the array and reinserting every key, when the load factor passes a threshold such as 0.75.
