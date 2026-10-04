import asyncio
import subprocess
import sys
from pathlib import Path

import edge_tts

VOICE = "en-US-AndrewNeural"   # change to any voice from --list-voices
RATE = "+0%"                   # e.g. "-8%" to slow down, "+5%" to speed up
RES = sys.argv[1] if len(sys.argv) > 1 else "1080p60"  # or 480p15 for preview builds

SCENES = [
    ("s1_status", "S1Status",
     "PAT is a self-custodial offline payment protocol on Solana. "
     "The backend is done. The PWA is next."),
    ("s2_nonce_to_intent", "S2NonceToIntent",
     "The biggest change so far: I moved away from durable nonces. "
     "Instead of preserving a transaction for later broadcast, PAT now treats "
     "the offline payment as an explicit signed PaymentIntent, verified and "
     "settled when connectivity returns."),
    ("s3_receipt_rent", "S3ReceiptRent",
     "The second decision was who funds the receipt account's rent. "
     "I chose the payer. Merchants don't have to pre-fund anything to accept "
     "a payment, and the cost is explicit when the payment is created."),
    ("s4_progress", "S4Progress",
     "So far the protocol side has come together better than I expected. "
     "Reservations, intents, signature verification and settlement all run "
     "end to end on devnet."),
    ("s5_next", "S5Next",
     "Now I get to build the part users actually see. "
     "Reserve while connected. Spend while disconnected. Settle when reconnected."),
]


def duration(path: Path) -> float:
    out = subprocess.check_output([
        "ffprobe", "-v", "error", "-show_entries", "format=duration",
        "-of", "csv=p=0", str(path),
    ])
    return float(out.decode().strip())


async def main():
    out_dir = Path("vo")
    out_dir.mkdir(exist_ok=True)

    print(f"{'scene':<22}{'voice':>8}{'clip':>8}   status")
    for i, (f, c, text) in enumerate(SCENES, 1):
        mp3 = out_dir / f"s{i}.mp3"
        await edge_tts.Communicate(text, VOICE, rate=RATE).save(str(mp3))

        a = duration(mp3)
        clip = Path(f"media/videos/{f}/{RES}/{c}.mp4")
        if clip.exists():
            v = duration(clip)
            status = "OK" if a <= v - 0.3 else "TOO LONG: lengthen scene or trim text"
            print(f"{c:<22}{a:>7.1f}s{v:>7.1f}s   {status}")
        else:
            print(f"{c:<22}{a:>7.1f}s{'n/a':>8}   clip not found at {clip}")


asyncio.run(main())
