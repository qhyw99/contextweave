# Request
```json
{
  "base_path": "d:\\chainweaver\\mira-overlay-gateway",
  "links": [
    { "targets": ["test_layer", "test_layer.test1", "test_layer.test2", "test_layer.test3", "test_layer.test4"], "link": "./t/ca_update.t" },
    { "targets": ["entry_layer.external", "entry_layer.proxy_pass"], "link": "./t/ca_update.t" },
    { "targets": ["entry_layer.overlay_internal"], "link": "./nginx/sewer/nginx.conf#L64-L70" },
    { "targets": ["entry_layer.lua_func"], "link": "./lua/src/ca.lua#L41" },
    { "targets": ["impl_layer.write_file"], "link": "./lua/src/ca.lua#L50-L59" },
    { "targets": ["impl_layer.reload_cmds"], "link": "./lua/src/ca.lua#L61-L96" },
    { "targets": ["effect_layer.new_config"], "link": "./nginx/sewer/nginx.conf#L42" },
    { "targets": ["effect_layer.business_flow.httpclient"], "link": "./lua/src/httpclient.lua#L120-L205" }
  ]
}
```

# CW
```cw
direction: down

# Root style
style: {
  fill: "#fafafa"
  stroke: "#ddd"
}

title: Mira Overlay Gateway - CA 证书平滑加载架构流程 {
  shape: text
  style.font-size: 28
  style.bold: true
  style.fill: "#2c3e50"
  style.font-color: "#FFFFFF"
}

# ============================================
# 第 1 层：测试层 (Test Layer)
# ============================================
test_layer: 测试层 (Test Layer) {
  direction: right

  test1: "Test1\n更新前验证" {
    style.fill: "#e74c3c"
    style.stroke-width: 2
    style.font-color: "#000000"
  }

  test2: "Test2\n调用更新接口" {
    style.fill: "#f39c12"
    style.stroke-width: 2
    style.font-color: "#000000"
  }

  test3: "Test3\n更新后验证" {
    style.fill: "#27ae60"
    style.stroke-width: 2
    style.font-color: "#000000"
  }

  test4: "Test4\n慢请求保护" {
    style.fill: "#3498db"
    style.stroke-width: 2
    style.font-color: "#000000"
  }

  # 测试说明
  test_notes: |md
    ## 测试验证点
    - Test1: 不可信上游证书 → TLS 校验失败 ✓
    - Test2: POST /ca/update → 返回成功 ✓
    - Test3: 新证书 → TLS 校验通过 ✓
    - Test4: reload 期间慢请求不被打断 ✓
  |
  style.fill: "#ecf0f1"
  style.border-radius: 8
  style.font-color: "#000000"
}

# ============================================
# 第 2 层：入口层 (Entry Layer)
# ============================================
entry_layer: 入口层 (Entry Layer) {
  direction: down

  external: "外部请求/测试工具" {
    style.fill: "#95a5a6"
    style.font-color: "#000000"
  }

  proxy_pass: "proxy_pass 转发" {
    shape: hexagon
    style.fill: "#bdc3c7"
    style.font-color: "#000000"
  }

  overlay_internal: "/internal/ca/update" {
    style.fill: "#e67e22"
    style.stroke-width: 3
    style.stroke: "#d35400"
    tooltip: "Overlay 加载 CA 的关键接口"
    style.font-color: "#000000"
  }

  lua_entry: "Nginx 路由到 Lua" {
    shape: parallelogram
    style.fill: "#34495e"
    style.font-color: "#FFFFFF"
  }

  lua_func: "ca.update_ca()" {
    style.fill: "#2c3e50"
    style.font-color: white
  }

  # 连接
  external -> proxy_pass: HTTP Request
  proxy_pass -> overlay_internal: 转发
  overlay_internal -> lua_entry: Nginx 路由
  lua_entry -> lua_func: 调用
  overlay_internal 2.note: |md
    🔥 **关键接口**
    所有 CA 证书更新必须经过此接口
  |
}

# ============================================
# 第 3 层：实现层 (Implementation Layer)
# ============================================
impl_layer: 实现层 (Implementation Layer) {
  direction: right

  read_body: "读取请求体\n新证书内容" {
    style.fill: "#9b59b6"
    style.font-color: "#FFFFFF"
  }

  write_file: "写入磁盘文件\n/etc/nginx/ssl/ca.crt" {
    style.fill: "#8e44ad"
    style.font-color: "#FFFFFF"
  }

  read_pid: "读取 nginx.pid" {
    style.fill: "#1abc9c"
    style.font-color: "#000000"
  }

  reload_cmds: "尝试执行 reload 命令" {
    direction: down
    cmd1: "kill -HUP"
    cmd2: "openresty -s reload"
    cmd3: "nginx -s reload"
    style.fill: "#16a085"
    style.font-color: "#000000"
  }

  log_file: "记录日志\n/tmp/ca-reload.log" {
    style.fill: "#f1c40f"
    style.font-color: "#000000"
  }

  wait_return: "等待 2 秒后返回" {
    style.fill: "#2ecc71"
    style.font-color: "#000000"
  }

  # 连接
  read_body -> write_file
  write_file -> read_pid
  read_pid -> reload_cmds
  reload_cmds -> log_file
  log_file -> wait_return
}

# ============================================
# 第 4 层：生效层 (Effect Layer)
# ============================================
effect_layer: 生效层 (Effect Layer) {
  direction: down

  reload_trigger: "OpenResty reload 机制触发" {
    style.fill: "#e74c3c"
    style.stroke-width: 2
    style.font-color: "#000000"
  }

  old_worker: "旧 Worker 进程" {
    style.fill: "#3498db"
    style.opacity: 0.7
    style.font-color: "#000000"
  }

  new_worker: "新 Worker 进程" {
    style.fill: "#2ecc71"
    style.opacity: 0.7
    style.font-color: "#000000"
  }

  old_conn: "处理旧连接\n(不中断)" {
    style.fill: "#3498db"
    style.font-color: "#000000"
  }

  new_config: "加载新 CA 配置\n(lua_ssl_trusted_certificate)" {
    style.fill: "#2ecc71"
    style.font-color: "#000000"
  }

  business_flow: "后续业务请求" {
    direction: right
    sewer: "sewer/elevator 路由"
    httpclient: "httpclient TLS 连接"
    new_cert: "使用新证书"
  }

  # 连接
  reload_trigger -> old_worker
  reload_trigger -> new_worker
  old_worker -> old_conn
  new_worker -> new_config
  old_conn -> business_flow.sewer
  new_config -> business_flow.httpclient
  business_flow.(sewer -> httpclient)
  business_flow.(httpclient -> new_cert)
}

# ============================================
# 关键结论框 (Highlighted Conclusion)
# ============================================
conclusion: |md
  ## 🎯 核心结论

  **这是 Graceful Reload 平滑重启，而非进程内热替换！**

  - ✅ 旧 Worker 继续处理旧连接（保证不中断）
  - ✅ 新 Worker 启动并加载新的 CA 配置
  - ✅ 零停机时间，业务无感知
  - ❌ 不是内存中直接替换证书

  这种设计确保了在 CA 证书更新过程中，正在进行的慢请求不会被强制中断。
|
style: {
  fill: "#fff3cd"
  stroke: "#ffc107"
  stroke-width: 3
  border-radius: 12
  shadow: true
  font-size: 16
  bold: true
}

# ============================================
# 跨层连接
# ============================================
test_layer.test2 -> entry_layer.external: 发起更新请求
entry_layer.lua_func -> impl_layer.read_body: 开始执行
impl_layer.wait_return -> effect_layer.reload_trigger: reload 完成
effect_layer.business_flow.new_cert -> test_layer.test3: 验证通过

# ============================================
# 高亮标注
# ============================================

style.fill: "#ffeb3b"
style.stroke: "#f57f17"
style.stroke-width: 2

# ============================================
# 图例说明
# ============================================
legend: |md
  ## 图例
  - 🔴 红色：失败/异常路径
  - 🟡 黄色：警告/注意
  - 🟢 绿色：成功/正常路径
  - 🔵 蓝色：常规操作
  - 🟠 橙色：关键接口
|
style.fill: "#f8f9fa"
style.stroke: "#dee2e6"
style.border-radius: 8
```