import "./styles.css";
import { loadWhiskeys } from "./services/dataService.js";
import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation } from "d3-force";
import { select } from "d3-selection";
import { drag } from "d3-drag";
import { zoom, zoomIdentity } from "d3-zoom";

const app = document.querySelector("#app");

const state = {
  all: [],
  filtered: [],
  selectedSlugs: new Set(),
  activeWhiskeySlug: null,
  viewMode: "GRAPH",
  filtersOpen: false,
  filters: {
    search: "",
    category: "ALL",
    maxPrice: 500,
    minProof: 0
  },
  recommend: {
    category: "ALL",
    maxPrice: 120,
    targetProof: 100
  },
  graph: {
    layout: "FORCE",
    zoom: 1,
    panX: 0,
    panY: 0,
    popupNodeId: null,
    collapsed: new Set(),
    simulation: null,
    positions: new Map(),
    zoomBehavior: null,
    svgSelection: null
  }
};

function num(v) {
  if (v === null || v === undefined || v === "") {
    return null;
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function normalizeRecord(r) {
  return {
    ...r,
    msrpUsd: num(r.msrpUsd),
    proof: num(r.proof),
    ageStatementYears: num(r.ageStatementYears),
    flavorTags: Array.isArray(r.flavorTags) ? r.flavorTags : []
  };
}

function thumbnailFor(whiskey) {
  if (whiskey.thumbnailUrl) {
    return whiskey.thumbnailUrl;
  }
  return "/images/bottle-placeholder.svg";
}

function truncateLabel(value, max = 32) {
  if (!value || value.length <= max) {
    return value || "";
  }
  return `${value.slice(0, max - 1)}…`;
}

function filterData() {
  const { search, category, maxPrice, minProof } = state.filters;
  const s = search.trim().toLowerCase();

  state.filtered = state.all.filter((w) => {
    if (category !== "ALL" && w.category !== category) {
      return false;
    }
    if (w.msrpUsd !== null && w.msrpUsd > maxPrice) {
      return false;
    }
    if (w.proof !== null && w.proof < minProof) {
      return false;
    }
    if (!s) {
      return true;
    }
    const hay = [w.name, w.companyName, w.distilleryName, w.category]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return hay.includes(s);
  });
}

function groupTree(rows) {
  const companies = new Map();
  for (const w of rows) {
    const company = w.companyName || "Unknown Company";
    const distillery = w.distilleryName || "Unknown Distillery";
    if (!companies.has(company)) {
      companies.set(company, new Map());
    }
    const distilleryMap = companies.get(company);
    if (!distilleryMap.has(distillery)) {
      distilleryMap.set(distillery, []);
    }
    distilleryMap.get(distillery).push(w);
  }
  return companies;
}

function buildTreeHtml() {
  const grouped = groupTree(state.filtered);
  const companies = [...grouped.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  if (companies.length === 0) {
    return "<p class='empty'>No whiskeys match your filters.</p>";
  }

  return companies
    .map(([company, distilleryMap]) => {
      const distilleries = [...distilleryMap.entries()].sort((a, b) => a[0].localeCompare(b[0]));
      return `
        <details open class="company-node">
          <summary>${company} <span class="count">(${distilleries.reduce((acc, d) => acc + d[1].length, 0)})</span></summary>
          <ul class="distillery-list">
            ${distilleries
              .map(([distillery, whiskeys]) => {
                const items = whiskeys
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map((w) => {
                    const checked = state.selectedSlugs.has(w.slug) ? "checked" : "";
                    return `
                      <li class="bottle-item">
                        <img src="${thumbnailFor(w)}" alt="${w.name} bottle thumbnail" class="thumb" loading="lazy" onerror="this.onerror=null;this.src='/images/bottle-placeholder.svg';" />
                        <div>
                          <label>
                            <input type="checkbox" data-slug="${w.slug}" class="seed-toggle" ${checked} />
                            <span class="bottle-name">${w.name}</span>
                          </label>
                          <span class="meta">
                            ${w.category}${w.proof !== null ? ` • ${w.proof} proof` : ""}${w.msrpUsd !== null ? ` • $${w.msrpUsd}` : ""}
                          </span>
                        </div>
                      </li>
                    `;
                  })
                  .join("");

                return `
                  <li>
                    <details class="distillery-node">
                      <summary>${distillery} <span class="count">(${whiskeys.length})</span></summary>
                      <ul class="bottle-list">${items}</ul>
                    </details>
                  </li>
                `;
              })
              .join("")}
          </ul>
        </details>
      `;
    })
    .join("");
}

function buildGraphHierarchy(rows) {
  const grouped = groupTree(rows);
  const root = {
    id: "root",
    type: "root",
    name: "All Whiskeys",
    children: []
  };

  const companies = [...grouped.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  for (const [company, distilleryMap] of companies) {
    const companyNode = {
      id: `company:${company}`,
      type: "company",
      name: company,
      children: []
    };

    const distilleries = [...distilleryMap.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    for (const [distillery, whiskeys] of distilleries) {
      const distilleryNode = {
        id: `distillery:${company}::${distillery}`,
        type: "distillery",
        name: distillery,
        children: whiskeys
          .slice()
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((whiskey) => ({
            id: `bottle:${whiskey.slug}`,
            type: "bottle",
            name: whiskey.name,
            slug: whiskey.slug,
            whiskey,
            children: []
          }))
      };
      companyNode.children.push(distilleryNode);
    }

    root.children.push(companyNode);
  }

  return root;
}

function buildVisibleGraphData(rows) {
  const root = buildGraphHierarchy(rows);
  const nodes = [];
  const links = [];

  function visit(node, parent = null) {
    const allChildren = Array.isArray(node.children) ? node.children : [];
    const collapsed = node.type !== "bottle" && state.graph.collapsed.has(node.id);
    const visibleChildren = collapsed ? [] : allChildren;

    nodes.push({
      id: node.id,
      type: node.type,
      name: node.name,
      slug: node.slug || null,
      childCount: allChildren.length,
      collapsed,
      parentId: parent?.id || null
    });

    for (const child of visibleChildren) {
      links.push({ source: node.id, target: child.id });
      visit(child, node);
    }
  }

  visit(root);
  return { nodes, links };
}

function nodeRadius(node) {
  if (node.type === "root") {
    return 20;
  }
  if (node.type === "company") {
    return 15;
  }
  if (node.type === "distillery") {
    return 12;
  }
  return 8;
}

function updateBottleLabelVisibility(graphRoot, zoomLevel) {
  if (!graphRoot) {
    return;
  }
  const showBottleLabels = zoomLevel >= 1.35;
  graphRoot
    .selectAll(".graph-label-bottle")
    .style("opacity", showBottleLabels ? 1 : 0)
    .style("pointer-events", showBottleLabels ? "auto" : "none");
}

function buildGraphHtml() {
  if (state.filtered.length === 0) {
    return "<p class='empty'>No whiskeys match your filters.</p>";
  }

  const zoomPct = Math.round(state.graph.zoom * 100);

  return `
    <div class="graph-controls">
      <button id="graphLayoutForce" class="small-btn ${state.graph.layout === "FORCE" ? "is-active" : ""}">Force</button>
      <button id="graphLayoutLayered" class="small-btn ${state.graph.layout === "LAYERED" ? "is-active" : ""}">Layered</button>
      <button id="graphCollapseAll" class="small-btn">Collapse All</button>
      <button id="graphExpandAll" class="small-btn">Expand All</button>
      <button id="graphZoomOut" class="small-btn">Zoom Out</button>
      <button id="graphZoomIn" class="small-btn">Zoom In</button>
      <button id="graphZoomReset" class="small-btn">Reset Zoom</button>
      <span id="graphZoomLabel" class="graph-zoom">${zoomPct}%</span>
    </div>
    <p class="hint">Force: drag nodes freely. Layered: left-to-right levels (company → distillery → bottle). Click company/distillery to expand or collapse, and click bottle nodes to select for recommendations.</p>
    <div class="graph-scroll">
      <svg id="graphSvg" class="graph-svg" viewBox="0 0 1400 900" preserveAspectRatio="xMidYMid meet" aria-label="Interactive whiskey graph"></svg>
      <div id="graphWhiskeyPopup" class="graph-whiskey-popup"></div>
    </div>
  `;
}

function renderForceGraph() {
  const svgNode = document.querySelector("#graphSvg");
  if (!svgNode || state.viewMode !== "GRAPH") {
    return;
  }

  if (state.graph.simulation) {
    for (const node of state.graph.simulation.nodes()) {
      state.graph.positions.set(node.id, {
        x: node.x,
        y: node.y,
        fx: node.fx,
        fy: node.fy
      });
    }
    state.graph.simulation.stop();
    state.graph.simulation = null;
  }

  const { nodes, links } = buildVisibleGraphData(state.filtered);
  for (const node of nodes) {
    const previous = state.graph.positions.get(node.id);
    if (!previous) {
      continue;
    }
    node.x = previous.x;
    node.y = previous.y;
    node.fx = previous.fx;
    node.fy = previous.fy;
  }

  const width = 1400;
  const height = 900;

  const svg = select(svgNode);
  svg.selectAll("*").remove();
  state.graph.svgSelection = svg;

  const canvas = svg.append("g").attr("class", "graph-canvas");

  const zoomBehavior = zoom()
    .scaleExtent([0.35, 3.2])
    .on("zoom", (event) => {
      canvas.attr("transform", event.transform);
      state.graph.zoom = Number(event.transform.k.toFixed(2));
      state.graph.panX = Number(event.transform.x.toFixed(2));
      state.graph.panY = Number(event.transform.y.toFixed(2));
      const label = document.querySelector("#graphZoomLabel");
      if (label) {
        label.textContent = `${Math.round(state.graph.zoom * 100)}%`;
      }
      updateBottleLabelVisibility(canvas, state.graph.zoom);
      updateGraphPopupPosition();
    });

  state.graph.zoomBehavior = zoomBehavior;

  svg.call(zoomBehavior).call(
    zoomBehavior.transform,
    zoomIdentity.translate(state.graph.panX, state.graph.panY).scale(state.graph.zoom)
  );

  const linkSelection = canvas
    .append("g")
    .attr("class", "graph-links")
    .selectAll("line")
    .data(links)
    .join("line")
    .attr("class", "graph-link");

  const nodeSelection = canvas
    .append("g")
    .attr("class", "graph-nodes")
    .selectAll("g")
    .data(nodes)
    .join("g")
    .attr("class", (d) => {
      const selected = d.type === "bottle" && d.slug && state.selectedSlugs.has(d.slug);
      return `graph-node graph-node-${d.type}${selected ? " graph-node-selected" : ""}`;
    })
    .attr("data-node-id", (d) => d.id)
    .on("click", (event, d) => {
      if (event.defaultPrevented) {
        return;
      }

      if (d.type === "company" || d.type === "distillery") {
        state.graph.popupNodeId = null;
        if (state.graph.collapsed.has(d.id)) {
          state.graph.collapsed.delete(d.id);
        } else {
          state.graph.collapsed.add(d.id);
        }
        renderActiveGraph();
        return;
      }

      if (d.type === "bottle" && d.slug) {
        state.activeWhiskeySlug = d.slug;
        state.graph.popupNodeId = d.id;

        if (state.selectedSlugs.has(d.slug)) {
          state.selectedSlugs.delete(d.slug);
        } else {
          state.selectedSlugs.add(d.slug);
        }

        nodeSelection.attr("class", (n) => {
          const selected = n.type === "bottle" && n.slug && state.selectedSlugs.has(n.slug);
          return `graph-node graph-node-${n.type}${selected ? " graph-node-selected" : ""}`;
        });

        nodeSelection.selectAll(".graph-label").attr("class", (n) => {
          const classes = ["graph-label", `graph-label-${n.type}`];
          const selected = n.type === "bottle" && n.slug && state.selectedSlugs.has(n.slug);
          if (n.type === "bottle" && !selected) {
            classes.push("graph-label-bottle");
          }
          if (selected) {
            classes.push("graph-label-selected");
          }
          return classes.join(" ");
        });

        updateBottleLabelVisibility(canvas, state.graph.zoom);
        updateRecommendationPanels();
        updateWhiskeyDetailPanel();
        updateGraphPopupPosition();
      }
    })
    .call(
      drag()
        .on("start", (event, d) => {
          if (!event.active && state.graph.simulation) {
            state.graph.simulation.alphaTarget(0.25).restart();
          }
          d.fx = d.x;
          d.fy = d.y;
        })
        .on("drag", (event, d) => {
          d.fx = event.x;
          d.fy = event.y;
        })
        .on("end", (event, d) => {
          if (!event.active && state.graph.simulation) {
            state.graph.simulation.alphaTarget(0);
          }
          d.fx = event.x;
          d.fy = event.y;
        })
    );

  nodeSelection.append("circle").attr("class", "graph-dot").attr("r", (d) => nodeRadius(d));

  nodeSelection.append("title").text((d) => d.name);

  nodeSelection
    .filter((d) => d.childCount > 0)
    .append("text")
    .attr("class", "graph-toggle")
    .attr("text-anchor", "middle")
    .attr("dominant-baseline", "central")
    .text((d) => (d.collapsed ? "+" : "−"));

  nodeSelection
    .append("text")
    .attr("class", (d) => {
      const classes = ["graph-label", `graph-label-${d.type}`];
      const selected = d.type === "bottle" && d.slug && state.selectedSlugs.has(d.slug);
      if (d.type === "bottle" && !selected) {
        classes.push("graph-label-bottle");
      }
      if (selected) {
        classes.push("graph-label-selected");
      }
      return classes.join(" ");
    })
    .attr("x", (d) => nodeRadius(d) + 7)
    .attr("y", 4)
    .text((d) => truncateLabel(d.name, d.type === "bottle" ? 36 : 26));

  updateBottleLabelVisibility(canvas, state.graph.zoom);
  updateGraphPopupPosition();

  const simulation = forceSimulation(nodes)
    .force("link", forceLink(links).id((d) => d.id).distance((l) => {
      const sourceType = l.source?.type || "bottle";
      if (sourceType === "root") {
        return 220;
      }
      if (sourceType === "company") {
        return 130;
      }
      return 85;
    }))
    .force("charge", forceManyBody().strength((d) => (d.type === "bottle" ? -25 : -240)))
    .force("collide", forceCollide().radius((d) => nodeRadius(d) + (d.type === "bottle" ? 3 : 10)).strength(0.9))
    .force("center", forceCenter(width / 2, height / 2))
    .on("tick", () => {
      linkSelection
        .attr("x1", (d) => d.source.x)
        .attr("y1", (d) => d.source.y)
        .attr("x2", (d) => d.target.x)
        .attr("y2", (d) => d.target.y);

      nodeSelection.attr("transform", (d) => `translate(${d.x}, ${d.y})`);
    });

  state.graph.simulation = simulation;
}

function renderLayeredGraph() {
  const svgNode = document.querySelector("#graphSvg");
  if (!svgNode || state.viewMode !== "GRAPH") {
    return;
  }

  if (state.graph.simulation) {
    state.graph.simulation.stop();
    state.graph.simulation = null;
  }

  const { nodes, links } = buildVisibleGraphData(state.filtered);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const children = new Map();
  for (const link of links) {
    if (!children.has(link.source)) {
      children.set(link.source, []);
    }
    children.get(link.source).push(link.target);
  }

  const depths = new Map();
  const queue = [{ id: "root", depth: 0 }];
  depths.set("root", 0);
  while (queue.length) {
    const current = queue.shift();
    const childIds = children.get(current.id) || [];
    for (const childId of childIds) {
      if (depths.has(childId)) {
        continue;
      }
      const nextDepth = current.depth + 1;
      depths.set(childId, nextDepth);
      queue.push({ id: childId, depth: nextDepth });
    }
  }

  const maxDepth = Math.max(...depths.values(), 0);
  const nodesByDepth = new Map();
  for (const node of nodes) {
    const depth = depths.get(node.id) ?? 0;
    if (!nodesByDepth.has(depth)) {
      nodesByDepth.set(depth, []);
    }
    nodesByDepth.get(depth).push(node);
  }

  for (const list of nodesByDepth.values()) {
    list.sort((a, b) => {
      const parentCmp = (a.parentId || "").localeCompare(b.parentId || "");
      if (parentCmp !== 0) {
        return parentCmp;
      }
      return a.name.localeCompare(b.name);
    });
  }

  const maxPerColumn = Math.max(...[...nodesByDepth.values()].map((v) => v.length), 1);
  const width = Math.max(1400, 200 + maxDepth * 320);
  const height = Math.max(900, 140 + maxPerColumn * 42);

  for (let depth = 0; depth <= maxDepth; depth++) {
    const column = nodesByDepth.get(depth) || [];
    const x = 90 + depth * 300;
    const span = height - 140;
    for (let i = 0; i < column.length; i++) {
      const y =
        column.length === 1
          ? height / 2
          : 70 + (i * span) / Math.max(1, column.length - 1);
      column[i].x = x;
      column[i].y = y;
    }
  }

  const svg = select(svgNode);
  svg.attr("viewBox", `0 0 ${width} ${height}`);
  svg.selectAll("*").remove();
  state.graph.svgSelection = svg;

  const canvas = svg.append("g").attr("class", "graph-canvas");
  const zoomBehavior = zoom()
    .scaleExtent([0.35, 3.2])
    .on("zoom", (event) => {
      canvas.attr("transform", event.transform);
      state.graph.zoom = Number(event.transform.k.toFixed(2));
      state.graph.panX = Number(event.transform.x.toFixed(2));
      state.graph.panY = Number(event.transform.y.toFixed(2));
      const label = document.querySelector("#graphZoomLabel");
      if (label) {
        label.textContent = `${Math.round(state.graph.zoom * 100)}%`;
      }
      updateBottleLabelVisibility(canvas, state.graph.zoom);
      updateGraphPopupPosition();
    });

  state.graph.zoomBehavior = zoomBehavior;
  svg.call(zoomBehavior).call(
    zoomBehavior.transform,
    zoomIdentity.translate(state.graph.panX, state.graph.panY).scale(state.graph.zoom)
  );

  canvas
    .append("g")
    .attr("class", "graph-links")
    .selectAll("line")
    .data(links)
    .join("line")
    .attr("class", "graph-link")
    .attr("x1", (d) => byId.get(d.source).x)
    .attr("y1", (d) => byId.get(d.source).y)
    .attr("x2", (d) => byId.get(d.target).x)
    .attr("y2", (d) => byId.get(d.target).y);

  const nodeSelection = canvas
    .append("g")
    .attr("class", "graph-nodes")
    .selectAll("g")
    .data(nodes)
    .join("g")
    .attr("transform", (d) => `translate(${d.x}, ${d.y})`)
    .attr("class", (d) => {
      const selected = d.type === "bottle" && d.slug && state.selectedSlugs.has(d.slug);
      return `graph-node graph-node-${d.type}${selected ? " graph-node-selected" : ""}`;
    })
    .attr("data-node-id", (d) => d.id)
    .on("click", (event, d) => {
      if (d.type === "company" || d.type === "distillery") {
        state.graph.popupNodeId = null;
        if (state.graph.collapsed.has(d.id)) {
          state.graph.collapsed.delete(d.id);
        } else {
          state.graph.collapsed.add(d.id);
        }
        renderActiveGraph();
        return;
      }

      if (d.type === "bottle" && d.slug) {
        state.activeWhiskeySlug = d.slug;
        state.graph.popupNodeId = d.id;

        if (state.selectedSlugs.has(d.slug)) {
          state.selectedSlugs.delete(d.slug);
        } else {
          state.selectedSlugs.add(d.slug);
        }

        nodeSelection.attr("class", (n) => {
          const selected = n.type === "bottle" && n.slug && state.selectedSlugs.has(n.slug);
          return `graph-node graph-node-${n.type}${selected ? " graph-node-selected" : ""}`;
        });

        nodeSelection.selectAll(".graph-label").attr("class", (n) => {
          const classes = ["graph-label", `graph-label-${n.type}`];
          const selected = n.type === "bottle" && n.slug && state.selectedSlugs.has(n.slug);
          if (n.type === "bottle" && !selected) {
            classes.push("graph-label-bottle");
          }
          if (selected) {
            classes.push("graph-label-selected");
          }
          return classes.join(" ");
        });

        updateBottleLabelVisibility(canvas, state.graph.zoom);
        updateRecommendationPanels();
        updateWhiskeyDetailPanel();
        updateGraphPopupPosition();
      }
    });

  nodeSelection.append("circle").attr("class", "graph-dot").attr("r", (d) => nodeRadius(d));
  nodeSelection.append("title").text((d) => d.name);

  nodeSelection
    .filter((d) => d.childCount > 0)
    .append("text")
    .attr("class", "graph-toggle")
    .attr("text-anchor", "middle")
    .attr("dominant-baseline", "central")
    .text((d) => (d.collapsed ? "+" : "−"));

  nodeSelection
    .append("text")
    .attr("class", (d) => {
      const classes = ["graph-label", `graph-label-${d.type}`];
      const selected = d.type === "bottle" && d.slug && state.selectedSlugs.has(d.slug);
      if (d.type === "bottle" && !selected) {
        classes.push("graph-label-bottle");
      }
      if (selected) {
        classes.push("graph-label-selected");
      }
      return classes.join(" ");
    })
    .attr("x", (d) => nodeRadius(d) + 7)
    .attr("y", 4)
    .text((d) => truncateLabel(d.name, d.type === "bottle" ? 36 : 26));

  updateBottleLabelVisibility(canvas, state.graph.zoom);
  updateGraphPopupPosition();
}

function renderActiveGraph() {
  if (state.graph.layout === "LAYERED") {
    renderLayeredGraph();
    return;
  }
  renderForceGraph();
}

function collapseAllGraph() {
  const collapsed = new Set();
  const grouped = groupTree(state.filtered);
  for (const [company, distilleryMap] of grouped.entries()) {
    collapsed.add(`company:${company}`);
    for (const [distillery] of distilleryMap.entries()) {
      collapsed.add(`distillery:${company}::${distillery}`);
    }
  }
  state.graph.collapsed = collapsed;
}

function buildBrowserModeHtml() {
  if (state.viewMode === "GRAPH") {
    return buildGraphHtml();
  }
  return buildTreeHtml();
}

function distanceScore(a, b) {
  const proofGap = a.proof !== null && b.proof !== null ? Math.abs(a.proof - b.proof) / 80 : 0.2;
  const priceGap = a.msrpUsd !== null && b.msrpUsd !== null ? Math.abs(a.msrpUsd - b.msrpUsd) / 300 : 0.25;
  const ageGap =
    a.ageStatementYears !== null && b.ageStatementYears !== null
      ? Math.abs(a.ageStatementYears - b.ageStatementYears) / 30
      : 0.2;
  const categoryGap = a.category === b.category ? 0 : 0.35;
  const companyBonus = a.companyName === b.companyName ? -0.08 : 0;
  return proofGap * 0.35 + priceGap * 0.25 + ageGap * 0.2 + categoryGap * 0.2 + companyBonus;
}

function recommendBySelected() {
  const selected = state.all.filter((w) => state.selectedSlugs.has(w.slug));
  if (selected.length === 0) {
    return [];
  }

  const selectedSlugs = new Set(selected.map((w) => w.slug));
  return state.all
    .filter((w) => !selectedSlugs.has(w.slug))
    .map((candidate) => {
      const avg = selected.reduce((acc, s) => acc + distanceScore(s, candidate), 0) / selected.length;
      return { whiskey: candidate, score: avg };
    })
    .sort((a, b) => a.score - b.score)
    .slice(0, 8);
}

function recommendByConditions() {
  const { category, maxPrice, targetProof } = state.recommend;

  return state.all
    .filter((w) => {
      if (category !== "ALL" && w.category !== category) {
        return false;
      }
      if (w.msrpUsd !== null && w.msrpUsd > maxPrice) {
        return false;
      }
      return true;
    })
    .map((w) => {
      const proofGap = w.proof === null ? 0.2 : Math.abs(w.proof - targetProof) / 80;
      const priceScore = w.msrpUsd === null ? 0.2 : Math.max(0, (maxPrice - w.msrpUsd) / Math.max(1, maxPrice));
      const ageScore = w.ageStatementYears === null ? 0.15 : Math.min(1, w.ageStatementYears / 15);
      const score = priceScore * 0.45 + (1 - proofGap) * 0.35 + ageScore * 0.2;
      return { whiskey: w, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);
}

function recommendationList(items, mode) {
  if (items.length === 0) {
    return "<p class='empty'>No recommendations available yet.</p>";
  }
  return `
    <ul class="rec-list">
      ${items
        .map(({ whiskey, score }) => {
          const reason =
            mode === "selected"
              ? `Similarity score ${(1 - Math.min(score, 1)).toFixed(2)}`
              : `Condition score ${score.toFixed(2)}`;
          return `
            <li>
              <img src="${thumbnailFor(whiskey)}" alt="${whiskey.name} bottle thumbnail" class="thumb thumb-rec" loading="lazy" onerror="this.onerror=null;this.src='/images/bottle-placeholder.svg';" />
              <div>
                <div class="rec-title">${whiskey.name}</div>
                <div class="rec-meta">${whiskey.category} • ${whiskey.companyName || "Unknown"} • ${whiskey.msrpUsd !== null ? `$${whiskey.msrpUsd}` : "n/a"}${whiskey.proof !== null ? ` • ${whiskey.proof} proof` : ""}</div>
                <div class="rec-reason">${reason}</div>
              </div>
            </li>
          `;
        })
        .join("")}
    </ul>
  `;
}

function getActiveWhiskey() {
  if (state.activeWhiskeySlug) {
    const bySlug = state.all.find((w) => w.slug === state.activeWhiskeySlug);
    if (bySlug) {
      return bySlug;
    }
  }

  if (state.selectedSlugs.size > 0) {
    const first = [...state.selectedSlugs][0];
    return state.all.find((w) => w.slug === first) || null;
  }

  return null;
}

function whiskeyDetailsHtml() {
  const whiskey = getActiveWhiskey();
  if (!whiskey) {
    return "<p class='empty'>Click a whiskey node (or whiskey in tree) to see full bottle details here.</p>";
  }

  const tags = whiskey.flavorTags?.length ? whiskey.flavorTags.join(", ") : "n/a";
  const mash = whiskey.mashBillKnown ? whiskey.mashBillText || "known" : whiskey.mashBillText || "unknown";

  return `
    <article class="detail-card">
      <img src="${thumbnailFor(whiskey)}" alt="${whiskey.name} bottle thumbnail" class="detail-thumb" loading="lazy" onerror="this.onerror=null;this.src='/images/bottle-placeholder.svg';" />
      <div class="detail-body">
        <h3>${whiskey.name}</h3>
        <p class="detail-sub">${whiskey.category} • ${whiskey.companyName || "Unknown Company"}</p>
        <dl class="detail-grid">
          <div><dt>Distillery</dt><dd>${whiskey.distilleryName || "n/a"}</dd></div>
          <div><dt>State</dt><dd>${whiskey.state || "n/a"}</dd></div>
          <div><dt>Availability</dt><dd>${whiskey.availability || "n/a"}</dd></div>
          <div><dt>MSRP</dt><dd>${whiskey.msrpUsd !== null ? `$${whiskey.msrpUsd}` : "n/a"}</dd></div>
          <div><dt>Proof</dt><dd>${whiskey.proof !== null ? whiskey.proof : "n/a"}</dd></div>
          <div><dt>Age</dt><dd>${whiskey.ageStatementYears !== null ? `${whiskey.ageStatementYears} years` : "n/a"}</dd></div>
          <div><dt>Mash Bill</dt><dd>${mash}</dd></div>
          <div><dt>Flavor Tags</dt><dd>${tags}</dd></div>
        </dl>
      </div>
    </article>
  `;
}

function graphPopupCardHtml(whiskey) {
  if (!whiskey) {
    return "";
  }

  return `
    <article class="graph-popup-card">
      <img src="${thumbnailFor(whiskey)}" alt="${whiskey.name} bottle thumbnail" class="graph-popup-thumb" loading="lazy" onerror="this.onerror=null;this.src='/images/bottle-placeholder.svg';" />
      <div class="graph-popup-body">
        <h4>${whiskey.name}</h4>
        <p>${whiskey.category} • ${whiskey.companyName || "Unknown"}</p>
        <p>${whiskey.proof !== null ? `${whiskey.proof} proof` : "proof n/a"} • ${whiskey.msrpUsd !== null ? `$${whiskey.msrpUsd}` : "MSRP n/a"}</p>
      </div>
    </article>
  `;
}

function graphNodeSelector(nodeId) {
  if (!nodeId) {
    return null;
  }
  const escaped = String(nodeId).replaceAll('"', '\\"');
  return `.graph-node[data-node-id="${escaped}"]`;
}

function updateGraphPopupPosition() {
  const popup = document.querySelector("#graphWhiskeyPopup");
  const scrollHost = document.querySelector(".graph-scroll");
  const nodeSelector = graphNodeSelector(state.graph.popupNodeId);
  const nodeEl = nodeSelector ? document.querySelector(nodeSelector) : null;

  if (!popup || !scrollHost || !nodeEl || !state.activeWhiskeySlug) {
    if (popup) {
      popup.classList.remove("is-visible");
    }
    return;
  }

  popup.innerHTML = graphPopupCardHtml(getActiveWhiskey());
  popup.classList.add("is-visible");

  const nodeRect = nodeEl.getBoundingClientRect();
  const hostRect = scrollHost.getBoundingClientRect();

  let left = nodeRect.right - hostRect.left + scrollHost.scrollLeft + 10;
  let top = nodeRect.top - hostRect.top + scrollHost.scrollTop;

  const maxLeft = scrollHost.scrollLeft + scrollHost.clientWidth - 320;
  if (left > maxLeft) {
    left = nodeRect.left - hostRect.left + scrollHost.scrollLeft - 300;
  }

  top = Math.max(scrollHost.scrollTop + 10, Math.min(top, scrollHost.scrollTop + scrollHost.clientHeight - 120));

  popup.style.left = `${Math.max(scrollHost.scrollLeft + 8, left)}px`;
  popup.style.top = `${top}px`;
}

function updateRecommendationPanels() {
  const bySelected = recommendBySelected();
  const byCondition = recommendByConditions();

  const conditionSlot = document.querySelector("#recByConditionList");
  if (conditionSlot) {
    conditionSlot.innerHTML = recommendationList(byCondition, "condition");
  }

  const selectedSlot = document.querySelector("#recBySelectedList");
  if (selectedSlot) {
    selectedSlot.innerHTML = recommendationList(bySelected, "selected");
  }
}

function updateWhiskeyDetailPanel() {
  const slot = document.querySelector("#whiskeyDetailPanel");
  if (slot) {
    slot.innerHTML = whiskeyDetailsHtml();
  }
}

function categoryOptions() {
  const categories = [...new Set(state.all.map((w) => w.category).filter(Boolean))].sort();
  return ["ALL", ...categories]
    .map((c) => `<option value="${c}">${c}</option>`)
    .join("");
}

function render() {
  filterData();

  const bySelected = recommendBySelected();
  const byCondition = recommendByConditions();

  app.innerHTML = `
    <main class="layout">
      <header class="hero">
        <h1>American Whiskey Atlas</h1>
        <p>Interactive company → distillery → bottle explorer with both tree and graph modes plus recommendation engine.</p>
      </header>

      <section class="panel filters">
        <details id="filtersDetails" class="filters-details" ${state.filtersOpen ? "open" : ""}>
          <summary>
            <span>Filters</span>
            <span class="hint-inline">Showing ${state.filtered.length} / ${state.all.length} bottles.</span>
          </summary>
          <div class="grid">
            <label>Search
              <input id="search" value="${state.filters.search}" placeholder="Buffalo Trace, rye, 10 year..." />
            </label>
            <label>Category
              <select id="category">${categoryOptions()}</select>
            </label>
            <label>Max Price: <strong>$<span id="maxPriceOut">${state.filters.maxPrice}</span></strong>
              <input id="maxPrice" type="range" min="10" max="500" value="${state.filters.maxPrice}" />
            </label>
            <label>Min Proof: <strong><span id="minProofOut">${state.filters.minProof}</span></strong>
              <input id="minProof" type="range" min="0" max="140" value="${state.filters.minProof}" />
            </label>
          </div>
        </details>
      </section>

      <section class="panel tree">
        <div class="panel-head">
          <h2>Whiskey Browser</h2>
          <div class="view-switch">
            <button id="viewTree" class="small-btn ${state.viewMode === "TREE" ? "is-active" : ""}">Tree</button>
            <button id="viewGraph" class="small-btn ${state.viewMode === "GRAPH" ? "is-active" : ""}">Graph</button>
            <button id="clearSeeds" class="small-btn">Clear Selected Bottles</button>
          </div>
        </div>
        ${buildBrowserModeHtml()}
      </section>

      <section class="panel recs">
        <h2>Whiskey Details</h2>
        <div id="whiskeyDetailPanel">${whiskeyDetailsHtml()}</div>
      </section>

      <section class="panel recs">
        <h2>Recommend By Conditions</h2>
        <div class="grid">
          <label>Category
            <select id="recCategory">${categoryOptions()}</select>
          </label>
          <label>Max Price: <strong>$<span id="recMaxPriceOut">${state.recommend.maxPrice}</span></strong>
            <input id="recMaxPrice" type="range" min="20" max="300" value="${state.recommend.maxPrice}" />
          </label>
          <label>Target Proof: <strong><span id="recProofOut">${state.recommend.targetProof}</span></strong>
            <input id="recProof" type="range" min="80" max="140" value="${state.recommend.targetProof}" />
          </label>
        </div>
        <div id="recByConditionList">${recommendationList(byCondition, "condition")}</div>
      </section>

      <section class="panel recs">
        <h2>Recommend From Selected Bottles</h2>
        <p class="hint">Select bottles in the tree above, then this section finds close alternatives.</p>
        <div id="recBySelectedList">${recommendationList(bySelected, "selected")}</div>
      </section>
    </main>
  `;

  const category = document.querySelector("#category");
  const recCategory = document.querySelector("#recCategory");
  category.value = state.filters.category;
  recCategory.value = state.recommend.category;

  wireEvents();

  if (state.viewMode === "GRAPH") {
    renderActiveGraph();
  } else if (state.graph.simulation) {
    state.graph.simulation.stop();
    state.graph.simulation = null;
    state.graph.zoomBehavior = null;
    state.graph.svgSelection = null;
    state.graph.popupNodeId = null;
  }
}

function wireEvents() {
  document.querySelector("#filtersDetails")?.addEventListener("toggle", (e) => {
    state.filtersOpen = e.target.open;
  });

  document.querySelector("#viewTree")?.addEventListener("click", () => {
    state.viewMode = "TREE";
    render();
  });

  document.querySelector("#viewGraph")?.addEventListener("click", () => {
    state.viewMode = "GRAPH";
    render();
  });

  document.querySelector("#graphLayoutForce")?.addEventListener("click", () => {
    if (state.graph.layout === "FORCE") {
      return;
    }
    state.graph.layout = "FORCE";
    render();
  });

  document.querySelector("#graphLayoutLayered")?.addEventListener("click", () => {
    if (state.graph.layout === "LAYERED") {
      return;
    }
    state.graph.layout = "LAYERED";
    render();
  });

  document.querySelector("#search")?.addEventListener("input", (e) => {
    state.filters.search = e.target.value;
    render();
  });

  document.querySelector("#category")?.addEventListener("change", (e) => {
    state.filters.category = e.target.value;
    render();
  });

  document.querySelector("#maxPrice")?.addEventListener("input", (e) => {
    state.filters.maxPrice = Number(e.target.value);
    render();
  });

  document.querySelector("#minProof")?.addEventListener("input", (e) => {
    state.filters.minProof = Number(e.target.value);
    render();
  });

  document.querySelector("#recCategory")?.addEventListener("change", (e) => {
    state.recommend.category = e.target.value;
    render();
  });

  document.querySelector("#recMaxPrice")?.addEventListener("input", (e) => {
    state.recommend.maxPrice = Number(e.target.value);
    render();
  });

  document.querySelector("#recProof")?.addEventListener("input", (e) => {
    state.recommend.targetProof = Number(e.target.value);
    render();
  });

  for (const checkbox of document.querySelectorAll(".seed-toggle")) {
    checkbox.addEventListener("change", (e) => {
      const slug = e.target.getAttribute("data-slug");
      if (!slug) {
        return;
      }

      state.activeWhiskeySlug = slug;

      if (e.target.checked) {
        state.selectedSlugs.add(slug);
      } else {
        state.selectedSlugs.delete(slug);
      }
      render();
    });
  }

  for (const item of document.querySelectorAll(".bottle-item")) {
    item.addEventListener("click", (e) => {
      const target = e.target;
      if (target instanceof HTMLInputElement) {
        return;
      }

      const checkbox = item.querySelector(".seed-toggle");
      const slug = checkbox?.getAttribute("data-slug");
      if (!slug) {
        return;
      }

      state.activeWhiskeySlug = slug;
      updateWhiskeyDetailPanel();
    });
  }

  document.querySelector("#clearSeeds")?.addEventListener("click", () => {
    state.selectedSlugs.clear();
    state.activeWhiskeySlug = null;
    state.graph.popupNodeId = null;

    if (state.viewMode === "GRAPH") {
      updateRecommendationPanels();
      updateWhiskeyDetailPanel();
      renderActiveGraph();
      return;
    }

    render();
  });

  document.querySelector("#graphZoomIn")?.addEventListener("click", () => {
    if (state.viewMode === "GRAPH" && state.graph.zoomBehavior && state.graph.svgSelection) {
      state.graph.svgSelection.call(state.graph.zoomBehavior.scaleBy, 1.2);
      return;
    }

    state.graph.zoom = Math.min(3.2, Number((state.graph.zoom + 0.2).toFixed(2)));
    render();
  });

  document.querySelector("#graphZoomOut")?.addEventListener("click", () => {
    if (state.viewMode === "GRAPH" && state.graph.zoomBehavior && state.graph.svgSelection) {
      state.graph.svgSelection.call(state.graph.zoomBehavior.scaleBy, 1 / 1.2);
      return;
    }

    state.graph.zoom = Math.max(0.35, Number((state.graph.zoom - 0.2).toFixed(2)));
    render();
  });

  document.querySelector("#graphZoomReset")?.addEventListener("click", () => {
    if (state.viewMode === "GRAPH" && state.graph.zoomBehavior && state.graph.svgSelection) {
      state.graph.svgSelection.call(state.graph.zoomBehavior.transform, zoomIdentity.translate(0, 0).scale(1));
      return;
    }

    state.graph.zoom = 1;
    state.graph.panX = 0;
    state.graph.panY = 0;
    render();
  });

  document.querySelector("#graphCollapseAll")?.addEventListener("click", () => {
    collapseAllGraph();

    if (state.viewMode === "GRAPH") {
      renderActiveGraph();
      return;
    }

    render();
  });

  document.querySelector("#graphExpandAll")?.addEventListener("click", () => {
    state.graph.collapsed.clear();

    if (state.viewMode === "GRAPH") {
      renderActiveGraph();
      return;
    }

    render();
  });
}

async function bootstrap() {
  const loaded = await loadWhiskeys();
  state.all = loaded.map(normalizeRecord);
  render();
}

bootstrap().catch((err) => {
  app.innerHTML = `<main class="layout"><section class="panel"><h1>Failed to load whiskey data</h1><p>${err.message}</p></section></main>`;
});
