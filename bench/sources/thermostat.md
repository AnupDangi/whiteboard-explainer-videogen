# Thermostat feedback control — V1 benchmark source (dev set)

## The problem

A room gets cold in winter unless heat is added. A thermostat keeps the room
near a chosen temperature without a person switching the heater on and off.

## Desired temperature

The resident sets a desired temperature on the thermostat dial, for example
20 degrees. This setting is the reference the whole system works toward.

## Sensing the room

A sensor inside the thermostat continuously measures the current room
temperature. The measurement is compared against the desired temperature.

## The comparator

A comparator subtracts the measured temperature from the desired
temperature. The difference is called the error. A positive error means the
room is too cold; a zero error means it is exactly right; a negative error
means it is too warm.

## The controller and heater

The controller turns the heater on when the error is positive and off when
the error reaches zero. Heat flows from the heater into the room, and the
room temperature rises toward the desired value.

## Feedback closes the loop

The rising room temperature feeds back into the sensor, so the error
shrinks as the room warms. This closed loop — sense, compare, act, sense
again — is called negative feedback because each correction opposes the
error that caused it.

## Overshoot and hysteresis

Real thermostats do not switch at exactly one temperature. They switch the
heater on slightly below the setting and off slightly above it. This gap,
called hysteresis, stops rapid on-off cycling and causes a small ripple of
one or two degrees around the desired temperature.

## Why feedback matters

Without feedback the heater would run on a fixed schedule and the room
would drift with the weather. With feedback the system corrects itself:
an open window cools the room, the error grows, and the heater runs longer
until the setting is restored.
