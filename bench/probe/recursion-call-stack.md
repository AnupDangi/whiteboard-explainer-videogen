# How recursion uses the call stack

A recursive function solves a problem by calling itself on a smaller version of the same problem. Every recursive function needs two parts: a base case and a recursive case. The base case is the simplest input, one the function can answer directly without calling itself. The recursive case reduces the input a little and calls the function again.

Consider computing the factorial of 4. The function factorial(4) returns 4 times factorial(3). The call factorial(3) returns 3 times factorial(2), and factorial(2) returns 2 times factorial(1). The call factorial(1) is the base case and returns 1 immediately.

The computer remembers where each call must resume by using the call stack. Each time a function is called, the computer pushes a new stack frame on top of the stack. A stack frame stores the function's input and the place in the code to return to. The frame for factorial(4) sits at the bottom, and the frame for factorial(1) sits on top.

When the base case returns 1, its frame is popped off the stack. The frame for factorial(2) now receives that value, multiplies it by 2, and returns 2. Then factorial(3) receives 2 and returns 6. Finally factorial(4) receives 6 and returns 24. The stack unwinds from the top down, one frame at a time.

If the base case is missing or never reached, the function keeps calling itself and the stack keeps growing. Eventually the stack runs out of space, which causes a stack overflow error. Each recursive call must therefore move the input closer to the base case.
