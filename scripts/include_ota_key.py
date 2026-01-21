# pre:generate_public_key.py
Import("env")
import os

public_key_path = "keys/public.pem"
header_path = os.path.join(env.subst("$PROJECT_INCLUDE_DIR"), "ota_public_key.h")

with open(public_key_path, "r") as f:
    key = f.read()

with open(header_path, "w") as f:
    f.write("// Auto-generated\n\n")
    f.write(f'const char publicKey[] PROGMEM = R"KEY({key})KEY";\n')

print(f"Generated {header_path}")
