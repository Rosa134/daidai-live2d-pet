const assert = require("node:assert");
const test = require("node:test");
const { MIN_PET_WINDOW, mergeConfig } = require("../src/main/config-store");

test("mergeConfig clamps tiny pet window bounds", () => {
  const config = mergeConfig(
    {
      petWindow: {
        width: 119,
        height: 136,
        x: 1764,
        y: 798
      }
    },
    {}
  );

  assert.equal(config.petWindow.width, MIN_PET_WINDOW.width);
  assert.equal(config.petWindow.height, MIN_PET_WINDOW.height);
  assert.equal(config.petWindow.x, 1764);
  assert.equal(config.petWindow.y, 798);
});
