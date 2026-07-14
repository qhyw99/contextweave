# session_id: 3e0bad80-b20f-48ff-bfc3-3a16ed5146bb
# session_id: ed8c3340-d270-47bb-8467-58ea6a536804
direction: right

# ============================================================
# Title
# ============================================================
title: D2 Failure & Auto-Repair – Full Semantic Flow {
  shape: text
  style.font-size: 32
  style.bold: true
}

# ============================================================
# 1. TOP-LEVEL ENTRY
# ============================================================
user_request: "User Request\n(Git diff / PR content)" {
  style.fill: "#E3F2FD"
  style.stroke: "#1565C0"
  style.font-color: "#1565C0"
}

interleaved_thinking: "Interleaved-Thinking\n(Context enrichment)" {
  style.fill: "#E8F5E9"
  style.stroke: "#2E7D32"
  style.font-color: "#2E7D32"
}

executor: "AiderBridge /\nD2LintLoopExecutor" {
  shape: hexagon
  style.fill: "#FFF3E0"
  style.stroke: "#E65100"
  style.font-color: "#E65100"
  tooltip: "Entry point: decides dispatch path"
}

path_decision: "Dispatch Decision:\nWhich path to take?" {
  shape: diamond
  style.fill: "#F3E5F5"
  style.stroke: "#6A1B9A"
  style.font-color: "#6A1B9A"
}

# ============================================================
# 2. UPSTREAM RETRY LOOP: d2_lint_loop
# ============================================================
d2_lint_loop: "d2_lint_loop\n(Upstream Retry Loop – 3 rounds)" {
  direction: down
  style.fill: "#F3E5F5"
  style.stroke: "#6A1B9A"
  style.font-color: "#6A1B9A"
  style.border-radius: 8

  # --- Round 1 ---
  round1_label: "Round 1: Initial D2 generation" {
    style.fill: "#EDE7F6"
    style.stroke: "#4527A0"
    style.font-size: 14
  }

  round1_submit: "Submit D2 to validation\n(lint / compile)" {
    style.fill: "#EDE7F6"
    style.stroke: "#4527A0"
  }

  round1_error: "LAYOUT_GATE_ERROR returned" {
    style.fill: "#FFEBEE"
    style.stroke: "#C62828"
    style.font-color: "#C62828"
  }

  error_report_1: "Error report:\n• SandboxRouter: 6 connections > 3 limit\n• SandboxClient: 4 connections > 3 limit" {
    shape: square
    style.fill: "#FFF9C4"
    style.stroke: "#F9A825"
    style.font-color: "#F9A825"
  }

  llm_decides_1: "LLM analyzes error report\nDecides: delete edges to\nreduce connection counts" {
    style.fill: "#E0F7FA"
    style.stroke: "#006064"
    style.font-color: "#006064"
  }

  # --- Round 2 ---
  round2_label: "Round 2: Edge deletion attempt" {
    style.fill: "#EDE7F6"
    style.stroke: "#4527A0"
    style.font-size: 14
  }

  round2_delete: "Delete 3 channel→router edges\nWrite channel info into tooltips" {
    style.fill: "#EDE7F6"
    style.stroke: "#4527A0"
  }

  round2_submit: "Submit modified D2 to validation" {
    style.fill: "#EDE7F6"
    style.stroke: "#4527A0"
  }

  round2_error: "Still fails:\nSandboxClient still has 4 connections\n(config→SandboxClient not deleted)" {
    style.fill: "#FFEBEE"
    style.stroke: "#C62828"
    style.font-color: "#C62828"
  }

  error_report_2: "Error report:\nSandboxClient: 4 connections > 3 limit" {
    shape: square
    style.fill: "#FFF9C4"
    style.stroke: "#F9A825"
    style.font-color: "#F9A825"
  }

  llm_decides_2: "LLM decides:\nDelete config→SandboxClient edge\nModify tooltip to retain info" {
    style.fill: "#E0F7FA"
    style.stroke: "#006064"
    style.font-color: "#006064"
  }

  # --- Round 3 ---
  round3_label: "Round 3: SEARCH/REPLACE attempt" {
    style.fill: "#EDE7F6"
    style.stroke: "#4527A0"
    style.font-size: 14
  }

  round3_attempt: "Apply SEARCH/REPLACE block\nto delete config→SandboxClient\nand update tooltip" {
    style.fill: "#EDE7F6"
    style.stroke: "#4527A0"
  }

  round3_not_applied: "SEARCH/REPLACE block\nnot applied to file\n(file content unchanged)" {
    style.fill: "#FFEBEE"
    style.stroke: "#C62828"
    style.font-color: "#C62828"
  }

  # --- Final ---
  write_failed_log: "Write run_failed.log\nTerminate retry loop" {
    shape: cylinder
    style.fill: "#FFEBEE"
    style.stroke: "#B71C1C"
    style.font-color: "#B71C1C"
    tooltip: "Writes aider_xxx.d2 (final unchanged), run.log (3 rounds), run_failed.log (termination)"
  }

  # --- temp_gen artifacts ---
  temp_gen: "temp_gen/ artifacts" {
    style.fill: "#E0F7FA"
    style.stroke: "#006064"
    style.font-color: "#006064"
    style.border-radius: 6

    aider_file: "aider_xxx.d2\n(final unchanged content)" {
      style.fill: "#B2EBF2"
      style.stroke: "#00838F"
    }
    run_log: "run.log\n(3 rounds of attempt)" {
      style.fill: "#B2EBF2"
      style.stroke: "#00838F"
    }
    run_failed_log_file: "run_failed.log\n(termination signal)" {
      style.fill: "#FFCDD2"
      style.stroke: "#C62828"
      style.font-color: "#C62828"
    }
  }

  # --- Connections inside d2_lint_loop ---
  round1_label -> round1_submit
  round1_submit -> round1_error: "Compile / lint returns error"
  round1_error -> error_report_1: "Wrap into error report"
  error_report_1 -> llm_decides_1: "LLM receives report"
  llm_decides_1 -> round2_label: "Round 2 starts"
  round2_label -> round2_delete
  round2_delete -> round2_submit: "Submit modified D2"
  round2_submit -> round2_error: "Still fails"
  round2_error -> error_report_2: "Wrap into error report"
  error_report_2 -> llm_decides_2: "LLM receives report"
  llm_decides_2 -> round3_label: "Round 3 starts"
  round3_label -> round3_attempt
  round3_attempt -> round3_not_applied
  round3_not_applied -> write_failed_log
}

# ============================================================
# 3. DOWNSTREAM VALIDATION GATE (shared)
# ============================================================
extract_zone: "extract-d2 / extract-d2-zone\n(Downstream Path)" {
  direction: down
  style.fill: "#E0F2F1"
  style.stroke: "#004D40"
  style.font-color: "#004D40"
  style.border-radius: 8

  normalize: "NormalizeBlockStrings" {
    style.fill: "#E0F2F1"
    style.stroke: "#004D40"
  }

  validation_gate: "Validation Gate" {
    shape: rectangle
    style.fill: "#FFF3E0"
    style.stroke: "#E65100"
    style.font-color: "#E65100"
    style.border-radius: 8

    layout_gate: "LayoutGate:\nCheck spider-web connections,\nedge density, layout rules" {
      style.fill: "#FFF8E1"
      style.stroke: "#F57F17"
      style.font-color: "#F57F17"
    }

    structure_drift: "StructureDrift:\nCheck layout_lock alignment,\ngrid backbone, mandatory\ncontainers" {
      style.fill: "#FFF8E1"
      style.stroke: "#F57F17"
      style.font-color: "#F57F17"
    }
  }

  classify_decision: "Classify validation result:\nSoft Warning vs Blocking Error?" {
    shape: diamond
    style.fill: "#FCE4EC"
    style.stroke: "#880E4F"
    style.font-color: "#880E4F"
    tooltip: "Receives results from LayoutGate and StructureDrift"
  }

  soft_warning: "Soft Warning:\nD2 compilable, only\nLAYOUT_GATE_ERROR etc.\n→ Proceed to auto-fix" {
    style.fill: "#C8E6C9"
    style.stroke: "#1B5E20"
    style.font-color: "#1B5E20"
  }

  blocking_error: "Blocking Error:\nStructure drift, syntax,\nunresolvable layout\n→ Return error, stop" {
    style.fill: "#FFCDD2"
    style.stroke: "#B71C1C"
    style.font-color: "#B71C1C"
  }

  # Connections inside extract zone
  normalize -> validation_gate: "Normalized D2 text"
  validation_gate -> classify_decision: "Results from both checks"
  classify_decision -> soft_warning: "Non-blocking"
  classify_decision -> blocking_error: "Blocking"
}

# ============================================================
# 4. DOWNSTREAM AUTO-FIX CHAIN
# ============================================================
auto_fix_chain: "Auto-Fix Chain\n(Local, mechanical, deterministic)" {
  direction: down
  style.fill: "#E8F5E9"
  style.stroke: "#2E7D32"
  style.font-color: "#2E7D32"
  style.border-radius: 8

  pre_fix_compile: "Pre-fix:\nCompileWithErrorCleanup" {
    style.fill: "#C8E6C9"
    style.stroke: "#1B5E20"
    style.font-color: "#1B5E20"
  }

  three_stage: "RunThreeStageAutoFixForExtract" {
    style.fill: "#C8E6C9"
    style.stroke: "#1B5E20"
    style.font-color: "#1B5E20"
    style.bold: true
  }

  fix_connection_paths: "Step 1:\nAutoFixConnectionPathsForExtract\n(short path completion)" {
    style.fill: "#A5D6A7"
    style.stroke: "#1B5E20"
  }

  fix_nesting: "Step 2:\nNodeNesting\n(nest orphan nodes into containers)" {
    style.fill: "#A5D6A7"
    style.stroke: "#1B5E20"
  }

  fix_prefix_merge: "Step 3:\nPrefixMerge\n(merge duplicated prefixes)" {
    style.fill: "#A5D6A7"
    style.stroke: "#1B5E20"
  }

  fix_shape_normalize: "Step 4:\nShapeNormalize\n(normalize shape types)" {
    style.fill: "#A5D6A7"
    style.stroke: "#1B5E20"
  }

  post_fix_compile: "Post-fix:\nCompileWithErrorCleanup" {
    style.fill: "#C8E6C9"
    style.stroke: "#1B5E20"
    style.font-color: "#1B5E20"
  }

  final_render: "Final Render / Export" {
    shape: parallelogram
    style.fill: "#C8E6C9"
    style.stroke: "#1B5E20"
    style.font-color: "#1B5E20"
    style.bold: true
  }

  # Connections inside auto-fix chain
  pre_fix_compile -> three_stage: "Passes compile"
  three_stage -> fix_connection_paths: "Stage 1"
  fix_connection_paths -> fix_nesting: "Stage 2"
  fix_nesting -> fix_prefix_merge: "Stage 3"
  fix_prefix_merge -> fix_shape_normalize: "Stage 4"
  fix_shape_normalize -> post_fix_compile: "All stages applied"
  post_fix_compile -> final_render: "Compile success"
}

# ============================================================
# 5. LLM vs AUTOFIX RESPONSIBILITY DEMARCATION
# ============================================================
responsibility_note: |`md
  **职责分工**

  **LLM (上游重试环) 负责：**
  - 决定删哪条边、哪些关系改用 tooltip
  - 如何收敛成正确的布局风格
  - 如何保住分区骨架和 mandatory containers
  - 全局结构设计 + 语义级修改

  **Auto-fix (下游确定性修复) 负责：**
  - 短路径补全（相对路径→绝对路径）
  - 节点嵌套（orphan node 放入容器）
  - Prefix merge（重复前缀合并）
  - 形状归一化（shape normalisation）
  - 这些是**局部、机械、确定性**修复
  - 不替代 LLM 做全局结构设计
`| {
  style.fill: "#F1F8E9"
  style.stroke: "#558B2F"
  style.font-color: "#558B2F"
}

# ============================================================
# 6. d2lib BYPASS CHAIN
# ============================================================
d2lib: "d2lib Direct Compile\n(Bypass Path)" {
  direction: down
  style.fill: "#FCE4EC"
  style.stroke: "#880E4F"
  style.font-color: "#880E4F"

  direct_read: "Read D2 file directly" {
    style.fill: "#F8BBD0"
    style.stroke: "#880E4F"
    style.font-color: "#880E4F"
  }

  direct_compile: "Compile & Export\n(no validation gate,\nno auto-fix)" {
    shape: parallelogram
    style.fill: "#F8BBD0"
    style.stroke: "#880E4F"
    style.font-color: "#880E4F"
  }

  bypass_output: "Bypass Output\n(suitable for stable files\nor emergency export)" {
    style.fill: "#F8BBD0"
    style.stroke: "#880E4F"
    style.font-color: "#880E4F"
  }

  direct_read -> direct_compile: "skips all validation"
  direct_compile -> bypass_output
}

# ============================================================
# 7. CROSS-CHAIN CONNECTIONS (semantic flow)
# ============================================================
user_request -> interleaved_thinking: "Send request"
interleaved_thinking -> executor: "Enriched context"
executor -> path_decision: "Decide dispatch"

# Path A: retry loop
path_decision -> d2_lint_loop.round1_label: "Path A:\nTry d2_lint_loop\nretry edit loop"

# After failure, attempt downstream
d2_lint_loop.write_failed_log -> extract_zone.normalize: "Failure captured\n(attempt to enter\nextract-d2 zone)" {
  style.stroke: "#004D40"
  style.stroke-dash: 3
}

# Extract zone -> auto-fix
extract_zone.soft_warning -> auto_fix_chain.pre_fix_compile: "Soft warning:\nproceed to auto-fix"

# Blocking error returns
extract_zone.blocking_error -> d2_lint_loop.write_failed_log: "Blocking error:\nterminate" {
  style.stroke: "#B71C1C"
  style.stroke-dash: 3
}

# Path B: bypass
path_decision -> d2lib.direct_read: "Path B:\nDirect compile bypass\n(stable files only)"

# Responsibility note connects to both chains
responsibility_note -> d2_lint_loop: "LLM handles structural decisions here" {
  style.stroke: "#558B2F"
  style.stroke-dash: 5
}
responsibility_note -> auto_fix_chain: "Auto-fix handles local mechanical fixes here" {
  style.stroke: "#558B2F"
  style.stroke-dash: 5
}

# ============================================================
# 8. KEY INSIGHT NODES
# ============================================================
insight_failure: |`md
  **核心洞察：为什么这次失败没有进入 extract auto-fix？**

  1. d2_lint_loop 重试 3 轮后最终写入 run_failed.log
  2. 理论上失败后应进入 extract-d2 下游链
  3. 但真实样本中第 3 轮 SEARCH/REPLACE 未应用，文件内容不变
  4. 上游直接终止，没有触发下游入口
  5. 如果第 3 轮成功进入 extract-d2 链，还需经过：
     - Validation Gate 的 LayoutGate + StructureDrift 并行检查
     - 分类决策：必须是 soft warning 才能放行
     - 如果是 blocking error，仍然回退终止
  6. 结论：**失败发生在安全网之外**——上游重试耗尽后未进入下游验证链
`| {
  style.fill: "#FFF9C4"
  style.stroke: "#F9A825"
  style.font-color: "#F9A825"
}

# ============================================================
# 9. SCENARIOS
# ============================================================

scenarios: {
  Base: {
    title.label: "Base – Full Panorama"
    # No overrides, show everything
  }

  RealFailure: {
    title.label: "Real Failure Sample – Failure in Upstream Retry Loop"

    # Dim extract zone and auto-fix (never reached)
    extract_zone.style.opacity: 0.2
    auto_fix_chain.style.opacity: 0.2
    d2lib.style.opacity: 0.2

    # Highlight the failure path in d2_lint_loop
    d2_lint_loop.round1_error.style: {stroke: red; stroke-width: 4}
    d2_lint_loop.error_report_1.style: {stroke: red; stroke-width: 4}
    d2_lint_loop.llm_decides_1.style: {stroke: red; stroke-width: 4}
    d2_lint_loop.round2_error.style: {stroke: red; stroke-width: 4}
    d2_lint_loop.error_report_2.style: {stroke: red; stroke-width: 4}
    d2_lint_loop.llm_decides_2.style: {stroke: red; stroke-width: 4}
    d2_lint_loop.round3_not_applied.style: {stroke: red; stroke-width: 4}
    d2_lint_loop.write_failed_log.style: {stroke: red; stroke-width: 4}
    d2_lint_loop.run_failed_log_file.style: {stroke: red; stroke-width: 4}

    # Highlight failure connections

    # Highlight the insight
    insight_failure.style: {stroke: red; stroke-width: 2}
  }

  ValidationInternals: {
    title.label: "Validation Internals – Parallel Checks"

    # Dim retry loop and auto-fix
    d2_lint_loop.style.opacity: 0.15
    auto_fix_chain.style.opacity: 0.15
    d2lib.style.opacity: 0.15

    # Highlight extract zone
    extract_zone.style: {stroke: "#004D40"; stroke-width: 4}
    extract_zone.normalize.style: {stroke: "#004D40"; stroke-width: 4}
    extract_zone.validation_gate.style: {stroke: "#E65100"; stroke-width: 4}
    extract_zone.layout_gate.style: {stroke: "#F57F17"; stroke-width: 4}
    extract_zone.structure_drift.style: {stroke: "#F57F17"; stroke-width: 4}
    extract_zone.classify_decision.style: {stroke: "#880E4F"; stroke-width: 4}
    extract_zone.soft_warning.style: {stroke: "#1B5E20"; stroke-width: 4}
    extract_zone.blocking_error.style: {stroke: "#B71C1C"; stroke-width: 4}

    # Highlight connections
  }

  AutoFixPath: {
    title.label: "Auto-Fix Path – Full Chain"

    # Dim retry loop and d2lib
    d2_lint_loop.style.opacity: 0.15
    d2lib.style.opacity: 0.15
    extract_zone.style.opacity: 0.3

    # Highlight auto-fix chain
    auto_fix_chain.style: {stroke: "#2E7D32"; stroke-width: 4}
    auto_fix_chain.pre_fix_compile.style: {stroke: "#1B5E20"; stroke-width: 4}
    auto_fix_chain.three_stage.style: {stroke: "#1B5E20"; stroke-width: 4}
    auto_fix_chain.fix_connection_paths.style: {stroke: "#1B5E20"; stroke-width: 4}
    auto_fix_chain.fix_nesting.style: {stroke: "#1B5E20"; stroke-width: 4}
    auto_fix_chain.fix_prefix_merge.style: {stroke: "#1B5E20"; stroke-width: 4}
    auto_fix_chain.fix_shape_normalize.style: {stroke: "#1B5E20"; stroke-width: 4}
    auto_fix_chain.post_fix_compile.style: {stroke: "#1B5E20"; stroke-width: 4}
    auto_fix_chain.final_render.style: {stroke: "#1B5E20"; stroke-width: 4}

    # Highlight connections
  }

  BypassComparison: {
    title.label: "Bypass Comparison – Extract Chain vs d2lib Direct"

    # Dim retry loop
    d2_lint_loop.style.opacity: 0.1

    # Highlight both chains with different colors
    extract_zone.style: {stroke: "#004D40"; stroke-width: 3}
    auto_fix_chain.style: {stroke: "#2E7D32"; stroke-width: 3}
    auto_fix_chain.final_render.style: {stroke: "#1B5E20"; stroke-width: 4}

    d2lib.style: {stroke: "#880E4F"; stroke-width: 3}
    d2lib.direct_compile.style: {stroke: "#880E4F"; stroke-width: 4}
    d2lib.bypass_output.style: {stroke: "#880E4F"; stroke-width: 4}

    # Highlight the two final outputs
    auto_fix_chain.final_render.style: {stroke: "#1B5E20"; stroke-width: 4}
    d2lib.bypass_output.style: {stroke: "#880E4F"; stroke-width: 4}

    # Label the divergence
  }

  Responsibilities: {
    title.label: "LLM vs Auto-Fix Responsibilities"

    # Dim everything except responsibility note
    d2_lint_loop.style.opacity: 0.3
    extract_zone.style.opacity: 0.3
    auto_fix_chain.style.opacity: 0.3
    d2lib.style.opacity: 0.3

    # Highlight responsibility note
    responsibility_note.style: {stroke: "#558B2F"; stroke-width: 4}

    # Highlight LLM's domain in d2_lint_loop
    d2_lint_loop.llm_decides_1.style: {stroke: "#006064"; stroke-width: 4}
    d2_lint_loop.llm_decides_2.style: {stroke: "#006064"; stroke-width: 4}

    # Highlight auto-fix's domain
    auto_fix_chain.fix_connection_paths.style: {stroke: "#1B5E20"; stroke-width: 4}
    auto_fix_chain.fix_nesting.style: {stroke: "#1B5E20"; stroke-width: 4}
    auto_fix_chain.fix_prefix_merge.style: {stroke: "#1B5E20"; stroke-width: 4}
    auto_fix_chain.fix_shape_normalize.style: {stroke: "#1B5E20"; stroke-width: 4}
  }
}
d2_lint_loop.(round1_submit -> round1_error)[0].style: {stroke: red; stroke-width: 3}
d2_lint_loop.(round2_submit -> round2_error)[0].style: {stroke: red; stroke-width: 3}
d2_lint_loop.(round3_attempt -> round3_not_applied)[0].style: {stroke: red; stroke-width: 3}
extract_zone.(normalize -> validation_gate)[0].style: {stroke: "#004D40"; stroke-width: 3}
extract_zone.(validation_gate -> classify_decision)[0].style: {stroke: "#880E4F"; stroke-width: 3}
extract_zone.(classify_decision -> soft_warning)[0].style: {stroke: "#1B5E20"; stroke-width: 3}
extract_zone.(classify_decision -> blocking_error)[0].style: {stroke: "#B71C1C"; stroke-width: 3}
auto_fix_chain.(pre_fix_compile -> three_stage)[0].style: {stroke: "#1B5E20"; stroke-width: 3}
auto_fix_chain.(fix_shape_normalize -> post_fix_compile)[0].style: {stroke: "#1B5E20"; stroke-width: 3}
auto_fix_chain.(post_fix_compile -> final_render)[0].style: {stroke: "#1B5E20"; stroke-width: 3}
(path_decision -> d2_lint_loop.round1_label)[0].style.opacity: 0.1
(path_decision -> d2lib.direct_read)[0].style: {stroke: "#880E4F"; stroke-width: 3}
(d2_lint_loop.write_failed_log -> extract_zone.normalize)[0].style: {stroke: "#004D40"; stroke-width: 2}
d2_lint_loop.(error_report_1 -> llm_decides_1)[0].style: {stroke: "#006064"; stroke-width: 3}
d2_lint_loop.(error_report_2 -> llm_decides_2)[0].style: {stroke: "#006064"; stroke-width: 3}
