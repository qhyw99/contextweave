# ContextWeave Workbuddy Skill 修改计划

## 1. 当前状态分析
在 `interactive-architecture-diagram-workbuddy` skill 中，公共逻辑主要位于 `scripts/cw_client.cjs`。
目前 `normalizeAssetResult` 仅仅删除了无用字段，但如果后端返回的 `svg_url` 是 HTML 包裹页面的链接（即后缀为 `.html`），这会导致后续输出的 JSON 和下载的资源类型不符合预期（本该是纯 SVG 的却拿到了 HTML）。
同样，在 `downloadAssetsLocally` 方法中，获取下载链接时没有将 HTML 的后缀转为 SVG，导致有可能直接下载成 `.html` 文件。

## 2. 变更目标与方案
用户的目标是在 `cw_client.cjs` 中加入正则兜底逻辑，强制将 `.html` 后缀的链接替换为 `.svg`，从而保证打印的 JSON 和下载的文件始终是正确的 SVG 格式。

具体修改点如下（均在 `\data\appdata\infographic-contextweave\skills\interactive-architecture-diagram-workbuddy\scripts\cw_client.cjs` 中）：

1. **修改 `normalizeAssetResult` 函数**：
   在删除冗余字段之前或之后，添加针对 `svg_url` 的处理逻辑：
   ```javascript
   if (result.svg_url && typeof result.svg_url === "string") {
     result.svg_url = result.svg_url.replace(/\.html(\?.*)?$/, '.svg$1');
   }
   ```

2. **修改 `downloadAssetsLocally` 函数**：
   在获取到 `svgUrl` 后、执行下载之前，加入相同的正则替换：
   ```javascript
   let svgUrl = result.raw_svg_url || result.svg_url;
   if (svgUrl && svgUrl !== "WAITING_FOR_EXPERT_PROCESSING") {
     // 强制将 html 后缀替换为 svg
     svgUrl = svgUrl.replace(/\.html(\?.*)?$/, '.svg$1');
     const ext = ".svg";
     const dest = path.join(targetDir, `${outputName}${ext}`);
     // ... 原有下载逻辑
   }
   ```

## 3. 验证步骤
1. 编辑完 `cw_client.cjs` 之后，检查代码是否存在语法错误。
2. （可选）执行一个带有模拟返回值的本地简单测试或通过 Review 代码确认正则 `.replace(/\.html(\?.*)?$/, '.svg$1')` 能够正确处理带有 query 参数的 URL 以及普通 URL。