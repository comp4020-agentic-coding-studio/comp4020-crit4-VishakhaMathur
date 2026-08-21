import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

// Contract tests for crits/04-instrument (see the course website for the full
// spec). Lines only a person can judge at the crit — expressiveness, whether a
// stranger can pick it up unprompted, latency and feel — aren't testable here
// and aren't attempted.

const DIST = resolve("dist");

function files(dir: string = DIST): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  });
}

const shipped = files();
const htmlFiles = shipped.filter((path) => path.endsWith(".html"));
const jsFiles = shipped.filter((path) => path.endsWith(".js"));
const jsSource = jsFiles.map((path) => readFileSync(path, "utf8")).join("\n");

const home = new JSDOM(readFileSync(resolve(DIST, "index.html"), "utf8")).window.document;

describe("instrument: sound is made live, not played back", () => {
  it("drives synthesis through the Web Audio API", () => {
    expect(
      jsSource,
      "no AudioContext/OscillatorNode/AudioBufferSourceNode found in the shipped JS — the brief asks for sound synthesised live in the browser",
    ).toMatch(/AudioContext|OscillatorNode|AudioBufferSourceNode/);
  });

  it("ships no pre-recorded audio or video elements", () => {
    for (const path of htmlFiles) {
      const doc = new JSDOM(readFileSync(path, "utf8")).window.document;
      expect(
        doc.querySelectorAll("audio, video").length,
        `${path} ships an <audio>/<video> element — the instrument should synthesise sound live, not play back a recording`,
      ).toBe(0);
    }
  });
});

describe("instrument: playable with whatever is at hand", () => {
  it("listens for pointer, touch, or keyboard input", () => {
    const inputEvents =
      /pointerdown|pointerup|mousedown|mouseup|touchstart|touchend|keydown|keyup/;
    expect(
      jsSource,
      "no pointer/touch/keyboard event listeners found in the shipped JS",
    ).toMatch(inputEvents);
  });
});

describe("instrument: no way to play it wrong", () => {
  it("has no score or fail-state language on the home page", () => {
    const text = home.body.textContent?.toLowerCase() ?? "";
    const failureLanguage = /\bscore\b|\bgame over\b|\byou (win|lose|lost)\b|\bfail(ed)?\b/;
    expect(
      text,
      "the home page mentions score/win/lose/fail language — the brief asks for no score and no fail state",
    ).not.toMatch(failureLanguage);
  });
});
