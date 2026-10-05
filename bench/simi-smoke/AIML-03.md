# Backpropagation as credit assignment

[S1] Loss error at the output must be blamed on upstream parameters through the computation graph. [S2] The chain rule multiplies downstream error by each local derivative along the path. [S3] Each parameter gets its contribution share and updates to reduce loss. [S4] Deep paths multiply many factors, which can shrink or explode the signal.
