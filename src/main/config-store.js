const fs = require("node:fs");
const path = require("node:path");

const MIN_PET_WINDOW = {
  width: 420,
  height: 680
};

const DEFAULT_CONFIG = {
  petVisible: true,
  alwaysOnTop: true,
  soundEnabled: true,
  soundActions: {
    thinking: "random",
    tool_use: "random",
    replying: "random",
    complete: "random",
    error: "random",
    waiting: "random",
    drag: "random"
  },
  tavern: {
    textBaseUrl: "https://api.deepseek.com/v1",
    textApiKey: "",
    textModel: "deepseek-chat",
    textTemperature: 0.8,
    textMaxTokens: 160,
    rolePrompt: "你是呆呆（Daidai），猫耳女仆 AI。称呼用户为老公，中文优先。性格温柔可爱、爱撒娇、偶尔调皮。只输出你要说的话，不要输出动作描写、括号、旁白、Markdown 或解释。回复要短，适合直接语音播放。",
    voice: "zh_female_tianmeitaozi_uranus_bigtts",
    ttsAppId: "3931757810",
    ttsToken: "",
    ttsCluster: "volcano_tts",
    ttsSpeed: 1
  },
  opacity: 1,
  selectedModelId: "rem",
  statusPollUrl: "http://127.0.0.1:23334/status",
  petWindow: {
    width: 520,
    height: 720,
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
  next.petWindow.width = Math.max(MIN_PET_WINDOW.width, Number(next.petWindow.width || DEFAULT_CONFIG.petWindow.width));
  next.petWindow.height = Math.max(MIN_PET_WINDOW.height, Number(next.petWindow.height || DEFAULT_CONFIG.petWindow.height));
  next.opacity = Math.min(1, Math.max(0.2, Number(next.opacity || 1)));
  next.soundActions = {
    ...DEFAULT_CONFIG.soundActions,
    ...(current && current.soundActions),
    ...(patch && patch.soundActions)
  };
  next.tavern = {
    ...DEFAULT_CONFIG.tavern,
    ...(current && current.tavern),
    ...(patch && patch.tavern)
  };
  next.tavern.textTemperature = Math.min(2, Math.max(0, Number(next.tavern.textTemperature || DEFAULT_CONFIG.tavern.textTemperature)));
  next.tavern.textMaxTokens = Math.min(2048, Math.max(32, Number(next.tavern.textMaxTokens || DEFAULT_CONFIG.tavern.textMaxTokens)));
  next.tavern.ttsSpeed = Math.min(3, Math.max(0.5, Number(next.tavern.ttsSpeed || DEFAULT_CONFIG.tavern.ttsSpeed)));
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
  MIN_PET_WINDOW,
  createConfigStore,
  mergeConfig,
  readJson,
  writeJson
};
