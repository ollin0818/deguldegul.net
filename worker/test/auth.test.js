import test from "node:test";
import assert from "node:assert/strict";
import {
  containsBlockedNicknameTerm,
  nicknameKey,
  nicknameModerationKey,
  normalizeNickname,
  validateNickname,
  validateProfileColor
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

test("nickname moderation normalizes separators and common disguises", () => {
  assert.equal(nicknameModerationKey("f.u.c.k"), "fuck");
  assert.equal(nicknameModerationKey("sh1t"), "shit");
  assert.equal(nicknameModerationKey("씨  발"), "씨발");
});

test("sexual and profane nicknames are rejected", () => {
  assert.equal(containsBlockedNicknameTerm("씨 발"), true);
  assert.equal(containsBlockedNicknameTerm("f.u.c.k"), true);
  assert.equal(containsBlockedNicknameTerm("p0rn-user"), true);
  assert.equal(containsBlockedNicknameTerm("섹 스"), true);
  assert.deepEqual(validateNickname("sh1t"), {
    ok: false,
    code: "inappropriate_nickname",
    message: "선정적이거나 비속어가 포함된 닉네임은 사용할 수 없습니다."
  });
});

test("ordinary nicknames are not blocked by ambiguous fragments", () => {
  assert.equal(validateNickname("Sussex").ok, true);
  assert.equal(validateNickname("Grape").ok, true);
  assert.equal(validateNickname("클래식왕").ok, true);
  assert.equal(validateNickname("데굴마스터").ok, true);
});

test("profile color accepts only six-digit hex colors", () => {
  assert.deepEqual(validateProfileColor("#64BEFF"), {
    ok: true,
    color: "#64beff"
  });
  assert.equal(validateProfileColor("red").ok, false);
  assert.equal(validateProfileColor("#fff").ok, false);
});
