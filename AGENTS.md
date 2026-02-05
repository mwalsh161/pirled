Node environment: Lives in python environment.
Cpp environment: uses platform IO tooling.

# Python

`conda activate mdns`

- All suggestions should use strict typing for python >=3.12 (so use builtins when possible like `list` instead of `typing.List`).

# Nodejs

This is installed within the python conda environment (see #python).

# Cpp

Uses platformIO tooling. We compile code for an ESP8266 (specifically the D1 mini board).
