# Process overview

## What I built

The Friction Pad: a full-screen instrument you play by dragging a finger,
stylus, mouse, or arrow keys/WASD across the canvas. Motion leaves a
colourful, fading trail and drives a live Web Audio synthesiser --- two
harmonically-tuned oscillators (a perfect fifth apart, so they can never
clash) through a resonant lowpass filter and a feedback delay, with a
low-volume "bow scrape" voice and a slow vibrato LFO layered in to make the
tone feel bowed and organic rather than like a plain synth.

## The moments that mattered

1. **The trail rendered as flickering circles, not a line.** Straight
   `lineTo` segments driven by raw per-event velocity meant tiny pointer
   jitter spiked the line width on every sample, and a fat round-capped
   segment shorter than its own width draws as a disc, not a stroke --- so
   the fading trail looked like blinking dots chasing the cursor instead of
   a ribbon. Smoothing velocity with an exponential moving average and
   drawing through `quadraticCurveTo` across each segment's midpoints (both
   in
   [`69207da`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit4-VishakhaMathur/commit/69207da))
   fixed it; I confirmed by dragging at a range of speeds in the browser
   until the taper looked continuous, not by trusting the diff alone.

2. **Adding keyboard input without quietly breaking pointer input.** The
   obvious move was to store the keyboard's virtual cursor in the same
   `Map` the pointer strokes use, since both need identical stroke/audio
   state. That would have broken the "silence once nothing is playing"
   check, which counts on that map reaching size zero --- a keyboard stroke
   would sit in it forever once first touched. I kept the keyboard cursor
   in its own variable and added an explicit `isKeyboardCursorActive()`
   check instead
   ([`93fce5d`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit4-VishakhaMathur/commit/93fce5d)),
   and pulled the shared drawing/audio logic into `startStroke`/
   `advanceStroke` so pointer and keyboard genuinely run the same code path
   rather than two copies that could drift apart.

3. **The synth sounded harsh, then still too "digital" once toned down.**
   The first pass swapped the sawtooth for a triangle wave and locked the
   second oscillator to an exact perfect fifth above the root, so no
   position on the pad can ever sound dissonant, and gave the master gain
   an asymmetric attack/release so notes swell and settle instead of
   snapping
   ([`857f605`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit4-VishakhaMathur/commit/857f605)).
   That same commit's echo also rang on far longer than intended --- I
   caught it by ear, not by a test, and cut the feedback gain from 0.6 to
   0.35 in the same change once I noticed the tail wasn't decaying inside a
   couple of seconds.

> Now we have one final, critical assignment requirement to fulfill:
> "playable with whatever is at hand --- mouse, keyboard or touch."

That prompt is what produced the keyboard virtual cursor in moment 2 above.
