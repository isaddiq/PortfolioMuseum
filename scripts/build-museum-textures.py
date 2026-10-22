"""
Builds the web-sized copies of every image that the 3D museum hangs on its
walls, plus a manifest of their dimensions so frames can be sized before the
pictures arrive.

    python scripts/build-museum-textures.py

Reads   assets/images/**, assets/icons/**, assets/logos/**
Writes  assets/museum/<same relative path>.webp   (long edge <= MAX_EDGE)
        data/museum-textures.json                 {original path: {src, w, h}}

The full-resolution originals are untouched; the museum's detail panels and
zoom viewer still show them. Re-run after adding or replacing an image. An
image that has no copy yet still works: the museum falls back to the original.
"""

import json
from pathlib import Path

from PIL import Image, ImageOps

Image.MAX_IMAGE_PIXELS = None  # some certificate scans are 13100 x 7300

ROOT = Path(__file__).resolve().parent.parent
SOURCES = ["assets/images", "assets/icons", "assets/logos"]
SKIP = {"assets/images/readme", "assets/images/meta"}
OUT_DIR = ROOT / "assets" / "museum"
MANIFEST = ROOT / "data" / "museum-textures.json"
EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}
MAX_EDGE = 2048
ICON_EDGE = 256


def build():
    manifest = {}
    for source in SOURCES:
        for path in sorted((ROOT / source).rglob("*")):
            rel = path.relative_to(ROOT).as_posix()
            if path.suffix.lower() not in EXTENSIONS:
                continue
            if any(rel.startswith(skip) for skip in SKIP):
                continue

            with Image.open(path) as raw:
                # Phone photos store their rotation as an EXIF tag; bake it in
                # so the copy is upright (browsers do this for the original).
                im = ImageOps.exif_transpose(raw)
                width, height = im.size
                edge = ICON_EDGE if rel.startswith("assets/icons") else MAX_EDGE
                scale = min(1.0, edge / max(width, height))
                size = (max(1, round(width * scale)), max(1, round(height * scale)))

                out_rel = Path(rel).relative_to("assets").with_suffix(".webp")
                out = OUT_DIR / out_rel
                out.parent.mkdir(parents=True, exist_ok=True)

                has_alpha = im.mode in ("RGBA", "LA") or "transparency" in im.info
                frame = im.convert("RGBA" if has_alpha else "RGB")
                if scale < 1.0:
                    frame = frame.resize(size, Image.LANCZOS)
                frame.save(out, "WEBP", quality=85, method=6)

            manifest[rel] = {
                "src": (Path("assets/museum") / out_rel).as_posix(),
                "w": width,
                "h": height,
            }

    MANIFEST.write_text(json.dumps(manifest, indent=1) + "\n", encoding="utf-8")
    print(f"{len(manifest)} images -> {OUT_DIR.relative_to(ROOT).as_posix()}/")


if __name__ == "__main__":
    build()
