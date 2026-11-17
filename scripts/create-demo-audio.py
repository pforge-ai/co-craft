"""Recreate the original ambient bed; no samples or model services are used."""
import array
import math
import random
import wave
from pathlib import Path

rate, duration = 24000, 24
rng = random.Random(27)
data = array.array('h')
low = 0.0
chords = [(146.83, 220, 293.66, 369.99), (130.81, 196, 261.63, 329.63), (110, 164.81, 220, 293.66)]
for i in range(rate * duration):
    t = i / rate
    chord = chords[min(2, int(t / 8))]
    edge = min(1, t / 2, (duration - t) / 3)
    section = t % 8
    env = min(1, section / 1.5, (8 - section) / 1.5)
    low = low * .97 + rng.uniform(-1, 1) * .03
    tone = sum(math.sin(2 * math.pi * f * t + math.sin(t * .23) * .12) * (.8 if j < 2 else .35)
               for j, f in enumerate(chord)) / 4
    value = (tone * .12 * env + low * (.6 + .3 * math.sin(t * .6)) * .45) * edge
    data.append(int(max(-1, min(1, value)) * 32767))
output = Path(__file__).resolve().parent.parent / 'resources/public/coast-ambient.wav'
with wave.open(str(output), 'wb') as audio:
    audio.setnchannels(1)
    audio.setsampwidth(2)
    audio.setframerate(rate)
    audio.writeframes(data.tobytes())
print(output)
