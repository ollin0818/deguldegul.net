import test from "node:test";
import assert from "node:assert/strict";
import {
  AI_DIFFICULTIES,
  AI_RANKING_MODES,
  validateGameConfig,
  validateResultPayload
} from "../src/ai-ranking.js";

test("all requested AI difficulties are supported", () => {
  assert.deepEqual(AI_DIFFICULTIES, [
    "easy",
    "normal",
    "hard",
    "superhard",
    "extreme",
    "hell",
    "chaos"
  ]);
});

test("speed and item rankings are separate valid modes", () => {
  assert.deepEqual(AI_RANKING_MODES, ["speed", "item"]);
  assert.equal(validateGameConfig({ difficulty: "hard", mode: "speed" }).ok, true);
  assert.equal(validateGameConfig({ difficulty: "hard", mode: "item" }).ok, true);
  assert.equal(validateGameConfig({ difficulty: "hard", mode: "ghost" }).ok, false);
});

test("result submission requires bounded integer values", () => {
  const valid = validateResultPayload({
    sessionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    submissionToken: "a".repeat(43),
    clearTimeMs: 12345,
    territoryBasisPoints: 6789
  });
  assert.equal(valid.ok, true);

  assert.equal(validateResultPayload({
    ...valid,
    sessionId: "bad"
  }).ok, false);
  assert.equal(validateResultPayload({
    sessionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    submissionToken: "a".repeat(43),
    clearTimeMs: 999,
    territoryBasisPoints: 5000
  }).ok, false);
  assert.equal(validateResultPayload({
    sessionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    submissionToken: "a".repeat(43),
    clearTimeMs: 1000,
    territoryBasisPoints: 10001
  }).ok, false);
});
