from __future__ import annotations

import json
import sys

from access_reader import fetch_checkins


def main() -> int:
    if len(sys.argv) not in (3, 4):
        print("Uso: python test_read_access.py YYYY-MM-DD YYYY-MM-DD [documento]")
        return 2

    documento = sys.argv[3] if len(sys.argv) == 4 else None
    rows = fetch_checkins(sys.argv[1], sys.argv[2], documento)
    print(json.dumps({"count": len(rows), "data": rows[:20]}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
