#!/bin/sh
# Compress rendered voice lines (wav, gitignored) to small mono mp3s that ARE committed, so a fresh clone plays with Marlow's voice.
# Needs ffmpeg. Usage: sh tools/compress-lines.sh
cd "$(dirname "$0")/../assets/audio/lines" || exit 1
n=0
for f in *.wav; do
  [ -e "$f" ] || continue
  m="${f%.wav}.mp3"
  if [ ! -e "$m" ] || [ "$f" -nt "$m" ]; then ffmpeg -loglevel error -y -i "$f" -ac 1 -ar 24000 -b:a 40k "$m" && n=$((n+1)); fi
done
echo "compressed $n file(s); $(ls *.mp3 2>/dev/null | wc -l) mp3 total, $(du -sh . | cut -f1) on disk (wavs are gitignored)"
