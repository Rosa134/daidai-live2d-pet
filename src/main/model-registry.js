const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { readJson, writeJson } = require("./config-store");

const MODEL_FILE_PATTERNS = [".model3.json", ".model.json"];

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function safeId(input) {
  const ascii = String(input || "model")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return ascii || `model-${Date.now()}`;
}

function walkFiles(dir, depth = 0, maxDepth = 4) {
  if (depth > maxDepth) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(full, depth + 1, maxDepth));
    } else {
      files.push(full);
    }
  }
  return files;
}

function findLive2dModelFile(dir) {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    throw new Error(`Model directory does not exist: ${dir}`);
  }

  const rootFiles = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(dir, entry.name));
  const allFiles = [...rootFiles, ...walkFiles(dir).filter((file) => !rootFiles.includes(file))];

  for (const suffix of MODEL_FILE_PATTERNS) {
    const match = allFiles.find((file) => file.toLowerCase().endsWith(suffix));
    if (match) return match;
  }
  throw new Error("No Live2D .model.json or .model3.json file found");
}

function modelKindFromFile(modelFile) {
  return modelFile.toLowerCase().endsWith(".model3.json") ? "cubism3+" : "cubism2";
}

function normalizeModelRecord(record) {
  const modelPath = path.resolve(record.modelPath);
  const directory = path.resolve(record.directory || path.dirname(modelPath));
  return {
    id: record.id,
    name: record.name || record.id,
    source: record.source || "user",
    kind: record.kind || modelKindFromFile(modelPath),
    directory,
    modelPath,
    modelUrl: pathToFileURL(modelPath).href,
    importedAt: record.importedAt || new Date().toISOString()
  };
}

function copyDirectory(source, target) {
  ensureDir(path.dirname(target));
  fs.rmSync(target, { recursive: true, force: true });
  fs.cpSync(source, target, { recursive: true });
}

function createModelRegistry({ userDataDir, bundledModelsDir }) {
  const modelsDir = path.join(userDataDir, "models");
  const registryFile = path.join(userDataDir, "models.json");

  function loadRegistry() {
    return readJson(registryFile, { models: [] });
  }

  function saveRegistry(models) {
    writeJson(registryFile, { models: models.map(normalizeModelRecord) });
  }

  function listBundledModels() {
    if (!bundledModelsDir || !fs.existsSync(bundledModelsDir)) return [];
    return fs
      .readdirSync(bundledModelsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => {
        const directory = path.join(bundledModelsDir, entry.name);
        try {
          const modelPath = findLive2dModelFile(directory);
          return normalizeModelRecord({
            id: `bundled-${safeId(entry.name)}`,
            name: entry.name,
            source: "bundled",
            directory,
            modelPath
          });
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  }

  return {
    modelsDir,
    registryFile,
    list() {
      const userModels = loadRegistry().models.map(normalizeModelRecord);
      const bundled = listBundledModels();
      // 去重：已被用户导入的模型不再显示为 bundled
      const userNames = new Set(userModels.map(function(m){ return m.name }));
      const filteredBundled = bundled.filter(function(m){ return !userNames.has(m.name) });
      return [...filteredBundled, ...userModels].sort(function(a, b){ return a.name.localeCompare(b.name) });
    },
    get(id) {
      return this.list().find((model) => model.id === id) || null;
    },
    importDirectory(sourceDir) {
      const sourceModelFile = findLive2dModelFile(sourceDir);
      const baseId = safeId(path.basename(sourceDir));
      let id = baseId;
      const existingIds = new Set(this.list().map((model) => model.id));
      let index = 2;
      while (existingIds.has(id)) {
        id = `${baseId}-${index}`;
        index += 1;
      }

      const targetDir = path.join(modelsDir, id);
      copyDirectory(sourceDir, targetDir);
      const relativeModel = path.relative(sourceDir, sourceModelFile);
      const modelPath = path.join(targetDir, relativeModel);
      const record = normalizeModelRecord({
        id,
        name: path.basename(sourceDir),
        source: "user",
        directory: targetDir,
        modelPath
      });

      const registry = loadRegistry();
      saveRegistry([...registry.models.filter((model) => model.id !== id), record]);
      return record;
    },
    openDirectoryPath() {
      ensureDir(modelsDir);
      return modelsDir;
    }
  };
}

module.exports = {
  createModelRegistry,
  findLive2dModelFile,
  modelKindFromFile,
  normalizeModelRecord,
  safeId
};
