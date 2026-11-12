const fs = require("node:fs");
const { createHash } = require("node:crypto");
const { normalizeAnnotations } = require("./annotations.cjs");

const digest = value => createHash("sha256").update(value).digest("hex");
const text = value => typeof value === "string" ? value.normalize("NFC").replace(/\s+/gu, " ").trim() : "";

// The compiler inserts line breaks inside long identifiers as well as between words.
// Match optional layout whitespace only at observed line boundaries.
function displayMatches(label, expected) {
  if (typeof label !== "string" || !text(expected)) return false;
  if (text(label) === text(expected)) return true;
  const parts = label.split(/\r\n|[\r\n]/u);
  if (parts.length < 2) return false;
  const escape = part => text(part).replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const pattern = parts.map(escape).join("\\s*");
  return new RegExp("^" + pattern + "$", "u").test(text(expected));
}

function annotationsFrom(source) {
  const markers = source.split(/\r?\n/u).filter(line => line.startsWith("# cw-annotations:"));
  if (!markers.length) return [];
  const prefix = "# cw-annotations:v1 ";
  if (markers.length !== 1 || !markers[0].startsWith(prefix)) throw new Error("invalid annotation marker");
  return normalizeAnnotations(JSON.parse(markers[0].slice(prefix.length))).items;
}

function sourceEvidence(result, artifacts) {
  if (!artifacts.saved_cw_file || !artifacts.source_sha256) return {};
  const bytes = fs.readFileSync(artifacts.saved_cw_file);
  const context = result.diagram_context;
  if (!context || digest(bytes) !== artifacts.source_sha256 || context.source_sha256 !== artifacts.source_sha256 ||
      (context.cw_code !== undefined && context.cw_code !== bytes.toString("utf8"))) return {};
  const views = context.views?.filter(v => v.id === (context.primary_view ?? ""));
  if (views?.length !== 1 || !Array.isArray(views[0].objects)) return {};
  const board = views[0];
  try {
    return { board, notes: annotationsFrom(bytes.toString("utf8")) };
  } catch {
    return { board };
  }
}

// These are the absolute paths emitted by the cards and shared-tracks compilers.
// A rootless record with explicit IDs can only bind an object at that exact ID.
function modelBindings(model) {
  const nodes = new Map();
  const edges = [...(model?.edges || [])];
  function add(node, id, display = id, renderedTitle = node.title) {
    if (node?.id) nodes.set(node.id, nodes.has(node.id) ? null : { id, display, title: node.title, renderedTitle });
  }
  if (model?.kind === "cards") {
    function visit(node, parent) {
      const id = model.id ? [...parent, "n_" + node.id].join(".") : node.id;
      add(node, id, node === model ? "heading" : id);
      for (const child of node.items || []) visit(child, id ? id.split(".") : []);
    }
    visit(model, []);
  } else if (model?.kind === "matrix") {
    function visit(node, parent) {
      const id = parent + ".n_" + node.id;
      add(node, id, node.items ? id + ".caption" : id);
      const children = node.items || [];
      const rows = Math.ceil(children.length / node.columns);
      for (const [index, child] of children.entries()) {
        const row = node.flow === "column" ? index % rows : Math.floor(index / node.columns);
        visit(child, id + ".row_" + row);
      }
    }
    add(model, "board", "board.title");
    for (const column of model.columns || []) {
      const parent = "board.body.n_" + column.id;
      add(column, parent, parent + ".header");
      for (const cell of column.cells || []) visit(cell, parent);
    }
  } else if (model?.kind === "swimlane" && model.spec) {
    const { lanes, phases } = model.spec;
    const laneIndex = new Map(lanes.map((lane, i) => [lane.id, i]));
    for (const [i, lane] of lanes.entries()) add({ id: lane.id, title: lane.label }, "body.lane" + i + ".header");
    const steps = phases.flatMap(phase => phase.steps);
    let row = -1;
    let previous;
    for (const [i, phase] of phases.entries()) {
      const phasePath = "body.phase_rail.phase" + i;
      add({ id: phase.id, title: phase.label }, phasePath, phasePath, String(i + 1).padStart(2, "0") + "  " + phase.label);
      let lastLane;
      let direction = 0;
      for (const step of phase.steps) {
        const lane = laneIndex.get(step.lane);
        const nextDirection = Math.sign(lane - lastLane);
        if (lastLane === undefined || !nextDirection || (direction && direction !== nextDirection)) {
          row++;
          direction = 0;
        } else direction = nextDirection;
        const id = "body.lane" + lane + ".r" + row + ".step_" + step.id;
        const caption = step === steps[0] ? "开始" : step === steps.at(-1) ? "结束" : "";
        const visible = caption ? caption + "\n" + step.text.replace(new RegExp("^" + caption + "\\s*[:：·]\\s*"), "") : step.text;
        add({ id: step.id, title: step.text }, id, id, visible);
        if (previous) edges.push({ from: previous.step.id, to: step.id, label: previous.step.next_label || "",
          ...(previous.row !== row && previous.lane !== lane ? { routed: true } : {}) });
        previous = { step, lane, row };
        lastLane = lane;
      }
    }
  }
  return { nodes, edges };
}

// Go stores D2's absolute edge identity, including the arrow and parallel index.
// A quoted key may itself contain arrow-shaped text.
function hasDirectedEndpoints(object, src, dst) {
  const id = String(object.id || "").replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/gu, "key");
  const arrows = [...id.matchAll(/ (<->|->|<-|--) /gu)];
  if (arrows.length !== 1) return false;
  return arrows[0][1] === "->" && object.source === src && object.target === dst ||
    arrows[0][1] === "<-" && object.source === dst && object.target === src;
}

function locate(evidence, name, objects, bindings) {
  const named = value => displayMatches(value, name);
  if (evidence.kind === "node") {
    const node = bindings?.nodes.get(evidence.id);
    const modelMatch = !bindings || (node && named(node.title));
    const id = bindings ? node?.display : evidence.id;
    const matches = objects.filter(o => (o.kind === "node" || o.kind === "container") && o.id === id && displayMatches(o.label, node?.renderedTitle ?? name));
    return { modelMatch, object: matches.length === 1 ? matches[0] : null, semanticLabel: node?.title };
  }
  const src = bindings ? bindings.nodes.get(evidence.from)?.id : evidence.from;
  const dst = bindings ? bindings.nodes.get(evidence.to)?.id : evidence.to;
  const modelEdges = bindings?.edges.filter(e => e.from === evidence.from && e.to === evidence.to && named(e.label));
  const modelMatch = !bindings || modelEdges.length === 1;
  const matches = objects.filter(o => src && dst && o.kind === "edge" && hasDirectedEndpoints(o, src, dst) && named(o.label) &&
    (!evidence.id || evidence.id === o.id));
  return { modelMatch, object: matches.length === 1 ? matches[0] : null, composite: modelEdges?.[0]?.routed };
}

function verifyViewCoverage(plan, view, result, artifacts, expectedInput) {
  const issues = [];
  function issue(code, fields = {}) { issues.push({ code, view_id: view.view_id, ...fields }); }
  const { board, notes } = sourceEvidence(result, artifacts);
  const objects = board?.objects || [];
  if (!board) issue("PRODUCT_EVIDENCE_UNAVAILABLE");
  if (board && !notes) issue("PRODUCT_ANNOTATIONS_INVALID");
  const boundNotes = (notes || []).filter(note => !note.view || note.view === board.id);
  for (const requested of view.annotations?.items || []) {
    const actual = boundNotes.find(n => n.id === requested.id);
    if (!actual || text(actual.text) !== text(requested.text) || (actual.view || "") !== (requested.view || "")) {
      issue("REQUESTED_ANNOTATION_MISMATCH", { annotation_id: requested.id });
    }
  }
  const model = result.authoring_model;
  const bindings = view.authoring ? modelBindings(model) : null;
  if (view.authoring && !model) issue("AUTHORING_PRODUCT_MISMATCH");
  const proof = result.co_design?.coverage_evidence;
  const reviewed = !view.authoring && proof?.status === "accepted" && proof.complete === true &&
    proof.reason === "jev_review_complete" && typeof proof.snapshot_id === "string" && /^[0-9a-f]{64}$/.test(proof.snapshot_id) &&
    typeof proof.source === "string" && proof.source_sha256 === digest(proof.source) && proof.input_sha256 === artifacts.source_sha256;
  if (!view.authoring && !reviewed) issue("CHILD_COVERAGE_EVIDENCE_UNAVAILABLE");
  if (reviewed && expectedInput && !proof.source.includes(expectedInput)) issue("CHILD_INPUT_INCOMPLETE");
  for (const fact of (plan.facts || []).filter(f => f.view_id === view.view_id)) {
    const e = fact.evidence;
    const ident = { fact_id: fact.fact_id };
    if (!e || !["node", "edge", "annotation"].includes(e.kind)) {
      issue("FACT_EVIDENCE_REQUIRED", ident);
      continue;
    }
    const noteId = e.kind === "annotation" ? e.id : e.full_text_annotation_id;
    const full = text(fact.text);
    const hasNote = !!(noteId && full && boundNotes.some(n => n.id === noteId && text(n.text).includes(full)));
    if ((noteId || e.kind === "annotation") && !hasNote) issue("FULL_TEXT_ANNOTATION_INVALID", ident);
    if (e.kind === "annotation") continue;
    const found = locate(e, e.label ?? fact.text, objects, bindings);
    if (!found.modelMatch) issue("AUTHORING_PRODUCT_MISMATCH", ident);
    if (!found.object && found.composite) issue("COMPOSITE_EDGE_UNVERIFIED", ident);
    else if (board && (!found.object || (!displayMatches(found.semanticLabel ?? found.object.label, fact.text) && !hasNote))) {
      issue("FACT_SEMANTIC_EVIDENCE_MISSING", ident);
    }
  }
  for (const ref of plan.interfaces || []) {
    const kind = ref.kind || "directed_interface";
    const endpoints = ref.endpoints.filter(endpoint => endpoint.view_id === view.view_id);
    if (!endpoints.length) continue;
    if (!["entity_reference", "directed_interface"].includes(kind)) {
      issue("REFERENCE_KIND_UNSUPPORTED", { interface: ref.name });
      continue;
    }
    const entity = kind === "entity_reference";
    if (entity && (!ref.entity_id || new Set(ref.endpoints.map(ep => ep.view_id)).size < 2)) {
      issue("ENTITY_REFERENCE_ENDPOINTS_REQUIRED", { interface: ref.name });
      continue;
    }
    for (const endpoint of endpoints) {
      const e = endpoint.evidence;
      const fields = { interface: ref.name, fact_id: endpoint.fact_id };
      if (!e || (entity ? e.kind !== "node" || e.id !== ref.entity_id : e.kind !== "edge" || !e.from || !e.to)) {
        issue(entity ? "ENTITY_REFERENCE_EVIDENCE_REQUIRED" : "INTERFACE_EVIDENCE_REQUIRED", fields);
        continue;
      }
      const found = locate(e, ref.name, objects, bindings);
      if (!found.object && found.composite) issue("COMPOSITE_EDGE_UNVERIFIED", fields);
      else if ((e.label !== undefined && text(e.label) !== text(ref.name)) || !found.modelMatch || (board && !found.object)) {
        issue("INTERFACE_PRODUCT_INCOMPLETE", fields);
      }
    }
  }
  const unverified = new Set(["COMPOSITE_EDGE_UNVERIFIED", "PRODUCT_EVIDENCE_UNAVAILABLE", "CHILD_COVERAGE_EVIDENCE_UNAVAILABLE", "FACT_EVIDENCE_REQUIRED",
    "INTERFACE_EVIDENCE_REQUIRED", "REFERENCE_KIND_UNSUPPORTED"]);
  return {
    status: issues.some(i => !unverified.has(i.code)) ? "rejected" : issues.length ? "unverified" : "accepted",
    ...(notes ? { annotations: { count: boundNotes.length, ids: boundNotes.map(n => n.id) } } : {}),
    issues, evidence_source: view.authoring ? "authoring_model+diagram_context+full_text_annotations" :
      (reviewed ? "diagram_context+child_co_design_coverage+full_text_annotations" : "child_semantic_review_unverified"),
    child_input_sha256: reviewed ? proof.source_sha256 : null, source_sha256: artifacts.source_sha256 || null,
  };
}

module.exports = { verifyViewCoverage };
