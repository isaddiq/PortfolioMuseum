"""
Builds the museum's visitors: a cast of realistic people from the Microsoft
Rocketbox avatar library (MIT licence), and the motion-captured clips they
walk, stand, look around and take photographs with.

    python scripts/build-visitors.py [path/to/FBX2glTF]

Reads   Rocketbox avatars and animations (FBX + TGA), downloaded from GitHub
Needs   FBX2glTF (github.com/facebookincubator/FBX2glTF; give its path, or set
        FBX2GLTF, or have it on PATH) and Pillow
Writes  assets/museum/people/<avatar>.glb   one per person: mesh, skeleton,
                                            textures shrunk for the web
        assets/museum/people/motions.json   the cast, and per sex ('m', 'f')
                                            walk, idle, look and photo clips
                                            as three.js AnimationClip JSON

All Rocketbox people share one Biped skeleton, so a clip plays on any of
them. Clips keep bone rotations plus the hips' height (the walk's bob); the
museum moves each visitor itself, so walking happens on the spot. The walk
records how far its stride carries (from the extracted root motion), so the
museum can move people at exactly the pace their feet step.
"""

import io
import json
import math
import os
import re
import shutil
import struct
import subprocess
import sys
import tempfile
import urllib.request
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "assets" / "museum" / "people"
SOURCE = "https://raw.githubusercontent.com/microsoft/Microsoft-Rocketbox/master/Assets/"

# (folder under Assets/Avatars, sex): professional and everyday clothes.
AVATARS = [
    ("Professions/Business_Female_01", "f"),
    ("Professions/Business_Male_01", "m"),
    ("Adults/Female_Adult_09", "f"),
    ("Professions/Business_Male_02", "m"),
    ("Professions/Business_Female_03", "f"),
    ("Adults/Male_Adult_03", "m"),
    ("Professions/Business_Female_02", "f"),
    ("Professions/Business_Male_06", "m"),
    ("Adults/Female_Adult_06", "f"),
    ("Adults/Male_Adult_08", "m"),
    ("Adults/Female_Adult_02", "f"),
    ("Adults/Male_Adult_04", "m"),
]
# clip name -> (animation folder, file stem with {s} for the sex)
CLIPS = {
    "walk": ("all_animations_max_motextr_xy", "{s}_walk_neutral"),
    "idle": ("all_animations_max_motextr_static", "{s}_idle_neutral_01"),
    "look": ("all_animations_max_motextr_static", "{s}_idle_look_around_01"),
    "photo": ("all_animations_max_motextr_static", "{s}_take_picture"),
}
COLOR_EDGE = 1024
DETAIL_EDGE = 512
# Facial rig bones are left out of the clips: the faces stay at rest.
BODY = re.compile(r"^Bip01( (Pelvis|Spine\d?|Neck|Head|[LR] (Clavicle|UpperArm|Forearm|Hand|Finger\d+|Thigh|Calf|Foot|Toe0)))?$")


def fetch(url, dest):
    with urllib.request.urlopen(url) as response, open(dest, "wb") as out:
        shutil.copyfileobj(response, out)


def converter():
    for candidate in (sys.argv[1] if len(sys.argv) > 1 else None, os.environ.get("FBX2GLTF"),
                      shutil.which("FBX2glTF"), shutil.which("FBX2glTF.exe")):
        if candidate and Path(candidate).exists():
            return candidate
    raise SystemExit("FBX2glTF not found: pass its path, or set FBX2GLTF")


def convert(tool, fbx, out_stem):
    subprocess.run([tool, "--binary", "--input", str(fbx), "--output", str(out_stem)], check=True, capture_output=True)
    return Path(str(out_stem) + ".glb").read_bytes()


def read_glb(data):
    json_len = struct.unpack_from("<I", data, 12)[0]
    gltf = json.loads(data[20:20 + json_len])
    off = 20 + json_len
    bin_len = struct.unpack_from("<I", data, off)[0] if off < len(data) else 0
    return gltf, bytearray(data[off + 8:off + 8 + bin_len])


def write_glb(gltf, binary):
    js = json.dumps(gltf, separators=(",", ":")).encode()
    js += b" " * (-len(js) % 4)
    binary = bytes(binary) + b"\0" * (-len(binary) % 4)
    total = 12 + 8 + len(js) + 8 + len(binary)
    return (struct.pack("<III", 0x46546C67, 2, total) + struct.pack("<II", len(js), 0x4E4F534A) + js
            + struct.pack("<II", len(binary), 0x004E4942) + binary)


def encode(path, edge, alpha=False):
    im = Image.open(path)
    im.load()
    scale = min(1.0, edge / max(im.size))
    if scale < 1:
        im = im.resize((round(im.width * scale), round(im.height * scale)), Image.LANCZOS)
    out = io.BytesIO()
    if alpha:
        im.convert("RGBA").save(out, "PNG", optimize=True)
        return out.getvalue(), "image/png"
    im.convert("RGB").save(out, "JPEG", quality=84, optimize=True)
    return out.getvalue(), "image/jpeg"


def build_avatar(tool, folder, work):
    """Convert one avatar and embed its textures (FBX2glTF cannot read TGA)."""
    name = folder.split("/")[-1]
    base = work / name
    (base / "Textures").mkdir(parents=True, exist_ok=True)
    fbx = base / f"{name}.fbx"
    fetch(f"{SOURCE}Avatars/{folder}/Export/{name}.fbx", fbx)
    gltf, binary = read_glb(convert(tool, fbx, base / "converted"))
    gltf.pop("animations", None)

    # Texture names usually, but not always, follow the material names
    # ("<code>_body" -> "<code>_body_color.tga"), so match on the suffix.
    listing = f"https://api.github.com/repos/microsoft/Microsoft-Rocketbox/contents/Assets/Avatars/{folder}/Textures"
    with urllib.request.urlopen(listing) as response:
        available = [entry["name"] for entry in json.load(response)]

    def texture_file(material, slot):
        part = material.rsplit("_", 1)[-1]
        options = [f"{material}_{slot}.tga", f"{material}_opacity_{slot}.tga"]
        wanted = next((n for n in options if n in available), None)
        if wanted is None:
            wanted = next(n for n in available if n.lower().endswith(f"_{part}_{slot}.tga"))
        path = base / "Textures" / wanted
        if not path.exists():
            fetch(f"{SOURCE}Avatars/{folder}/Textures/{wanted}", path)
        return path

    images = gltf.get("images", [])
    gltf.setdefault("bufferViews", [])
    for mat in gltf["materials"]:
        part = mat["name"].rsplit("_", 1)[-1]
        pbr = mat.setdefault("pbrMetallicRoughness", {})
        pbr["metallicFactor"] = 0.0
        pbr["roughnessFactor"] = 0.62 if part == "head" else 0.8
        small = part in ("opacity", "glasses")
        slots = [("baseColorTexture", "color", DETAIL_EDGE if small else COLOR_EDGE)]
        if "normalTexture" in mat:
            slots.append(("normalTexture", "normal", DETAIL_EDGE))
        see_through = False
        for key, kind, edge in slots:
            holder = pbr if key == "baseColorTexture" else mat
            if key not in holder:
                continue
            image = images[gltf["textures"][holder[key]["index"]]["source"]]
            source = texture_file(mat["name"], kind)
            alpha = kind == "color" and "opacity" in source.name
            see_through = see_through or alpha
            payload, mime = encode(source, edge, alpha)
            binary.extend(b"\0" * (-len(binary) % 4))
            gltf["bufferViews"].append({"buffer": 0, "byteOffset": len(binary), "byteLength": len(payload)})
            binary.extend(payload)
            image.pop("uri", None)
            image["bufferView"] = len(gltf["bufferViews"]) - 1
            image["mimeType"] = mime
        if part == "opacity":   # hair and lashes: cut out along their alpha
            mat["alphaMode"] = "MASK"
            mat["alphaCutoff"] = 0.4
            mat["doubleSided"] = True
        elif see_through:       # glasses: tinted lenses you can see through
            mat["alphaMode"] = "BLEND"
            mat["doubleSided"] = True
            pbr["roughnessFactor"] = 0.15
        mat.pop("extras", None)
    gltf["buffers"] = [{"byteLength": len(binary)}]
    return name, write_glb(gltf, binary)


def read_floats(gltf, binary, index):
    acc = gltf["accessors"][index]
    width = {"SCALAR": 1, "VEC3": 3, "VEC4": 4}[acc["type"]]
    bv = gltf["bufferViews"][acc["bufferView"]]
    start = bv.get("byteOffset", 0) + acc.get("byteOffset", 0)
    stride = bv.get("byteStride", width * 4)
    return [struct.unpack_from(f"<{width}f", binary, start + i * stride) for i in range(acc["count"])]


def sanitize(name):
    # three.js PropertyBinding.sanitizeNodeName
    return re.sub(r"[\[\]\.:/]", "", re.sub(r"\s", "_", name))


def build_clip(tool, folder, stem, work, step=1):
    fbx = work / f"{stem}.fbx"
    fetch(f"{SOURCE}Animations/{folder}/{stem}.max.fbx", fbx)
    gltf, binary = read_glb(convert(tool, fbx, work / stem))
    anim = gltf["animations"][0]
    tracks = []
    duration = 0.0
    hips_y = None
    travel = 0.0
    for ch in anim["channels"]:
        node = gltf["nodes"][ch["target"]["node"]]["name"]
        path = ch["target"]["path"]
        sampler = anim["samplers"][ch["sampler"]]
        if node == "MotionExtractionHelper" and path == "translation":
            # The root motion taken out of the clip: how far one loop walks.
            v = read_floats(gltf, binary, sampler["output"])
            travel = math.hypot(v[-1][0] - v[0][0], v[-1][2] - v[0][2])
            continue
        if not BODY.match(node) or path not in ("rotation", "translation"):
            continue
        if path == "translation" and node != "Bip01":
            continue   # bones keep their own lengths; only the hips move
        times = [t[0] for t in read_floats(gltf, binary, sampler["input"])]
        values = read_floats(gltf, binary, sampler["output"])
        keep = list(range(0, len(times), step))
        if keep[-1] != len(times) - 1:
            keep.append(len(times) - 1)
        duration = max(duration, times[-1])
        if path == "translation":
            hips_y = values[0][1]
            # The walk still carries the hips forward over each loop (about
            # one stride) and snaps them back at the end. Remove that steady
            # travel, keeping the sway and bob: the museum does the moving.
            span = (times[-1] - times[0]) or 1
            first, last = values[0], values[-1]
            values = [(v[0] - (last[0] - first[0]) * (t - times[0]) / span, v[1],
                       v[2] - (last[2] - first[2]) * (t - times[0]) / span) for t, v in zip(times, values)]
            if not travel:
                travel = math.hypot(last[0] - first[0], last[2] - first[2])
        # A bone that never moves needs one key, not hundreds.
        if all(max(abs(a - b) for a, b in zip(values[i], values[0])) < 0.0015 for i in keep):
            keep = [0]
        tracks.append({
            "name": f"{sanitize(node)}.{'quaternion' if path == 'rotation' else 'position'}",
            "type": "quaternion" if path == "rotation" else "vector",
            "times": [round(times[i], 4) for i in keep],
            "values": [round(v, 3) for i in keep for v in values[i]]
        })
    clip = {"duration": round(duration, 4), "hipsY": round(hips_y or 0, 4), "tracks": tracks}
    if travel and duration:
        clip["speed"] = round(travel / duration, 4)
    return clip


def build():
    tool = converter()
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    cast = []
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        for folder, sex in AVATARS:
            name, glb = build_avatar(tool, folder, work)
            (OUT_DIR / f"{name}.glb").write_bytes(glb)
            cast.append({"file": f"{name}.glb", "sex": sex})
            print(f"{name}.glb {len(glb) // 1024} KB")
        motions = {}
        for sex in ("m", "f"):
            motions[sex] = {}
            for clip, (folder, stem) in CLIPS.items():
                # The walk keeps every frame; standing clips keep one in three.
                motions[sex][clip] = build_clip(tool, folder, stem.format(s=sex), work, step=1 if clip == "walk" else 3)
                motions[sex][clip]["name"] = clip
            print(sex, {k: (v["duration"], v.get("speed"), len(v["tracks"])) for k, v in motions[sex].items()})
    (OUT_DIR / "motions.json").write_text(json.dumps({"cast": cast, "clips": motions}, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"motions.json {(OUT_DIR / 'motions.json').stat().st_size // 1024} KB")


if __name__ == "__main__":
    build()
