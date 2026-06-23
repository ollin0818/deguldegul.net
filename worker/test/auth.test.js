import test from "node:test";
import assert from "node:assert/strict";
import {
  nicknameKey,
  normalizeNickname,
  validateNickname
} from "../src/auth.js";

test("nickname whitespace is normalized", () => {
  assert.equal(normalizeNickname("  데굴   유저  "), "데굴 유저");
});

test("nickname length must be between 2 and 12 characters", () => {
  assert.equal(validateNickname("가").ok, false);
  assert.equal(validateNickname("데굴").ok, true);
  assert.equal(validateNickname("가나다라마바사아자차카타파").ok, false);
});

test("nickname duplicate key ignores case and Unicode composition", () => {
  assert.equal(nicknameKey("Player"), nicknameKey("player"));
  assert.equal(nicknameKey("가"), nicknameKey("\u1100\u1161"));
});
