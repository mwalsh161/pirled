import sys

import uvicorn

from .app import app


def main() -> None:
    port = int(sys.argv[1]) if len(sys.argv) == 2 else 8000
    uvicorn.run(app, host="0.0.0.0", port=port, proxy_headers=True)


if __name__ == "__main__":
    main()
