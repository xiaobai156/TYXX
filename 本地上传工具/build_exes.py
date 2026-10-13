import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent
SRC = ROOT / "src"
DIST = ROOT / "dist"
BUILD = ROOT / "build"
NAME = "统一本地上传工具"
ENTRY = SRC / "unified_app.py"
OUTPUT = DIST / f"{NAME}.exe"


def main() -> None:
    if not ENTRY.is_file():
        raise FileNotFoundError(f"构建入口不存在：{ENTRY}")
    DIST.mkdir(parents=True, exist_ok=True)
    spec_dir = BUILD / "specs"
    spec_dir.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        [
            sys.executable,
            "-m",
            "PyInstaller",
            "--noconfirm",
            "--clean",
            "--onefile",
            "--windowed",
            "--name",
            NAME,
            "--paths",
            str(SRC),
            "--distpath",
            str(DIST),
            "--workpath",
            str(BUILD / NAME),
            "--specpath",
            str(spec_dir),
            str(ENTRY),
        ],
        cwd=ROOT,
        check=True,
    )
    if not OUTPUT.is_file():
        raise RuntimeError(f"PyInstaller 未生成预期文件：{OUTPUT}")
    print(f"统一本地上传工具构建完成：\n{OUTPUT}")


if __name__ == "__main__":
    main()
