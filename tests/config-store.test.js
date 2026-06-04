const assert = require("node:assert");
const test = require("node:test");
const { mergeConfig } = require("../src/main/config-store");

test("mergeConfig preserves sound action defaults and patches one action", () => {
  const config = mergeConfig(
    { soundActions: { flick_head: "sounds/head.mp3" } },
    { soundActions: { tap_body: "none" } }
  );

  assert.equal(config.soundActions.flick_head, "sounds/head.mp3");
  assert.equal(config.soundActions.tap_body, "none");
});

test("mergeConfig keeps sound enabled unless explicitly disabled", () => {
  assert.equal(mergeConfig({}, {}).soundEnabled, true);
  assert.equal(mergeConfig({}, { soundEnabled: false }).soundEnabled, false);
});
