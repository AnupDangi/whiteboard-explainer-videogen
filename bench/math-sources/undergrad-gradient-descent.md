# Gradient descent

Gradient descent finds the minimum of a function by repeatedly stepping in the direction of steepest descent.

The gradient is the vector of partial derivatives. It points uphill, so we step opposite to it. The update rule is: theta equals theta minus alpha times the gradient, where alpha is the learning rate.

A small learning rate converges slowly; a large one can overshoot and diverge.

Example: minimize f of x equals x squared. Its gradient is 2 x. Starting at x equals 4 with alpha equals 0.1: x becomes 4 minus 0.1 times 8 equals 3.2, then 3.2 minus 0.1 times 6.4 equals 2.56, approaching x equals 0, the minimum.
