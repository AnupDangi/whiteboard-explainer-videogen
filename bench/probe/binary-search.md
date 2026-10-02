# Binary search

Binary search finds a target value in a sorted list. It compares the target with the middle element of the list. If the target equals the middle element, the search is done. If the target is smaller, the search continues in the left half; if it is larger, it continues in the right half. Each comparison discards half of the remaining elements, so a list of n elements needs at most about log2(n) comparisons. A list of one million elements needs only about twenty comparisons. Binary search only works if the list is sorted.
