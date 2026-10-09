# AIML-03

Loss error at the output must be blamed on upstream parameters through the computation graph. The chain rule multiplies downstream error by each local derivative along the path. Each parameter gets its contribution share and updates to reduce loss. Deep paths multiply many factors, which can shrink or explode the signal.
