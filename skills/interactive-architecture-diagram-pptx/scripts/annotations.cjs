const fs = require("fs");
const path = require("path");

function normalizeAnnotations(value) {
  if (Array.isArray(value) && value.length === 0) value = { version: 1, items: [] };
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).sort().join(",") !== "items,version" || value.version !== 1 ||
      !Array.isArray(value.items) || value.items.length > 128) throw Error("annotations requires version:1 and at most 128 items");
  const seen = new Set();
  const items = value.items.map(item => {
    if (!item || typeof item !== "object" || Array.isArray(item) ||
        Object.keys(item).some(k => !["id", "text", "view"].includes(k)) ||
        typeof item.id !== "string" || !/^[A-Za-z_][A-Za-z_0-9-]{0,95}$/.test(item.id) || seen.has(item.id) ||
        typeof item.text !== "string" || !item.text.trim() || [...item.text].length > 20000 ||
        /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(item.text) ||
        (item.view !== undefined && (typeof item.view !== "string" || [...item.view].length > 128 || /[\x00-\x1f]/.test(item.view)))) {
      throw Error("Each annotation requires a unique stable id and complete nonempty text; only optional view is supported");
    }
    seen.add(item.id);
    return { id: item.id, text: item.text, ...(item.view ? { view: item.view } : {}) };
  });
  const result = { version: 1, items };
  if (Buffer.byteLength(JSON.stringify(result)) > 250000) throw Error("annotations exceeds 250000 bytes");
  return result;
}

function unsupported(capabilities) {
  if (capabilities?.status === "error") return capabilities;
  return capabilities?.annotations?.versions?.includes(1) ? null :
    { status: "error", error: { code: "ANNOTATIONS_UNSUPPORTED", message: "后端未声明结构化备注 v1 能力；升级服务后重试，不把备注改成普通容器或丢弃。" } };
}

async function prepareAnnotations(client, filename, payload) {
  if (!filename) return null;
  try {
    if (!path.isAbsolute(filename)) throw Error("annotations_file 必须是绝对路径");
    const resolved = fs.realpathSync(filename);
    const relative = path.relative(fs.realpathSync(process.cwd()), resolved);
    if (relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative)) throw Error("annotations_file 必须位于工作区内");
    const stat = fs.statSync(resolved);
    if (!stat.isFile() || stat.size > 250000) throw Error("annotations_file 必须是至多 250000 bytes 的普通文件");
    payload.annotations = normalizeAnnotations(JSON.parse(fs.readFileSync(resolved, "utf8").replace(/^\uFEFF/, "")));
  } catch (error) {
    return { status: "error", error: { code: "INVALID_ANNOTATIONS", message: String(error.message) } };
  }
  return unsupported(await client.getCapabilities());
}

function validateAnnotationsResult(result, requested) {
  const hasArtifact = result?.artifacts?.length || result?.exports?.length || result?.svg_url || result?.html_url || result?.svg_content || result?.html_content;
  if (!requested || result?.annotations_version === 1 || (result?.status === "error" && !hasArtifact)) return result;
  return { ...result, status: "error", error: { code: "ANNOTATIONS_UNSUPPORTED", message: "服务未确认备注版本；保留已有产物供检查，不能视为备注交付成功。" } };
}

module.exports = { normalizeAnnotations, prepareAnnotations, unsupported, validateAnnotationsResult };
