const fs = require("fs");
const { TextDecoder } = require("util");

class CwSourceError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function lineAt(text, start) {
  let end = start;
  while (end < text.length && text[end] !== "\n" && text[end] !== "\r") end += 1;
  let next = end;
  if (text[next] === "\r" && text[next + 1] === "\n") next += 2;
  else if (next < text.length) next += 1;
  return { start, end, next, text: text.slice(start, end) };
}

function cwHeading(text) {
  return /^ {0,3}# CW[ \t]*(?:\r\n|\n|\r|$)/m.exec(text);
}

function parseGenerationInput(content) {
  const heading = cwHeading(content);
  if (!heading) return { userRequest: content.trim(), initialCwCode: "", hasCwSource: false };

  const requestPart = content.slice(0, heading.index);
  const requestHeading = /^ {0,3}# Request[ \t]*(?:\r\n|\n|\r|$)/m.exec(requestPart);
  const userRequest = (requestHeading ? requestPart.slice(requestHeading.index + requestHeading[0].length) : requestPart).trim();
  const cwPart = content.slice(heading.index + heading[0].length);
  let first = lineAt(cwPart, 0);
  let opening = /^ {0,3}(`{3,})[ \t]*cw[ \t]*$/.exec(first.text);
  while (!opening && !first.text.trim() && first.next < cwPart.length) {
    first = lineAt(cwPart, first.next);
    opening = /^ {0,3}(`{3,})[ \t]*cw[ \t]*$/.exec(first.text);
  }
  if (!opening) {
    if (cwHeading(cwPart)) throw new CwSourceError("CW_SOURCE_CONFLICT", "输入文件包含多份 CW 源；请只保留一份，或使用 --cw_source_file");
    return { userRequest, initialCwCode: cwPart, hasCwSource: true };
  }

  let cursor = first.next;
  while (cursor <= cwPart.length) {
    const line = lineAt(cwPart, cursor);
    const closing = /^ {0,3}(`{3,})[ \t]*$/.exec(line.text);
    if (closing && closing[1].length >= opening[1].length) {
      const trailing = cwPart.slice(line.next);
      if (cwHeading(trailing) || /^ {0,3}`{3,}[ \t]*cw[ \t]*(?:\r\n|\n|\r|$)/m.test(trailing)) {
        throw new CwSourceError("CW_SOURCE_CONFLICT", "输入文件包含多份 CW 源；请只保留一份，或使用 --cw_source_file");
      }
      if (trailing.trim()) throw new CwSourceError("CW_TRAILING_CONTENT", "CW 闭围栏后存在无法识别的内容");
      return { userRequest, initialCwCode: cwPart.slice(first.next, line.start), hasCwSource: true };
    }
    if (line.next === cursor) break;
    cursor = line.next;
    if (cursor === cwPart.length) {
      const last = lineAt(cwPart, cursor);
      if (last.start === last.end && last.next === last.end) break;
    }
  }
  throw new CwSourceError("CW_FENCE_UNCLOSED", "CW 开围栏没有匹配的闭围栏；未提交请求");
}

function readExactCwSource(client, filename) {
  const pathError = client.validateSafePath(filename);
  if (pathError) return { error: pathError };
  let bytes;
  try {
    if (!fs.statSync(filename).isFile()) return { error: client.error("CW_SOURCE_NOT_REGULAR", "cw_source_file 必须是普通文件") };
    bytes = fs.readFileSync(filename);
  } catch (error) {
    return { error: client.error("CW_SOURCE_READ_ERROR", `无法读取 cw_source_file：${String(error.message || error)}`) };
  }
  try {
    return { source: new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes) };
  } catch (_) {
    return { error: client.error("CW_SOURCE_INVALID_UTF8", "cw_source_file 必须是合法 UTF-8；未提交请求") };
  }
}

module.exports = { CwSourceError, parseGenerationInput, readExactCwSource };
