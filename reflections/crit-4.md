# Crit 4 reflection

**What was the breakthrough that moved the work forward?**

Treating the audio graph as something to listen to and re-tune, not just
implement once. Steps 1--3 gave me a working synth --- velocity to pitch,
Y to filter cutoff, X to waveform crossfade --- but "working" and "good to
listen to" turned out to be different bars. The breakthrough was noticing
*why* it sounded harsh (two unrelated waveforms that could land on any
dissonant interval) rather than just turning gains down, and fixing the
actual cause: locking the second oscillator to a perfect fifth above the
root so it's structurally impossible for the pad to sound sour, wherever
you touch it. The same habit caught the echo ringing on too long after I'd
already called the ambient rework "done" --- the fix came from listening
again, not from a spec line.

**What did this work change about who I want to be as a software developer?**

I want to be someone who treats a bug report like "it sounds chaotic" as a
real defect with a root cause, the same way I'd treat a stack trace, instead
of tweaking numbers until it feels roughly better. The keyboard input work
reinforced the other half of that: the obvious implementation (reuse the
pointer's data structure) would have quietly broken an invariant elsewhere
in the code, and catching that before writing it, not after debugging it
later, is the kind of judgement I want writing code to keep depending on
even as more of the typing gets delegated.
