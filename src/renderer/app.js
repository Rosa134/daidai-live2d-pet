(function () {
  const params = new URLSearchParams(window.location.search);
  const view = params.get("view") || "pet";
  const api = window.daidaiPet;
  const root = document.getElementById("app");

  let appState = null;
  let live2dApp = null;
  let live2dModel = null;
  let loadedModelId = null;
  let live2dResizeHandler = null;
  let cursorFocusTimer = null;
  let dragReactionUntil = 0;
  let lastDragMotionAt = 0;
  let statusMotionKind = "idle";
  let statusMotionTimer = null;
  // 全局错误捕获 - 显示在宠物窗上
  window.addEventListener("error", function(e) {
    var el = document.getElementById("empty-pet");
    if (el) {
      el.style.display = "grid";
      el.querySelector("strong").textContent = "JS Error";
      el.querySelector("span").textContent = (e.filename||"") + ":" + (e.lineno||"") + " " + (e.message||"");
    }
  });
  const lastReply = { codex: "", claude: "" };
  const holdUntil = { codex: 0, claude: 0 };
  const hideTimer = { codex: null, claude: null };
  const holdSignature = { codex: "", claude: "" };
  const dismissedSignature = { codex: "", claude: "" };

  function statusLabel(kind) {
    const labels = {
      thinking: "思考中",
      "running-tool": "运行中",
      "tool_use": "运行中",
      replying: "回复中",
      complete: "完成",
      completed: "完成",
      error: "出错",
      idle: "待机中"
    };
    return labels[kind] || kind || "待机中";
  }

  function dotKind(kind) {
    if (kind === "thinking") return "thinking";
    if (kind === "running-tool" || kind === "tool_use") return "working";
    if (kind === "replying") return "replying";
    if (kind === "complete" || kind === "completed") return "complete";
    if (kind === "error") return "error";
    return "idle";
  }

  function sourceName(source) {
    return source === "claude" ? "Claude Code" : "Codex";
  }

  function toolLabel(tool) {
    const labels = {
      read: "读取文件",
      write: "写入文件",
      edit: "编辑文件",
      search: "搜索中",
      fetch: "网络请求",
      execute: "执行命令",
      bash: "终端命令",
      shell: "终端命令",
      grep: "代码搜索",
      ls: "浏览目录",
      glob: "文件搜索",
      task: "子任务",
      memory: "记忆检索",
      skill: "技能调用",
      mcp: "MCP 工具"
    };
    return labels[tool] || tool || "";
  }

  function pickSource(status, source) {
    const sources = (status && status.sources) || [];
    return sources.find((item) => item.source === source) || null;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function focusLive2d(x, y, instant) {
    if (!live2dModel) return;
    x = clamp(x, -1, 1);
    y = clamp(y, -1, 1);

    try {
      if (live2dModel.internalModel && live2dModel.internalModel.focusController) {
        live2dModel.internalModel.focusController.focus(x, y, Boolean(instant));
        return;
      }
    } catch {}

    try {
      if (typeof live2dModel.focus === "function" && live2dApp) {
        const sx = ((x + 1) / 2) * live2dApp.screen.width;
        const sy = ((1 - y) / 2) * live2dApp.screen.height;
        live2dModel.focus(sx, sy, Boolean(instant));
      }
    } catch {}
  }

  function focusCursorPoint(x, y, instant) {
    if (!live2dModel) return;

    try {
      if (typeof live2dModel.focus === "function") {
        live2dModel.focus(x, y, Boolean(instant));
        return;
      }
    } catch {}

    if (!live2dApp) return;
    const nx = (x / Math.max(1, live2dApp.screen.width)) * 2 - 1;
    const ny = -((y / Math.max(1, live2dApp.screen.height)) * 2 - 1);
    focusLive2d(nx, ny, instant);
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function resetCursorFocus() {
    focusLive2d(0, 0, false);
  }

  function playLive2dMotion(group, index, actionKind) {
    if (!live2dModel || !group) return;
    try {
      live2dModel.motion(group, index || 0);
      if (loadedModelId && (group === 'tap_body' || group === 'flick_head')) {
        tryPlayModelSound(actionKind || group);
      }
    } catch {}
  }

  var _lastSoundTime = 0;
  function resolveSoundUrl(actionId) {
    var sounds = (appState && appState.selectedSounds) || [];
    if (!sounds.length) return null;
    var actions = (appState && appState.config && appState.config.soundActions) || {};
    var selection = actions[actionId] || "random";
    if (selection === "none") return null;
    if (selection !== "random") {
      var selected = sounds.find(function(s) { return s.id === selection; });
      if (selected) return selected.url;
    }
    return sounds[Math.floor(Math.random() * sounds.length)].url;
  }

  function playSoundUrl(url) {
    if (!url) return;
    var audio = new Audio(url);
    audio.volume = 0.4;
    audio.play().catch(function() {});
  }

  function tryPlayModelSound(actionId, preview) {
    if (!preview && appState && appState.config && appState.config.soundEnabled === false) return;
    var now = Date.now();
    if (!preview && now - _lastSoundTime < 800) return;
    _lastSoundTime = now;
    try {
      playSoundUrl(resolveSoundUrl(actionId));
    } catch (e) {}
  }

  function motionForStatus(kind) {
    if (kind === "thinking") return "flick_head";
    if (kind === "running-tool" || kind === "tool_use") return "tap_body";
    if (kind === "replying") return "tap_body";
    if (kind === "complete" || kind === "completed") return "tap_body";
    if (kind === "error") return "flick_head";
    if (kind === "waiting-permission" || kind === "waiting-input") return "flick_head";
    return "idle";
  }

  function primaryStatusItem(status) {
    const sources = ((status && status.sources) || []).slice();
    sources.sort((a, b) => Number(b.timestamp || Date.parse(b.updatedAt || "") || 0) - Number(a.timestamp || Date.parse(a.updatedAt || "") || 0));
    return sources.find((item) => item.kind && item.kind !== "idle") || sources.find((item) => item.text) || null;
  }

  function updateLive2dMotion(status, force) {
    const item = primaryStatusItem(status);
    const kind = item && item.kind ? item.kind : "idle";
    const motion = motionForStatus(kind);
    const changed = force || kind !== statusMotionKind;

    if (changed && statusMotionTimer) {
      clearInterval(statusMotionTimer);
      statusMotionTimer = null;
    }

    if (motion !== "idle" && changed) {
      playLive2dMotion(motion, 0, kind);
    }
    statusMotionKind = kind;

    if (!statusMotionTimer && (kind === "thinking" || kind === "waiting-permission" || kind === "waiting-input")) {
      statusMotionTimer = setInterval(() => playLive2dMotion("flick_head", 1), 2500);
    }
  }

  var SOUND_ACTIONS = [
    { id: "thinking", name: "思考中", detail: "AI 正在推理时触发" },
    { id: "tool_use", name: "运行工具", detail: "执行 shell_command 等工具时触发" },
    { id: "replying", name: "回复中", detail: "AI 正在输出回复时触发" },
    { id: "complete", name: "完成", detail: "任务完成后最后一次气泡更新时触发" },
    { id: "error", name: "出错", detail: "会话报错时触发" },
    { id: "waiting", name: "等待确认", detail: "等待用户授权/确认时触发" },
    { id: "drag", name: "拖动宠物", detail: "用户拖动窗口时触发" }
  ];

  function renderSoundSettings(state) {
    var sounds = state.selectedSounds || [];
    var options = [
      '<option value="random">随机播放</option>',
      '<option value="none">此动作静音</option>',
      sounds.map(function(s) { return '<option value="' + escapeHtml(s.id) + '">' + escapeHtml(s.name) + '</option>'; }).join("")
    ].join("");

    if (!sounds.length) {
      return [
        '<section class="section"><h2>音效配置</h2>',
        '<div class="sound-empty">声音库还没有音频。点击下方按钮打开声音目录，放入 .mp3 /.wav /.ogg 文件，会自动出现在这里。</div>',
        '<div style="margin-top:8px"><button id="open-sounds-dir">打开声音目录</button></div>',
        '</section>'
      ].join("");
    }

    var rows = SOUND_ACTIONS.map(function(action) {
      var val = (state.config.soundActions && state.config.soundActions[action.id]) || "random";
      var hasValue = val === "random" || val === "none" || sounds.some(function(s) { return s.id === val; });
      if (!hasValue) val = "random";
      return [
        '<div class="sound-row">',
        '  <div><strong>' + escapeHtml(action.name) + '</strong><span class="muted">' + escapeHtml(action.detail) + '</span></div>',
        '  <select data-sound-action="' + escapeHtml(action.id) + '">' + options + '</select>',
        '  <button type="button" data-preview-sound="' + escapeHtml(action.id) + '">试听</button>',
        '</div>'
      ].join("");
    }).join("");

    return [
      '<section class="section">',
      '  <div class="section-head"><h2>音效配置</h2><button id="open-sounds-dir">打开声音目录</button></div>',
      '  <div class="sound-list">' + rows + '</div>',
      '</section>'
    ].join("");
  }

  function renderManager(state) {
    root.innerHTML = `
      <div class="manager-shell">
        <aside class="sidebar">
          <h1>Daidai Live2D Pet</h1>
          <p>后台管理、模型导入、状态 adapter。当前项目独立于成熟 ClaudePet。</p>
        </aside>
        <main class="main-panel">
          <div class="toolbar">
            <button class="primary" id="import-model">导入 Live2D 目录</button>
            <button id="open-models">打开模型目录</button>
            <button id="show-pet">显示宠物</button>
            <button class="danger" id="hide-pet">隐藏宠物</button>
          </div>
          <section class="section">
            <h2>应用设置</h2>
            <div class="settings-grid">
              <label class="setting-row">
                <span>
                  <strong>总在最前</strong>
                  <span class="muted">宠物窗口保持在其他窗口之上</span>
                </span>
                <input id="always-on-top" type="checkbox" />
              </label>
              <label class="setting-row">
                <span>
                  <strong>透明度</strong>
                  <span class="muted">调整宠物窗口整体透明度</span>
                </span>
                <input id="opacity" type="range" min="0.2" max="1" step="0.05" />
              </label>
              <label class="setting-row">
                <span>
                  <strong>声音</strong>
                  <span class="muted">点击或动作切换时播放模型音效</span>
                </span>
                <span class="switch-control">
                  <input id="sound-enabled" type="checkbox" />
                  <span class="switch-track" aria-hidden="true"></span>
                </span>
              </label>
              <label class="setting-row">
                <span>
                  <strong>状态服务</strong>
                  <span class="muted">默认兼容本地成熟宠物 bridge 的 /status</span>
                </span>
                <input id="status-url" type="text" />
              </label>
            </div>
          </section>
          ${renderSoundSettings(state)}
          <section class="section">
            <h2>Live2D 模型</h2>
            <div id="model-list" class="model-list"></div>
          </section>
        </main>
      </div>
    `;

    const alwaysOnTop = document.getElementById("always-on-top");
    const opacity = document.getElementById("opacity");
    const soundEnabled = document.getElementById("sound-enabled");
    const statusUrl = document.getElementById("status-url");
    alwaysOnTop.checked = Boolean(state.config.alwaysOnTop);
    opacity.value = String(state.config.opacity || 1);
    soundEnabled.checked = state.config.soundEnabled !== false;
    statusUrl.value = state.config.statusPollUrl || "";

    document.getElementById("import-model").addEventListener("click", async () => {
      appState = await api.importModelDirectory();
      renderManager(appState);
    });
    document.getElementById("open-models").addEventListener("click", () => api.openModelsDirectory());
    document.getElementById("show-pet").addEventListener("click", () => api.showPet());
    document.getElementById("hide-pet").addEventListener("click", () => api.hidePet());
    alwaysOnTop.addEventListener("change", () => api.setConfig({ alwaysOnTop: alwaysOnTop.checked }));
    opacity.addEventListener("input", () => api.setConfig({ opacity: Number(opacity.value) }));
    soundEnabled.addEventListener("change", () => api.setConfig({ soundEnabled: soundEnabled.checked }));
    statusUrl.addEventListener("change", () => api.setConfig({ statusPollUrl: statusUrl.value.trim() }));

    // Sound action selects
    var soundSelects = document.querySelectorAll("[data-sound-action]");
    for (var si = 0; si < soundSelects.length; si++) {
      var select = soundSelects[si];
      var actionId = select.dataset.soundAction;
      var selectedSound = (state.config.soundActions && state.config.soundActions[actionId]) || "random";
      var hasSound = selectedSound === "random" || selectedSound === "none" || (state.selectedSounds || []).some(function(s) { return s.id === selectedSound; });
      select.value = hasSound ? selectedSound : "random";
      select.addEventListener("change", async function() {
        var patch = {};
        patch[actionId] = select.value;
        var soundActions = Object.assign({}, appState.config.soundActions || {}, patch);
        appState = await api.setConfig({ soundActions: soundActions });
        renderManager(appState);
      });
    }

    // Sound preview buttons
    var previewBtns = document.querySelectorAll("[data-preview-sound]");
    for (var pi = 0; pi < previewBtns.length; pi++) {
      previewBtns[pi].addEventListener("click", function() {
        tryPlayModelSound(this.dataset.previewSound, true);
      });
    }

    // Open sounds directory
    var openSoundsBtn = document.getElementById("open-sounds-dir");
    if (openSoundsBtn) {
      openSoundsBtn.addEventListener("click", async function() {
        appState = await api.openSoundsDirectory();
        renderManager(appState);
      });
    }

    renderModelList(state);

  }

  function renderModelList(state) {
    const list = document.getElementById("model-list");
    list.textContent = "";

    if (!state.models.length) {
      const empty = document.createElement("div");
      empty.className = "model-row";
      empty.textContent = "还没有导入模型。请选择一个包含 .model.json 或 .model3.json 的 Live2D 目录。";
      list.appendChild(empty);
      return;
    }

    for (const model of state.models) {
      const row = document.createElement("div");
      row.className = "model-row";

      const info = document.createElement("div");
      const title = document.createElement("div");
      title.className = "model-title";
      title.textContent = model.name;
      const pill = document.createElement("span");
      pill.className = "pill";
      pill.textContent = model.kind;
      title.appendChild(pill);
      const detail = document.createElement("div");
      detail.className = "muted";
      detail.textContent = model.modelPath;
      info.appendChild(title);
      info.appendChild(detail);

      const action = document.createElement("button");
      const selected = state.config.selectedModelId === model.id;
      const supported = model.kind === "cubism2";
      action.textContent = supported ? (selected ? "使用中" : "使用") : "稍后支持";
      action.disabled = selected || !supported;
      action.className = selected || !supported ? "" : "primary";
      action.addEventListener("click", async () => {
        appState = await api.selectModel(model.id);
        renderManager(appState);
      });

      row.appendChild(info);
      row.appendChild(action);
      list.appendChild(row);
    }
  }

  function renderPetShell() {
    document.body.className = "pet-body";
    root.innerHTML = `
      <div class="pet-stage" id="pet-stage">
        <canvas id="live2d-canvas"></canvas>
        <div class="empty-pet" id="empty-pet">
          <div>
            <strong id="empty-title">还没有选择 Live2D 模型</strong>
            <span id="empty-desc">从托盘打开管理，导入模型目录后就能显示。</span>
          </div>
        </div>
        <div class="bubble-stack">
          <div class="agent-bubble" id="bubble-codex">
            <div class="bubble-head"><span class="dot" id="dot-codex"></span><span class="bubble-title" id="title-codex"></span></div>
            <div class="bubble-text" id="text-codex"></div>
          </div>
          <div class="agent-bubble" id="bubble-claude">
            <div class="bubble-head"><span class="dot" id="dot-claude"></span><span class="bubble-title" id="title-claude"></span></div>
            <div class="bubble-text" id="text-claude"></div>
          </div>
        </div>
      </div>
    `;
  }

  function loadModelSettings(url) {
    // Use fetch for file:// URLs (external models), XHR for relative paths
    var isFile = typeof url === "string" && url.startsWith("file://");
    if (isFile) {
      return fetch(url).then(function(r) {
        if (!r.ok) throw new Error("fetch failed: " + r.status);
        return r.json().then(function(settings) {
          settings.url = url;
          return settings;
        });
      });
    }
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("GET", url);
      xhr.overrideMimeType("application/json");
      xhr.onload = () => {
        if (xhr.status !== 0 && (xhr.status < 200 || xhr.status >= 300)) {
          reject(new Error(`加载模型配置失败: ${xhr.status} ${url}`));
          return;
        }

        try {
          const settings = JSON.parse(xhr.responseText);
          settings.url = url;
          resolve(settings);
        } catch (error) {
          reject(new Error(`模型配置不是有效 JSON: ${url}; ${error.message || error}`));
        }
      };
      xhr.onerror = () => reject(new Error(`加载模型配置失败: ${url}`));
      xhr.send();
    });
  }

  function fitLive2dModel() {
    if (!live2dApp || !live2dModel) return;

    var cw = live2dApp.screen.width;
    var ch = live2dApp.screen.height;
    live2dModel.anchor.set(0.5, 1);
    live2dModel.scale.set(Math.min(cw / 1000, ch / 1800, 0.14));
    live2dModel.position.set(cw / 2, ch - 10);

    live2dApp.renderer.render(live2dApp.stage);
    var bounds = live2dModel.getBounds();
    live2dModel.position.x += cw / 2 - (bounds.x + bounds.width / 2);
    live2dModel.position.y += (ch - 10) - (bounds.y + bounds.height);
  }

  function destroyLive2dApp() {
    if (live2dResizeHandler) {
      window.removeEventListener("resize", live2dResizeHandler);
      live2dResizeHandler = null;
    }
    unloadLive2dModel();
    if (live2dApp) {
      live2dApp.destroy(false, { children: true, texture: true, baseTexture: true });
      live2dApp = null;
    }
  }

  function clearStatusMotion() {
    statusMotionKind = "idle";
    if (statusMotionTimer) {
      clearInterval(statusMotionTimer);
      statusMotionTimer = null;
    }
  }

  function unloadLive2dModel() {
    if (live2dModel) {
      try {
        if (live2dApp && live2dApp.stage) live2dApp.stage.removeChild(live2dModel);
        if (typeof live2dModel.destroy === "function") {
          live2dModel.destroy({ children: true });
        }
      } catch {}
      live2dModel = null;
    }
    loadedModelId = null;
    clearStatusMotion();
  }

  function ensureLive2dApp(canvas) {
    if (live2dApp) return live2dApp;

    live2dApp = new PIXI.Application({
      view: canvas,
      transparent: true,
      backgroundAlpha: 0,
      width: window.innerWidth,
      height: window.innerHeight,
      antialias: true,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
      autoStart: true
    });

    live2dResizeHandler = fitLive2dModel;
    window.addEventListener("resize", live2dResizeHandler);
    return live2dApp;
  }

  function showLive2dError(title, message) {
    const empty = document.getElementById("empty-pet");
    if (!empty) return;
    empty.style.display = "grid";
    empty.querySelector("strong").textContent = title;
    empty.querySelector("span").textContent = message || "";
  }

  function hideLive2dError() {
    const empty = document.getElementById("empty-pet");
    if (empty) {
      empty.style.display = "none";
    }
  }

  var _loadingModelId = null;
  var _loadToken = 0;
  async function loadLive2dModel(model) {
    if (!model) {
      unloadLive2dModel();
      showLive2dError("还没有选择 Live2D 模型", "从托盘打开管理，导入模型目录后就能显示。");
      _loadingModelId = null;
      return;
    }
    if (model.kind !== "cubism2") {
      unloadLive2dModel();
      showLive2dError("暂不支持该模型格式", "当前验证版先支持 Cubism2，Haru 等 Cubism3+ 模型稍后单独接入。");
      _loadingModelId = null;
      return;
    }
    // 如果同一个模型正在加载中，等待它完成
    if (_loadingModelId === model.id) return;
    // 如果已经加载完成，跳过
    if (loadedModelId === model.id) return;

    _loadingModelId = model.id;

    if (!window.PIXI || !window.PIXI.live2d || !window.PIXI.live2d.Live2DModel) {
      showLive2dError("Live2D runtime 未加载", "");
      _loadingModelId = null;
      return;
    }

    const canvas = document.getElementById("live2d-canvas");
    const token = ++_loadToken;

    try {
      ensureLive2dApp(canvas);
      unloadLive2dModel();
      var modelUrl = model.modelUrl || model.modelPath.replace(/\\/g, "/");
      var settings = await loadModelSettings(modelUrl);
      var nextModel = await PIXI.live2d.Live2DModel.from(settings);
      if (token !== _loadToken) {
        try {
          nextModel.destroy({ children: true });
        } catch {}
        return;
      }
      live2dModel = nextModel;
      loadedModelId = model.id;
      _loadingModelId = null;
      live2dApp.stage.addChild(live2dModel);
      fitLive2dModel();
      hideLive2dError();
      updateLive2dMotion(appState && appState.status, true);
    } catch (error) {
      _loadingModelId = null;
      loadedModelId = null;
      unloadLive2dModel();
      showLive2dError("Live2D 加载错误", error.message || String(error));
    }
  }


  function clearBubbleHold(source) {
    if (hideTimer[source]) {
      clearTimeout(hideTimer[source]);
      hideTimer[source] = null;
    }
    holdUntil[source] = 0;
    holdSignature[source] = "";
    dismissedSignature[source] = "";
  }

  function scheduleBubbleHide(source, bubble) {
    if (hideTimer[source]) clearTimeout(hideTimer[source]);
    hideTimer[source] = setTimeout(() => {
      if (bubble) bubble.classList.remove("visible");
      dismissedSignature[source] = holdSignature[source];
      holdUntil[source] = 0;
      hideTimer[source] = null;
    }, 30000);
  }

  function replySignature(item, replyText) {
    if (!item) return "";
    return [
      item.sessionId || item.session_id || "",
      item.timestamp || item.updatedAt || "",
      replyText || ""
    ].join("|");
  }

  function renderBubble(source, item) {
    const bubble = document.getElementById(`bubble-${source}`);
    const dot = document.getElementById(`dot-${source}`);
    const title = document.getElementById(`title-${source}`);
    const text = document.getElementById(`text-${source}`);
    if (!bubble || !dot || !title || !text) return;

    const now = Date.now();
    let kind = item && item.kind ? item.kind : "idle";
    const content = item && item.text ? item.text : "";
    const holding = holdUntil[source] > now && lastReply[source];
    const terminalReply = kind === "complete" || kind === "completed" || (kind === "idle" && content);

    if ((!item || (kind === "idle" && !content)) && !holding) {
      bubble.classList.remove("visible");
      return;
    }

    if (terminalReply || holding) {
      const replyText = content && content !== "complete" ? content : lastReply[source];
      if (!replyText) {
        bubble.classList.remove("visible");
        return;
      }

      const signature = replySignature(item, replyText);
      if (!holding && terminalReply && dismissedSignature[source] === signature) {
        bubble.classList.remove("visible");
        return;
      }

      lastReply[source] = replyText;
      if (terminalReply) {
        if (holdSignature[source] !== signature) {
          holdSignature[source] = signature;
          dismissedSignature[source] = "";
          holdUntil[source] = now + 30000;
          scheduleBubbleHide(source, bubble);
        }
      }

      if (holdUntil[source] && now >= holdUntil[source]) {
        bubble.classList.remove("visible");
        return;
      }

      kind = "complete";
      dot.className = `dot ${dotKind(kind)}`;
      title.textContent = `${sourceName(source)} 回复`;
      text.textContent = replyText;
      bubble.classList.add("visible");
      return;
    }

    clearBubbleHold(source);

    if (content && kind === "replying") lastReply[source] = content;

    dot.className = `dot ${dotKind(kind)}`;

    if (kind === "thinking") {
      title.textContent = `${sourceName(source)} 思考中`;
      text.textContent = lastReply[source] || "";
    } else if (kind === "running-tool" || kind === "tool_use") {
      const label = toolLabel(item && item.tool);
      title.textContent = `${sourceName(source)} 工作中${label ? ` - ${label}` : ""}`;
      text.textContent = lastReply[source] || content || (label ? `正在调用：${label}` : "");
    } else if (kind === "replying") {
      title.textContent = `${sourceName(source)} 回复中`;
      text.textContent = content || lastReply[source] || "";
    } else if (kind === "error") {
      title.textContent = `${sourceName(source)} 出错`;
      text.textContent = content || lastReply[source] || "";
    } else {
      title.textContent = `${sourceName(source)} ${statusLabel(kind)}`;
      text.textContent = content || lastReply[source] || "";
    }

    bubble.classList.add("visible");
  }

  function renderPetState(state) {
    loadLive2dModel(state.selectedModel);
    renderBubble("codex", pickSource(state.status, "codex"));
    renderBubble("claude", pickSource(state.status, "claude"));
    updateLive2dMotion(state.status);
  }

  function bindPetInteractions() {
    function cursorLocalPosition(payload) {
      if (!payload) return null;
      if (Number.isFinite(payload.x) && Number.isFinite(payload.y)) {
        return { x: payload.x, y: payload.y };
      }
      if (payload.point && payload.bounds) {
        return {
          x: payload.point.x - payload.bounds.x,
          y: payload.point.y - payload.bounds.y
        };
      }
      return null;
    }

    api.onCursorPosition((payload) => {
      if (!live2dModel || Date.now() < dragReactionUntil) return;
      const local = cursorLocalPosition(payload);
      if (!local) return;
      focusCursorPoint(local.x, local.y, false);
      if (cursorFocusTimer) clearTimeout(cursorFocusTimer);
      cursorFocusTimer = setTimeout(resetCursorFocus, 2500);
    });
    api.onDragState((payload) => {
      const stage = document.getElementById("pet-stage");
      if (!stage) return;
      const active = Boolean(payload && (payload.dragging || payload.active));
      stage.classList.toggle("dragging", active);

      if (!active) {
        dragReactionUntil = Date.now() + 250;
        if (cursorFocusTimer) clearTimeout(cursorFocusTimer);
        cursorFocusTimer = setTimeout(resetCursorFocus, 450);
        return;
      }

      const dx = payload.dx || 0;
      const dy = payload.dy || 0;
      const vx = payload.vx || 0;
      const vy = payload.vy || 0;
      const x = clamp(dx / 28 + vx * 12, -1, 1);
      const y = clamp(-(dy / 36 + vy * 10), -1, 1);
      dragReactionUntil = Date.now() + 350;
      focusLive2d(x, y, false);

      const now = Date.now();
      if (now - lastDragMotionAt > 900) {
        lastDragMotionAt = now;
        playLive2dMotion("flick_head", 0, "drag");
      }
    });

    window.addEventListener("mousemove", (event) => {
      if (!live2dModel || Date.now() < dragReactionUntil) return;
      focusCursorPoint(event.clientX, event.clientY, false);
      if (cursorFocusTimer) clearTimeout(cursorFocusTimer);
      cursorFocusTimer = setTimeout(resetCursorFocus, 2500);
    });
    window.addEventListener("mouseleave", resetCursorFocus);
  }

  async function boot() {
    appState = await api.getState();
    if (view === "manager") {
      renderManager(appState);
    } else {
      renderPetShell();
      bindPetInteractions();
      renderPetState(appState);
    }
    api.onUpdate((next) => {
      appState = next;
      if (view === "manager") {
        renderManager(appState);
      } else {
        renderPetState(appState);
      }
    });
  }

  boot().catch((error) => {
    root.textContent = `启动失败：${error.message || error}`;
  });
})();
