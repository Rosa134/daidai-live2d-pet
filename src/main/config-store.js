const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_CONFIG = {
  petVisible: true,
  alwaysOnTop: true,
  soundEnabled: true,
  soundActions: {
    flick_head: "random",
    tap_body: "random"
  },
  opacity: 1,
  selectedModelId: "rem",
  statusPollUrl: "http://127.0.0.1:23334/status",
  petWindow: {
    width: 520,
    height: 620,
    x: null,
    y: null
  }
};

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function mergeConfig(current, patch) {
  const next = {
    ...DEFAULT_CONFIG,
    ...current,
    ...patch
  };
  next.petWindow = {
    ...DEFAULT_CONFIG.petWindow,
    ...(current && current.petWindow),
    ...(patch && patch.petWindow)
  };
  next.soundActions = {
    ...DEFAULT_CONFIG.soundActions,
    ...(current && current.soundActions),
    ...(patch && patch.soundActions)
  };
  next.opacity = Math.min(1, Math.max(0.2, Number(next.opacity || 1)));
  next.soundEnabled = next.soundEnabled !== false;
  return next;
}

function createConfigStore(userDataDir) {
  const file = path.join(userDataDir, "config.json");
  return {
    file,
    load() {
      return mergeConfig(readJson(file, DEFAULT_CONFIG), {});
    },
    save(patch) {
      const next = mergeConfig(readJson(file, DEFAULT_CONFIG), patch || {});
      writeJson(file, next);
      return next;
    }
  };
}

module.exports = {
  DEFAULT_CONFIG,
  createConfigStore,
  mergeConfig,
  readJson,
  writeJson
};
