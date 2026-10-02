import type { LessonRequest } from '../plan/stages.js';

/**
 * Math golden set (plan Phase 4): frozen source texts, from a one-step idea
 * to multi-step derivations. Each runs as a 60 s lesson through S2 -> S11.
 * Sources are short and self-contained so every claim in a generated script
 * can be checked against them.
 */
export interface MathLesson extends LessonRequest {
  id: string;
  title: string;
  /** Expected shape, used to judge the generated plan (not shown to the model). */
  expect: { level: 'one-step' | 'multi-step'; minStepScenes: number };
}

export const MATH_LESSONS: MathLesson[] = [
  {
    id: 'm1-slope',
    title: 'Slope',
    targetDurationSec: 60,
    audience: 'secondary-school student',
    expect: { level: 'one-step', minStepScenes: 0 },
    source: `The slope of a straight line measures how steep it is. Take any two points on the line. The run is the horizontal change between them and the rise is the vertical change. The slope m is the rise divided by the run, m = (y2 - y1) / (x2 - x1). Because a straight line climbs at a constant rate, the slope is the same no matter which two points you pick. A positive slope goes up to the right, a negative slope goes down, and a horizontal line has slope zero.`,
  },
  {
    id: 'm2-pythagoras',
    title: 'Pythagorean theorem',
    targetDurationSec: 60,
    audience: 'secondary-school student',
    expect: { level: 'multi-step', minStepScenes: 2 },
    source: `In a right triangle the side opposite the right angle is the hypotenuse, c; the other two sides are the legs, a and b. The Pythagorean theorem says a^2 + b^2 = c^2. One way to see it: build a square on each side. The area of the square on the hypotenuse equals the total area of the squares on the two legs. To find a missing side, square the two known sides, add (or subtract for a leg), and take the square root. For legs 3 and 4, c^2 = 9 + 16 = 25, so c = 5.`,
  },
  {
    id: 'm3-derivative',
    title: 'Derivative as a limit',
    targetDurationSec: 60,
    audience: 'first-year university student',
    expect: { level: 'multi-step', minStepScenes: 2 },
    source: `The derivative of a function f at a point x measures its instantaneous rate of change. Start with the secant line through (x, f(x)) and (x + h, f(x + h)); its slope is the difference quotient (f(x + h) - f(x)) / h, the average rate of change over the interval. Now let h shrink toward zero. The secant line rotates toward the tangent line at x, and the difference quotient approaches a single number. That limit is the derivative: f'(x) = lim_{h -> 0} (f(x + h) - f(x)) / h. For f(x) = x^2 the difference quotient is 2x + h, which approaches 2x.`,
  },
  {
    id: 'm4-gradient-descent',
    title: 'Gradient descent',
    targetDurationSec: 60,
    audience: 'beginner machine-learning student',
    expect: { level: 'multi-step', minStepScenes: 2 },
    source: `A model's loss function L assigns a number to every choice of parameters theta: how wrong the model is. Plotted against one parameter it looks like a valley. The gradient of L is the slope at the current point and points uphill, toward higher loss. Gradient descent improves theta by stepping in the opposite direction: theta_{t+1} = theta_t - eta * grad L(theta_t), where eta is a small step size called the learning rate. Repeating the update moves theta downhill; near the bottom the slope flattens, so the steps shrink and theta settles at a minimum. Too large a learning rate overshoots; too small is slow.`,
  },
  {
    id: 'm5-bayes',
    title: "Bayes' theorem",
    targetDurationSec: 60,
    audience: 'secondary-school student',
    expect: { level: 'multi-step', minStepScenes: 2 },
    source: `Bayes' theorem updates a belief when new evidence arrives: P(A|B) = P(B|A) P(A) / P(B). Example: a disease affects 1% of people. A test catches 90% of sick people but also flags 5% of healthy people. Out of 1000 people, 10 are sick and 9 of them test positive; 990 are healthy and about 50 of them test positive. So about 59 people test positive, and only 9 of those are sick: P(sick | positive) is about 9/59, roughly 15%. The prior (1%) matters as much as the test's accuracy.`,
  },
];
