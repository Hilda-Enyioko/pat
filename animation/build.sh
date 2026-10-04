#!/usr/bin/env bash
set -euo pipefail

Q="${1:-l}"   # l = 480p15 (preview), m = 720p30, h = 1080p60 (final)
case "$Q" in
  l) RES=480p15 ;;
  m) RES=720p30 ;;
  h) RES=1080p60 ;;
  *) echo "usage: ./build.sh [l|m|h]"; exit 1 ;;
esac

SCENES=(
  "s1_status:S1Status"
  "s2_nonce_to_intent:S2NonceToIntent"
  "s3_receipt_rent:S3ReceiptRent"
  "s4_progress:S4Progress"
  "s5_next:S5Next"
)

: > clips.txt
for pair in "${SCENES[@]}"; do
  f="${pair%%:*}"
  c="${pair##*:}"
  manim -q"$Q" "$f.py" "$c"
  echo "file 'media/videos/$f/$RES/$c.mp4'" >> clips.txt
done

# Join without re-encoding (all clips share codec, size and fps)
ffmpeg -y -f concat -safe 0 -i clips.txt -c copy "pat_progress_silent_$Q.mp4"

echo "Done: pat_progress_silent_$Q.mp4"
