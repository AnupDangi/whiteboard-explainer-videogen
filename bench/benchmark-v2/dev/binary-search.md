# Binary search

Binary search finds a target in a sorted array by repeatedly halving the search range. Keep two indexes, low and high, around the range still possible. Look at the middle element. If it equals the target, the search is done. If the target is smaller, discard the upper half by moving high to just below the middle. If the target is larger, discard the lower half by moving low to just above the middle. Repeat until the element is found or low passes high, which means the target is absent.

For the sorted array 2, 5, 8, 12, 16, 23, 38, searching for 23: low is 0 and high is 6, so the middle is index 3, value 12. Since 23 is larger, low becomes 4. The middle of indexes 4 to 6 is index 5, value 23, which is the target.

Each step halves the range, so an array of n items needs at most about log base 2 of n steps. One million items need about 20 steps.
