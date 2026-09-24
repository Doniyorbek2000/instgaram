"""
Instagram avtomatlashtirish uchun yagona ishga tushirish nuqtasi.

Ishlatish:
    python main.py scheduler       # post/reels rejalashtiruvchini ishga tushiradi
    python main.py dm              # DM avtojavob serverini ishga tushiradi
    python main.py analytics       # bir martalik statistika hisobotini chiqaradi
    python main.py analytics --loop  # kunlik avtomatik statistika yig'ish
"""

import sys
import subprocess
from pathlib import Path

BASE_DIR = Path(__file__).parent

COMMANDS = {
    "scheduler": "scheduler.py",
    "dm": "dm_autoresponder.py",
    "analytics": "analytics.py",
}


def main():
    if len(sys.argv) < 2 or sys.argv[1] not in COMMANDS:
        print(__doc__)
        sys.exit(1)

    script = BASE_DIR / COMMANDS[sys.argv[1]]
    extra_args = sys.argv[2:]
    subprocess.run([sys.executable, str(script), *extra_args])


if __name__ == "__main__":
    main()
