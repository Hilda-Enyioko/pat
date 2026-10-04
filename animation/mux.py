import subprocess
import sys
from pathlib import Path

Q = sys.argv[1] if len(sys.argv) > 1 else "h"   # l / m / h, same as build.sh
RES = {"l": "480p15", "m": "720p30", "h": "1080p60"}[Q]
LEAD = 0.3  # seconds of silence before each line starts

SCENES = [
    ("s1_status", "S1Status"),
    ("s2_nonce_to_intent", "S2NonceToIntent"),
    ("s3_receipt_rent", "S3ReceiptRent"),
    ("s4_progress", "S4Progress"),
    ("s5_next", "S5Next"),
]


def run(cmd):
    subprocess.run(cmd, check=True)


def duration(path: Path) -> float:
    out = subprocess.check_output([
        "ffprobe", "-v", "error", "-show_entries", "format=duration",
        "-of", "csv=p=0", str(path),
    ])
    return float(out.decode().strip())


vo = Path("vo")
list_lines = []

for i, (f, c) in enumerate(SCENES, 1):
    clip = Path(f"media/videos/{f}/{RES}/{c}.mp4")
    mp3 = vo / f"s{i}.mp3"
    if not clip.exists() or not mp3.exists():
        sys.exit(f"Missing {clip} or {mp3}. Run build.sh and gen_vo.py first.")

    clip_len = duration(clip)
    voice_len = duration(mp3)
    if LEAD + voice_len > clip_len:
        print(f"WARNING {c}: voice ({LEAD + voice_len:.1f}s) is longer than "
              f"the clip ({clip_len:.1f}s), so its ending will be cut.")

    padded = vo / f"s{i}_pad.wav"
    ms = int(LEAD * 1000)
    run([
        "ffmpeg", "-y", "-v", "error", "-i", str(mp3),
        "-af", f"adelay={ms}|{ms},apad",
        "-t", f"{clip_len:.3f}",
        "-ar", "44100", "-ac", "2", str(padded),
    ])
    list_lines.append(f"file '{padded.name}'")

(vo / "audio.txt").write_text("\n".join(list_lines) + "\n")

narration = vo / "narration.wav"
run([
    "ffmpeg", "-y", "-v", "error", "-f", "concat", "-safe", "0",
    "-i", str(vo / "audio.txt"), "-c", "copy", str(narration),
])

silent = Path(f"pat_progress_silent_{Q}.mp4")
final = Path(f"pat_progress_final_{Q}.mp4")
run([
    "ffmpeg", "-y", "-v", "error", "-i", str(silent), "-i", str(narration),
    "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", str(final),
])

print(f"Done: {final}")
