# Charging an RC circuit

An RC circuit connects a resistor of resistance R in series with a capacitor of capacitance C and a battery of voltage V. When the switch closes, current flows and the capacitor charges. The capacitor stores charge Q = CV_c, where V_c is the voltage across it.

By Kirchhoff's voltage law, the battery voltage equals the resistor voltage plus the capacitor voltage: V = IR + V_c. At the moment the switch closes, the capacitor is empty, so V_c is zero and the current is largest, I = V/R. As the capacitor charges, V_c rises, the voltage across the resistor falls, and the current decreases toward zero.

The capacitor voltage follows V_c(t) = V(1 - e^(-t/RC)). The current follows I(t) = (V/R) e^(-t/RC). The product RC is the time constant, tau, measured in seconds. After one time constant, the capacitor has reached about 63 percent of the battery voltage. After five time constants it has reached over 99 percent, and the circuit is considered fully charged.

A larger resistance or a larger capacitance gives a larger time constant, so charging takes longer. For example, with R = 10 kilohms and C = 100 microfarads, tau = 1 second.
