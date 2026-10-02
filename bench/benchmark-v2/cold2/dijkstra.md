# Dijkstra's shortest path algorithm

Dijkstra's algorithm finds the shortest path from one start node to every other node in a graph whose edge weights are not negative. It keeps a tentative distance for each node, set to zero for the start and infinity for the others, and a set of finished nodes.

Repeatedly pick the unfinished node with the smallest tentative distance and mark it finished. Its distance is now final. For each neighbour, compute the distance through this node, which is this node's distance plus the edge weight. If that is smaller than the neighbour's current distance, update it. This step is called relaxation.

Continue until every node is finished, or the target node is finished. A priority queue makes picking the smallest distance fast. With a binary heap, the running time is O((V + E) log V).

Example: from A, edges A to B cost 4, A to C cost 1, C to B cost 2. B first gets 4, then after C is finished it improves to 1 + 2 = 3.
