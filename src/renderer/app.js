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

  function resetCursorFocus() {
    focusLive2d(0, 0, false);
  }

  function playLive2dMotion(group, index) {
    if (!live2dModel || !group) return;
    try {
      live2dModel.motion(group, index || 0);
      if (loadedModelId && (group === 'tap_body' || group === 'flick_head')) {
        tryPlayModelSound();
      }
    } catch {}
  }

  var _lastSoundTime = 0;
  function tryPlayModelSound() {
    if (appState && appState.config && appState.config.soundEnabled === false) return;
    var now = Date.now();
    if (now - _lastSoundTime < 800) return;
    _lastSoundTime = now;
    try {
      var modelDir = loadedModelId || 'rem';
      var base = '../../user-data/models/' + modelDir + '/sounds/';
      var sounds = [base + 'haru_normal_01.mp3', base + 'haru_normal_02.mp3', base + 'haru_normal_03.mp3'];
      var pick = sounds[Math.floor(Math.random() * sounds.length)];
      var audio = new Audio(pick);
      audio.volume = 0.4;
      audio.play().catch(function() {});
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
      playLive2dMotion(motion, 0);
    }
    statusMotionKind = kind;

    if (!statusMotionTimer && (kind === "thinking" || kind === "waiting-permission" || kind === "waiting-input")) {
      statusMotionTimer = setInterval(() => playLive2dMotion("flick_head", 1), 2500);
    }
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
        playLive2dMotion("flick_head", 0);
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
