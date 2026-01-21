Import("env")
import os

env_file = os.path.join(env.subst("$PROJECT_DIR"), ".env")

print("Locating .env file")
if os.path.exists(env_file):
    with open(env_file) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            key, value = line.split("=", 1)
            print(f"Updating os.environ[{key!r}]")
            os.environ[key] = value
