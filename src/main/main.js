const path = require("node:path");
const fs = require("node:fs");
const { pathToFileURL } = require("node:url");
const { app, BrowserWindow, dialog, ipcMain, Menu, shell, screen, Tray } = require("electron");
const { createCodexSessionMonitor } = require("./codex-session-monitor");
const { MIN_PET_WINDOW, createConfigStore } = require("./config-store");
const { createModelRegistry } = require("./model-registry");
const { createStatusBridge } = require("./status-bridge");
const { createStatusPoller } = require("./status-poller");

let petWindow = null;
let managerWindow = null;
let tray = null;
let configStore = null;
let modelRegistry = null;
let statusBridge = null;
let codexMonitor = null;
let statusPoller = null;
let config = null;
let userHidden = false;
let cursorTimer = null;
let boundsSaveTimer = null;
let dragEndTimer = null;
let topTimer = null;
let lastMoveBounds = null;
let lastMoveAt = 0;

function rendererFile() {
  return path.join(__dirname, "..", "renderer", "index.html");
}

function appIcon() {
  return path.join(__dirname, "..", "renderer", "assets", "app-icon.png");
}

function selectedModel() {
  return config.selectedModelId ? modelRegistry.get(config.selectedModelId) : null;
}

function scanSoundsDir() {
  const dir = path.join(app.getPath("userData"), "sounds");
  if (!fs.existsSync(dir)) return [];
  const sounds = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && /\.(mp3|wav|ogg)$/i.test(entry.name)) {
        const full = path.join(dir, entry.name);
        sounds.push({ id: entry.name, name: entry.name, url: pathToFileURL(full).href });
      }
    }
  } catch {}
  return sounds.sort((a, b) => a.name.localeCompare(b.name));
}

function rendererPayload() {
  return {
    appVersion: app.getVersion(),
    config,
    models: modelRegistry.list(),
    selectedModel: selectedModel(),
    selectedSounds: scanSoundsDir(),
    status: statusPoller ? statusPoller.getLastStatus() : { sources: [] }
  };
}

function broadcast() {
  const payload = rendererPayload();
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send("app:update", payload);
  }
}

function keepPetOnTop() {
  if (!petWindow || petWindow.isDestroyed() || !config || !config.alwaysOnTop) return;
  petWindow.setAlwaysOnTop(true, "screen-saver");
}

function startAlwaysOnTopGuard() {
  if (topTimer) return;
  topTimer = setInterval(keepPetOnTop, 1000);
}

function savePetBounds() {
  if (!petWindow || petWindow.isDestroyed()) return;
  const bounds = petWindow.getBounds();
  config = configStore.save({
    petWindow: {
      ...config.petWindow,
      width: bounds.width,
      height: bounds.height,
      x: bounds.x,
      y: bounds.y
    }
  });
  broadcast();
}

function resolvePetWindowBounds(savedBounds) {
  let width = Math.max(MIN_PET_WINDOW.width, Number(savedBounds.width || 520));
  let height = Math.max(MIN_PET_WINDOW.height, Number(savedBounds.height || 620));
  const point = {
    x: Number.isFinite(savedBounds.x) ? savedBounds.x : 0,
    y: Number.isFinite(savedBounds.y) ? savedBounds.y : 0
  };
  const display = screen.getDisplayMatching({ ...point, width, height });
  const area = display.workArea;
  width = Math.min(width, area.width);
  height = Math.min(height, area.height);

  const result = { width, height };
  if (Number.isFinite(savedBounds.x)) {
    result.x = Math.round(Math.min(Math.max(savedBounds.x, area.x), area.x + area.width - width));
  }
  if (Number.isFinite(savedBounds.y)) {
    result.y = Math.round(Math.min(Math.max(savedBounds.y, area.y), area.y + area.height - height));
  }
  return result;
}

function createPetWindow() {
  const bounds = resolvePetWindowBounds(config.petWindow || {});
  petWindow = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    minWidth: MIN_PET_WINDOW.width,
    minHeight: MIN_PET_WINDOW.height,
    x: Number.isFinite(bounds.x) ? bounds.x : undefined,
    y: Number.isFinite(bounds.y) ? bounds.y : undefined,
    frame: false,
    transparent: true,
    resizable: true,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    focusable: true,
    show: false,
    alwaysOnTop: Boolean(config.alwaysOnTop),
    opacity: Number(config.opacity || 1),
    icon: appIcon(),
    webPreferences: {
      preload: path.join(__dirname, "..", "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  petWindow.loadFile(rendererFile(), { query: { view: "pet" } });

  petWindow.once("ready-to-show", () => {
    keepPetOnTop();
    if (config.petVisible && !userHidden) {
      petWindow.show();
      petWindow.moveTop();
    }
    if (process.env.DAIDAI_TAVERN_SELFTEST === "1") {
      setTimeout(() => {
        if (!petWindow || petWindow.isDestroyed()) return;
        petWindow.webContents.executeJavaScript(`
          (async function () {
            for (let i = 0; i < 50; i += 1) {
              if (window.__sendTavernMessage) break;
              await new Promise((resolve) => setTimeout(resolve, 100));
            }
            if (!window.__sendTavernMessage) throw new Error("tavern sender not ready");
            await window.__sendTavernMessage("老公测试一下");
            return true;
          })();
        `).catch((error) => {
          const file = path.join(app.getPath("userData"), "renderer-error.log");
          fs.appendFileSync(file, `${new Date().toISOString()} selftest ${error.message || error}\n`, "utf8");
        });
      }, 1000);
    }
  });
  petWindow.on("resize", () => {
    clearTimeout(boundsSaveTimer);
    boundsSaveTimer = setTimeout(savePetBounds, 200);
  });
  petWindow.on("move", () => {
    if (!petWindow || petWindow.isDestroyed()) return;
    const now = Date.now();
    const bounds = petWindow.getBounds();
    const previous = lastMoveBounds || bounds;
    const elapsed = Math.max(16, now - (lastMoveAt || now));
    const dx = bounds.x - previous.x;
    const dy = bounds.y - previous.y;
    lastMoveBounds = bounds;
    lastMoveAt = now;
    if (!dx && !dy) return;

    petWindow.webContents.send("pet:drag-state", {
      active: true,
      dragging: true,
      dx,
      dy,
      vx: dx / elapsed,
      vy: dy / elapsed,
      at: now
    });
    clearTimeout(dragEndTimer);
    dragEndTimer = setTimeout(() => {
      if (petWindow && !petWindow.isDestroyed()) {
        petWindow.webContents.send("pet:drag-state", {
          active: false,
          dragging: false,
          dx: 0,
          dy: 0,
          vx: 0,
          vy: 0,
          at: Date.now()
        });
      }
      savePetBounds();
    }, 180);
  });
  lastMoveBounds = petWindow.getBounds();
  lastMoveAt = Date.now();
}

function createManagerWindow() {
  managerWindow = new BrowserWindow({
    width: 980,
    height: 720,
    minWidth: 820,
    minHeight: 560,
    show: false,
    title: "Daidai Live2D Pet 管理",
    icon: appIcon(),
    webPreferences: {
      preload: path.join(__dirname, "..", "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  managerWindow.loadFile(rendererFile(), { query: { view: "manager" } });
  managerWindow.on("close", (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      managerWindow.hide();
    }
  });
}

function showManager() {
  if (!managerWindow || managerWindow.isDestroyed()) createManagerWindow();
  managerWindow.show();
  managerWindow.focus();
}

function showPet() {
  userHidden = false;
  config = configStore.save({ petVisible: true });
  if (!petWindow || petWindow.isDestroyed()) createPetWindow();
  keepPetOnTop();
  petWindow.show();
  petWindow.moveTop();
  broadcast();
}

function hidePet() {
  userHidden = true;
  config = configStore.save({ petVisible: false });
  if (petWindow && !petWindow.isDestroyed()) petWindow.hide();
  broadcast();
}

function createTray() {
  tray = new Tray(appIcon());
  tray.setToolTip("Daidai Live2D Pet");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "显示桌宠", click: showPet },
      { label: "隐藏桌宠", click: hidePet },
      { label: "打开管理", click: showManager },
      { type: "separator" },
      {
        label: "总在最前",
        type: "checkbox",
        checked: Boolean(config.alwaysOnTop),
        click: (item) => {
          config = configStore.save({ alwaysOnTop: item.checked });
          if (petWindow && !petWindow.isDestroyed()) {
            petWindow.setAlwaysOnTop(Boolean(config.alwaysOnTop), "screen-saver");
          }
          broadcast();
        }
      },
      { type: "separator" },
      { label: "退出", click: () => app.quit() }
    ])
  );
  tray.on("double-click", showManager);
}

function startCursorForwarding() {
  if (cursorTimer) return;
  cursorTimer = setInterval(() => {
    if (!petWindow || petWindow.isDestroyed() || !petWindow.isVisible()) return;
    const point = screen.getCursorScreenPoint();
    const bounds = petWindow.getBounds();
    petWindow.webContents.send("pet:cursor-position", {
      x: point.x - bounds.x,
      y: point.y - bounds.y,
      width: bounds.width,
      height: bounds.height,
      point,
      bounds
    });
  }, 50);
}

// Tavern: configurable chat + voice settings live in config.json.
let _tavernAbortController = null;
const VOLC_TTS_URL = "https://openspeech.bytedance.com/api/v1/tts";

function tavernChatPath() {
  const dir = path.join(app.getPath("userData"), "tavern");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function tavernLog(message, payload) {
  try {
    const file = path.join(app.getPath("userData"), "tavern.log");
    fs.appendFileSync(file, `${new Date().toISOString()} ${message}${payload ? ` ${JSON.stringify(payload)}` : ""}\n`, "utf8");
  } catch {}
}

function spokenTextOnly(text) {
  return String(text || "")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/[*_~`#>-]/g, "")
    .replace(/[（(][^（）()]{0,80}[）)]/g, "")
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function registerIpc() {
  ipcMain.handle("app:get-state", () => rendererPayload());
  ipcMain.handle("app:renderer-error", (_event, payload) => {
    try {
      const file = path.join(app.getPath("userData"), "renderer-error.log");
      fs.appendFileSync(file, `${new Date().toISOString()} ${JSON.stringify(payload)}\n`, "utf8");
    } catch {}
    return true;
  });
  ipcMain.handle("app:set-config", (_event, patch) => {
    config = configStore.save(patch || {});
    if (petWindow && !petWindow.isDestroyed()) {
      petWindow.setAlwaysOnTop(Boolean(config.alwaysOnTop), "screen-saver");
      petWindow.setOpacity(Number(config.opacity || 1));
    }
    broadcast();
    return rendererPayload();
  });
  ipcMain.handle("model:import-directory", async () => {
    const result = await dialog.showOpenDialog(managerWindow || undefined, {
      title: "选择 Live2D 模型目录",
      properties: ["openDirectory"]
    });
    if (result.canceled || !result.filePaths.length) return rendererPayload();
    const record = modelRegistry.importDirectory(result.filePaths[0]);
    config = configStore.save({ selectedModelId: record.id });
    broadcast();
    return rendererPayload();
  });
  ipcMain.handle("model:select", (_event, modelId) => {
    if (!modelRegistry.get(modelId)) throw new Error(`Model not found: ${modelId}`);
    config = configStore.save({ selectedModelId: modelId });
    broadcast();
    return rendererPayload();
  });
  ipcMain.handle("model:open-directory", async () => {
    await shell.openPath(modelRegistry.openDirectoryPath());
    return rendererPayload();
  });
  ipcMain.handle("model:open-sounds-directory", async () => {
    const dir = path.join(app.getPath("userData"), "sounds");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    await shell.openPath(dir);
    return rendererPayload();
  });
  ipcMain.handle("pet:show", () => {
    showPet();
    return rendererPayload();
  });
  ipcMain.handle("pet:hide", () => {
    hidePet();
    return rendererPayload();
  });
  // Tavern IPC
  ipcMain.handle("tavern:chat", async (_event, messages) => {
    if (_tavernAbortController) _tavernAbortController.abort();
    _tavernAbortController = new AbortController();
    try {
      const tavern = config.tavern || {};
      const apiKey = tavern.textApiKey || process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY || "";
      const baseUrl = String(tavern.textBaseUrl || "https://api.deepseek.com/v1").replace(/\/+$/, "");
      if (!apiKey) throw new Error("聊天模型 API Key 未配置");
      tavernLog("chat:start", { count: (messages || []).length });
      const body = JSON.stringify({
        model: tavern.textModel || "deepseek-chat",
        messages: [{ role: "system", content: tavern.rolePrompt || "" }].concat(messages || []),
        temperature: Number(tavern.textTemperature || 0.8),
        max_tokens: Number(tavern.textMaxTokens || 160),
        thinking: { type: "disabled" },
        stream: false
      });
      const resp = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + apiKey },
        body,
        signal: _tavernAbortController.signal
      });
      if (!resp.ok) throw new Error("Chat API " + resp.status);
      const data = await resp.json();
      const reply = spokenTextOnly((data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || "");
      tavernLog("chat:ok", { replyPreview: reply.slice(0, 40) });
      return { ok: true, reply };
    } catch (e) {
      tavernLog("chat:error", { name: e.name, message: e.message });
      if (e.name === "AbortError") return { ok: false, error: "aborted" };
      return { ok: false, error: e.message };
    } finally {
      _tavernAbortController = null;
    }
  });

  ipcMain.handle("tavern:tts", async (_event, text) => {
    const outFile = path.join(tavernChatPath(), "reply_" + Date.now() + ".mp3");
    try {
      const tavern = config.tavern || {};
      const token = tavern.ttsToken || process.env.VOLCENGINE_TOKEN || "";
      if (!token) throw new Error("火山 TTS Token 未配置");
      tavernLog("tts:start", { outFile, textPreview: String(text || "").slice(0, 40) });
      const payload = {
        app: {
          appid: tavern.ttsAppId || "3931757810",
          token: "access_token",
          cluster: tavern.ttsCluster || "volcano_tts"
        },
        user: { uid: "daidai_live2d_pet" },
        audio: {
          voice_type: tavern.voice || "zh_female_tianmeitaozi_uranus_bigtts",
          encoding: "mp3",
          speed_ratio: Number(tavern.ttsSpeed || 1),
          volume_ratio: 1.0
        },
        request: {
          reqid: `${Date.now()}_${Math.random().toString(16).slice(2)}`,
          text: String(text || ""),
          operation: "query"
        }
      };
      const resp = await fetch(VOLC_TTS_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer;${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });
      if (!resp.ok) throw new Error(`Volc TTS ${resp.status}`);
      const data = await resp.json();
      if (data.code !== 3000 || !data.data) {
        throw new Error(data.message || `Volc TTS code ${data.code}`);
      }
      fs.writeFileSync(outFile, Buffer.from(data.data, "base64"));
      tavernLog("tts:ok", { outFile, bytes: fs.statSync(outFile).size });
      return { ok: true, path: outFile, url: pathToFileURL(outFile).href };
    } catch (e) {
      tavernLog("tts:error", { error: String(e.message || e).slice(0, 300) });
      return { ok: false, error: String(e.message || e).slice(0, 300) };
    }
  });

  ipcMain.handle("tavern:cleanup", async () => {
    try {
      const dir = tavernChatPath();
      const files = fs.readdirSync(dir);
      const now = Date.now();
      for (const f of files) {
        if (f.endsWith(".mp3") && now - fs.statSync(path.join(dir, f)).mtimeMs > 3600000) {
          fs.unlinkSync(path.join(dir, f));
        }
      }
    } catch (e) {}
    return true;
  });

  ipcMain.handle("tavern:focus-window", () => {
    if (petWindow && !petWindow.isDestroyed()) {
      petWindow.focus();
    }
    return true;
  });

  ipcMain.handle("tavern:abort", () => {
    if (_tavernAbortController) {
      _tavernAbortController.abort();
      _tavernAbortController = null;
    }
    return true;
  });

}


// 数据目录：环境变量 DAIDAI_MODELS_DIR 优先，否则便携模式放 exe 同级
var userDataPath = process.env.DAIDAI_MODELS_DIR
  ? path.resolve(process.env.DAIDAI_MODELS_DIR)
  : (app.isPackaged
    ? path.join(path.dirname(app.getPath('exe')), 'user-data')
    : path.join(app.getAppPath(), 'user-data'));
app.setPath('userData', userDataPath);
app.whenReady().then(() => {
  configStore = createConfigStore(app.getPath("userData"));
  config = configStore.load();
  modelRegistry = createModelRegistry({
    userDataDir: app.getPath("userData"),
    bundledModelsDir: path.join(app.getAppPath(), "assets", "models")
  });

  // 首次启动：将预制模型复制到 userData + 注册，避免中文路径 file:// 加载问题
  const fsSync = fs;
  const modelsDir = path.join(app.getPath("userData"), "models");
  const registryFile = path.join(app.getPath("userData"), "models.json");
  const existingRegistry = (function() { try { return JSON.parse(fsSync.readFileSync(registryFile, "utf8")); } catch(e) { return { models: [] }; } })();
  const existingIds = new Set(existingRegistry.models.map(function(m){ return m.id }));

  const bundledModels = modelRegistry.list().filter(function(m){ return m.source === "bundled" });
  let anyImported = false;

  for (var bi = 0; bi < bundledModels.length; bi++) {
    var bm = bundledModels[bi];
    var dstDir = path.join(modelsDir, bm.name);
    // 跳过已导入的
    if (existingIds.has(bm.name)) continue;
    try {
      fsSync.cpSync(bm.directory, dstDir, { recursive: true, force: true });
      var modelFile = (function() {
        var entries = fsSync.readdirSync(dstDir, { withFileTypes: true });
        for (var ei = 0; ei < entries.length; ei++) {
          if (entries[ei].isFile() && (entries[ei].name.endsWith(".model.json") || entries[ei].name.endsWith(".model3.json"))) {
            return path.join(dstDir, entries[ei].name);
          }
        }
        return null;
      })();
      if (modelFile) {
        existingRegistry.models.push({
          id: bm.name,
          name: bm.name,
          source: "bundled",
          kind: bm.kind,
          directory: dstDir,
          modelPath: modelFile,
          importedAt: new Date().toISOString()
        });
        existingIds.add(bm.name);
        anyImported = true;
      }
    } catch(e) {
      console.error("[main] import bundled model failed:", bm.name, e.message);
    }
  }

  if (anyImported) {
    fsSync.writeFileSync(registryFile, JSON.stringify(existingRegistry, null, 2), "utf8");
  }

  // 若无有效选中的模型，自动选第一个可用（优先 rem）
  const allModels = modelRegistry.list();
  if (allModels.length && (!config.selectedModelId || !modelRegistry.get(config.selectedModelId))) {
    var preferred = allModels.find(function(m){ return m.name === "rem" });
    config = configStore.save({ selectedModelId: (preferred || allModels[0]).id });
  }

  statusPoller = createStatusPoller({
    getUrl: () => config.statusPollUrl,
    onUpdate: broadcast
  });
  statusBridge = createStatusBridge({
    onChange: () => {
      if (statusPoller) statusPoller.tickNow();
    }
  });
  codexMonitor = createCodexSessionMonitor({
    onEvent: (event) => {
      if (!statusBridge) return;
      statusBridge.updateState((event.data && event.data.agent) || "codex", event.event, event.data);
    }
  });

  registerIpc();
  createPetWindow();
  createManagerWindow();
  createTray();
  startAlwaysOnTopGuard();
  startCursorForwarding();
  statusBridge.start();
  codexMonitor.start();
  statusPoller.start();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createPetWindow();
    createManagerWindow();
  }
});

app.on("before-quit", () => {
  app.isQuitting = true;
  if (statusPoller) statusPoller.stop();
  if (codexMonitor) codexMonitor.stop();
  if (statusBridge) statusBridge.stop();
  if (cursorTimer) clearInterval(cursorTimer);
  if (boundsSaveTimer) clearTimeout(boundsSaveTimer);
  if (dragEndTimer) clearTimeout(dragEndTimer);
  if (topTimer) clearInterval(topTimer);
});
