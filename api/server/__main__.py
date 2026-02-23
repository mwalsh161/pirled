import sys

import uvicorn

from ._server import app


def main() -> None:
    port = int(sys.argv[1]) if len(sys.argv) == 2 else 8000
    uvicorn.run(app, port=port)


if __name__ == "__main__":
    main()
