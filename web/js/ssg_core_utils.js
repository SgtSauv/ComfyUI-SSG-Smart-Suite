// ==========================================================================
// SSG CUSTOM NODE ECOSYSTEM (V4 ARCHITECTURE)
// Core Engine Utilities, Recursive Drill & Canvas Telemetry
// File: /web/js/ssg_core_utils.js
// ==========================================================================

export const SSG_DEFAULT_WIDTH = 250;

// Semantic Diagnostic & Identity Palette (Calibrated Neon Specification)
export const SSG_COLOR_AWBLUE = "#00e5ff";        // Tier 0 - Diagnostics Base Cyan
export const SSG_COLOR_EMERALD_GREEN = "#00ff88"; // Playback Active / Mint
export const SSG_COLOR_ICE_BLUE = "#38bdf8";      // Frozen / Idle Retention / Bank B
export const SSG_COLOR_RUBY_RED = "#ff3333";      // Tier 3 - Fault / Unavailable
export const SSG_COLOR_YELLOW_TOPAZ = "#ffcc00";  // Tier 1 - Edit Mode / Available
export const SSG_COLOR_FIRE_OPAL = "#ff7700";     // Tier 2 - Desync / Missing Module Warning
export const SSG_COLOR_ELECTRIC_PURPLE = "#b026ff"; // Vault Latent Buffer Active
export const SSG_COLOR_MUTED = "#555b66";         // Inactive Loop / Injection Bypass

export const AW_BLUE = SSG_COLOR_AWBLUE;

export const DIAGNOSTIC_TIERS = {
    TIER_0_NOMINAL: null,
    TIER_1_YELLOW: SSG_COLOR_YELLOW_TOPAZ,
    TIER_2_ORANGE: SSG_COLOR_FIRE_OPAL,
    TIER_3_RED: SSG_COLOR_RUBY_RED
};

if (!window.SSG_PipeRegistry) {
    window.SSG_PipeRegistry = {};
}

if (!window.SSG_ModuleRegistry) {
    window.SSG_ModuleRegistry = {};
}

if (!window.SSG_SocketRegistry) {
    window.SSG_SocketRegistry = {};
}

if (!window.SSG_ActiveHighlights) {
    window.SSG_ActiveHighlights = new Set();
}

// Global cached frontend version resolved from backend telemetry
window.SSG_CachedFrontendVersion = null;

/**
 * Asynchronously hydrates the frontend engine version from the backend API route.
 * Guarantees ground-truth version resolution across all distribution models.
 */
export async function syncBackendFrontendVersion() {
    if (window.SSG_CachedFrontendVersion) return window.SSG_CachedFrontendVersion;
    try {
        const res = await fetch("/ssg/suite/frontend_version");
        if (res.ok) {
            const data = await res.json();
            if (data && data.frontend_version) {
                window.SSG_CachedFrontendVersion = String(data.frontend_version).trim().replace(/^v/, "");
                return window.SSG_CachedFrontendVersion;
            }
        }
    } catch (e) {
        console.warn("[SSG] Telemetry version sync unreachable, using fallback heuristics:", e);
    }
    return null;
}

// Immediate boot fetch
syncBackendFrontendVersion();

/**
 * Semver comparison engine anchored to backend ground-truth telemetry.
 * Returns true if current frontend >= targetVersion.
 * In Nodes 2.0 (Vue active) where version < 1.53.6, returns false.
 */
export function isFrontendVersionAtLeast(targetVersion = "1.53.6", appInstance = null) {
    const isNodes2 = !!window.__VUE__ || !!document.querySelector(".comfyui-vue-root, #vue-app, [data-comfy-root]");

    // Classic canvas always supports dynamic LiteGraph widget drawing
    if (!isNodes2) {
        return true;
    }

    const liveVersion = window.SSG_CachedFrontendVersion;
    if (!liveVersion || liveVersion === "0.0.0" || liveVersion === "Unknown") {
        // Fallback: If in Nodes 2.0 and version is indeterminate, lock down to static for safety
        return false;
    }

    const parseParts = (v) => v.replace(/^v/, "").split(".").map(n => parseInt(n, 10) || 0);
    const currParts = parseParts(liveVersion);
    const targetParts = parseParts(targetVersion);

    const len = Math.max(currParts.length, targetParts.length);
    for (let i = 0; i < len; i++) {
        const curr = currParts[i] || 0;
        const target = targetParts[i] || 0;
        if (curr > target) return true;
        if (curr < target) return false;
    }

    return true;
}

/**
 * Universal property synchronizer for LiteGraph configure lifecycle.
 */
export function syncIncomingProperties(node, info) {
    if (!node || !info || !info.properties) return;
    node.properties = node.properties || {};
    for (const key in info.properties) {
        if (info.properties[key] !== undefined) {
            node.properties[key] = info.properties[key];
        }
    }
}

export function sanitizeAndTruncateText(str, maxLen = 16) {
    if (!str || typeof str !== "string") return "";
    const cleanStr = str.trim();
    const sliced = cleanStr.length > maxLen ? cleanStr.substring(0, maxLen) : cleanStr;
    return sliced.trim();
}

/**
 * Nodes 2.0 and Classic compatible bounding size synchronizer.
 * Enforces elastic minimum floor while preserving user-expanded width geometry.
 */
export function updateNodeBounds(node, width, height) {
    if (!node) return;
    const currentWidth = (node.size && node.size[0]) ? node.size[0] : SSG_DEFAULT_WIDTH;
    const targetWidth = Math.max(SSG_DEFAULT_WIDTH, width || currentWidth);
    const targetHeight = Math.max(60, height || (node.size ? node.size[1] : 100));

    node.size = [targetWidth, targetHeight];

    if (typeof node.setSize === "function") {
        node.setSize(node.size);
    }

    if (node.graph) {
        node.graph._version = (node.graph._version || 0) + 1;
        if (typeof node.graph.change === "function") {
            node.graph.change();
        }
        node.graph.setDirtyCanvas(true, true);
    }
}

/**
 * Non-breaking compatibility export for legacy companion modules.
 * Latches state without performing DOM/Canvas2D breaking border strokes.
 */
export function drawSSGWarningOutline(node, ctx, tierColor) {
    if (!node) return;
    node._ssgDiagnosticTier = tierColor || null;
}

/**
 * Universal Slot 0 Status Banner Drawing Primitive (Legacy Canvas 2D Fallback).
 * Retained strictly for third-party companion modules; primary suite uses ssg_dom_banner.js.
 */
export function drawSSGWidgetBanner(ctx, widgetWidth, y, displayText, tierColor = null, customAccent = null, nodeRef = null) {
    const margin = (typeof LiteGraph !== "undefined" && LiteGraph.NODE_WIDGET_MARGIN)
        ? LiteGraph.NODE_WIDGET_MARGIN
        : 15;

    const hostWidth = (widgetWidth && widgetWidth > 40)
        ? widgetWidth
        : ((nodeRef && nodeRef.size && nodeRef.size[0]) ? (nodeRef.size[0] - (margin * 2)) : 190);

    const drawWidth = Math.max(hostWidth - (margin * 2), 20);
    const drawHeight = 22;
    const drawY = y + 2;

    const defaultStroke = (typeof LiteGraph !== "undefined" && LiteGraph.WIDGET_OUTLINE_COLOR)
        ? LiteGraph.WIDGET_OUTLINE_COLOR
        : "#333b46";
    const defaultText = (typeof LiteGraph !== "undefined" && LiteGraph.NODE_TEXT_COLOR)
        ? LiteGraph.NODE_TEXT_COLOR
        : "#cccccc";

    const stroke = tierColor || customAccent || defaultStroke;
    const fillText = tierColor || customAccent || defaultText;

    ctx.save();

    ctx.fillStyle = "#0f1216";
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1.0;
    ctx.shadowBlur = 0;
    ctx.shadowColor = "transparent";

    ctx.beginPath();
    ctx.roundRect(margin, drawY, drawWidth, drawHeight, [4]);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.font = "bold 11px 'Courier New', monospace";
    ctx.textBaseline = "middle";

    const maxTextWidth = drawWidth - 12;

    if (displayText.endsWith(" [A]") || displayText.endsWith(" [B]")) {
        const isBankB = displayText.endsWith(" [B]");
        const baseText = displayText.slice(0, -4);
        const badgeText = isBankB ? "[B]" : "[A]";

        let totalBaseWidth = ctx.measureText(baseText + " ").width;
        let badgeWidth = ctx.measureText(badgeText).width;
        let totalRequiredWidth = totalBaseWidth + badgeWidth;

        if (totalRequiredWidth > maxTextWidth && maxTextWidth > 0) {
            const scale = Math.max(maxTextWidth / totalRequiredWidth, 0.75);
            ctx.font = `bold ${Math.floor(11 * scale)}px 'Courier New', monospace`;
            totalBaseWidth = ctx.measureText(baseText + " ").width;
            badgeWidth = ctx.measureText(badgeText).width;
        }

        const startX = margin + (drawWidth / 2) - ((totalBaseWidth + badgeWidth) / 2);

        ctx.textAlign = "left";
        ctx.fillStyle = fillText;
        ctx.fillText(baseText + " ", startX, drawY + (drawHeight / 2));

        ctx.fillStyle = isBankB ? SSG_COLOR_ICE_BLUE : fillText;
        ctx.fillText(badgeText, startX + totalBaseWidth, drawY + (drawHeight / 2));
    } else {
        let stringWidth = ctx.measureText(displayText).width;
        let textToDraw = displayText;

        if (stringWidth > maxTextWidth && maxTextWidth > 0) {
            const scale = maxTextWidth / stringWidth;
            if (scale >= 0.75) {
                const fontSize = Math.floor(11 * scale);
                ctx.font = `bold ${fontSize}px 'Courier New', monospace`;
            } else {
                ctx.font = "bold 9px 'Courier New', monospace";
                while (textToDraw.length > 4 && ctx.measureText(textToDraw + "…").width > maxTextWidth) {
                    textToDraw = textToDraw.slice(0, -1);
                }
                textToDraw = textToDraw + "…";
            }
        }

        ctx.fillStyle = fillText;
        ctx.textAlign = "center";
        ctx.fillText(textToDraw, margin + (drawWidth / 2), drawY + (drawHeight / 2));
    }

    ctx.restore();
}

export function getAllGraphNodes(targetGraph) {
    const nodes = [];
    function recurse(g) {
        if (!g) return;
        const localNodes = g._nodes || g.nodes || [];
        for (const n of localNodes) {
            if (!n) continue;
            nodes.push(n);
            const sub = n.subgraph || n.inner_graph;
            if (sub) recurse(sub);
        }
    }
    recurse(targetGraph);
    return nodes;
}

export function findGraphAndNode(app, callingNode, nodeId) {
    if (nodeId == null) return null;
    const strId = String(nodeId);

    if (callingNode?.graph) {
        const localNode = callingNode.graph.getNodeById(nodeId);
        if (localNode) return { node: localNode, graph: callingNode.graph };
    }

    if (app?.graph) {
        const rootNode = app.graph.getNodeById(nodeId);
        if (rootNode) return { node: rootNode, graph: app.graph };

        let found = null;
        function searchSubgraphs(targetGraph) {
            if (!targetGraph || found) return;
            const nodes = targetGraph._nodes || targetGraph.nodes || [];
            for (const n of nodes) {
                if (n && String(n.id) === strId) {
                    found = { node: n, graph: targetGraph };
                    return;
                }
                const sub = n?.subgraph || n?.inner_graph;
                if (sub) searchSubgraphs(sub);
            }
        }
        searchSubgraphs(app.graph);
        if (found) return found;
    }

    return null;
}

export function focusAndCenterOnNode(app, targetNode) {
    if (!targetNode || !app?.canvas) return;

    if (targetNode.graph && app.canvas.graph !== targetNode.graph) {
        if (typeof app.canvas.openSubgraph === "function") {
            app.canvas.openSubgraph(targetNode.graph);
        } else if (typeof app.canvas.setGraph === "function") {
            app.canvas.setGraph(targetNode.graph);
        }
    }

    if (typeof app.canvas.centerOnNode === "function") {
        app.canvas.centerOnNode(targetNode);
    } else {
        app.canvas.ds.offset[0] = -targetNode.pos[0] + (app.canvas.canvas.width / 2) - (targetNode.size[0] / 2);
        app.canvas.ds.offset[1] = -targetNode.pos[1] + (app.canvas.canvas.height / 2) - (targetNode.size[1] / 2);
    }

    app.canvas.selectNode(targetNode);
    app.graph?.setDirtyCanvas(true, true);
}

export function toggleChannelHighlight(channelId) {
    if (!channelId) return;
    if (window.SSG_ActiveHighlights.has(channelId)) {
        window.SSG_ActiveHighlights.delete(channelId);
    } else {
        window.SSG_ActiveHighlights.add(channelId);
    }
}

export function isChannelHighlighted(channelId) {
    return !!channelId && window.SSG_ActiveHighlights.has(channelId);
}

export function isNodeChannelHighlighted(node) {
    if (!node || window.SSG_ActiveHighlights.size === 0) return false;

    const chanId = node.properties?.channel_id || node.properties?.bound_channel || node.properties?.vault_id;
    if (chanId) {
        const cleanBase = chanId.replace(/_TX$/, "").replace(/_RX$/, "");
        if (
            window.SSG_ActiveHighlights.has(chanId) ||
            window.SSG_ActiveHighlights.has(cleanBase) ||
            window.SSG_ActiveHighlights.has(`${cleanBase}_TX`) ||
            window.SSG_ActiveHighlights.has(`${cleanBase}_RX`)
        ) {
            return true;
        }
    }

    const targetSockProp = node.properties?.target_socket;
    if (targetSockProp) {
        const cleanTarget = String(targetSockProp).trim();
        if (window.SSG_ActiveHighlights.has(cleanTarget)) {
            return true;
        }
    }

    if (node.widgets) {
        const chW = node.widgets.find(w => w.name === "channel" || w.name === "target_socket");
        if (chW && chW.value) {
            const rawVal = String(chW.value).trim();
            const cleanBase = rawVal.replace(/_TX$/, "").replace(/_RX$/, "");
            if (
                window.SSG_ActiveHighlights.has(rawVal) ||
                window.SSG_ActiveHighlights.has(cleanBase) ||
                window.SSG_ActiveHighlights.has(`${cleanBase}_TX`) ||
                window.SSG_ActiveHighlights.has(`${cleanBase}_RX`)
            ) {
                return true;
            }
        }
    }

    return false;
}

const KNOWN_MULTI_OUTPUT_MAPS = {
    "CheckpointLoaderSimple": ["MODEL", "CLIP", "VAE"],
    "CheckpointLoader": ["MODEL", "CLIP", "VAE"],
    "DualCLIPLoader": ["CLIP"],
    "UNETLoader": ["MODEL"],
    "VAELoader": ["VAE"]
};

export function findTrueUpstreamAnchor(app, callingNode, originNodeId, originSlotIndex) {
    const searchResult = findGraphAndNode(app, callingNode, originNodeId);
    if (!searchResult) return { name: "◦", type: "*" };

    const { node: originNode, graph: currentGraph } = searchResult;

    // 1. Reroute Nodes: Trace straight through
    if (originNode.type === "Reroute") {
        if (originNode.inputs && originNode.inputs[0] && originNode.inputs[0].link !== null) {
            const linkId = originNode.inputs[0].link;
            const linkObj = currentGraph.links ? (Array.isArray(currentGraph.links) ? currentGraph.links.find(l => l && String(l.id) === String(linkId)) : currentGraph.links[linkId]) : null;
            if (linkObj) {
                return findTrueUpstreamAnchor(app, originNode, linkObj.origin_id, linkObj.origin_slot);
            }
        }
    }

    // 2. SSG Smart Tag: Explicit Hard-Stop Boundary
    if (originNode.type === "SSGSmartTag" || originNode.comfyClass === "SSGSmartTag") {
        const tagWidget = originNode.widgets?.find(w => w.name === "tag_name" || w.name === "tag");
        const typeWidget = originNode.widgets?.find(w => w.name === "type_override");

        let resolvedTagValue = tagWidget?.value;
        if ((!resolvedTagValue || resolvedTagValue === "Tag_1") && originNode.properties?.tag_name) {
            resolvedTagValue = originNode.properties.tag_name;
        } else if ((!resolvedTagValue || resolvedTagValue === "Tag_1") && originNode.widgets_values?.[0]) {
            resolvedTagValue = originNode.widgets_values[0];
        }

        const resolvedTag = sanitizeAndTruncateText(resolvedTagValue || "Tag", 16);

        let resolvedType = typeWidget?.value;
        if (!resolvedType || resolvedType === "AUTO") {
            const tagInputLink = originNode.inputs?.[0]?.link;
            if (tagInputLink !== null && tagInputLink !== undefined) {
                const innerLink = currentGraph.links ? (Array.isArray(currentGraph.links) ? currentGraph.links.find(l => l && String(l.id) === String(tagInputLink)) : currentGraph.links[tagInputLink]) : null;
                if (innerLink) {
                    const upstream = findTrueUpstreamAnchor(app, originNode, innerLink.origin_id, innerLink.origin_slot);
                    resolvedType = upstream.type || "*";
                }
            } else {
                resolvedType = originNode.outputs?.[0]?.type || "*";
            }
        }

        return { name: resolvedTag, type: resolvedType || "*" };
    }

    const slotDef = originNode.outputs?.[originSlotIndex];
    const rawSlotLabel = slotDef?.label || slotDef?.name;

    // 3. SSG Smart Satellite: Direct Terminal Slot Reading
    if (originNode.type === "SSGSmartSatellite" || originNode.comfyClass === "SSGSmartSatellite") {
        if (slotDef) {
            if (rawSlotLabel && rawSlotLabel !== "◦" && !rawSlotLabel.startsWith("SSG_")) {
                return {
                    name: sanitizeAndTruncateText(rawSlotLabel, 16),
                    type: slotDef.type || "*"
                };
            }
            if (slotDef.type && slotDef.type !== "*") {
                return {
                    name: sanitizeAndTruncateText(slotDef.type, 16),
                    type: slotDef.type
                };
            }
        }
    }

    // 4. Subgraph Input Bridges: Recurse into Outer Graph Connections
    if (originNode.type === "GraphInput" || originNode.type === "SubgraphInput") {
        const parentNode = currentGraph.parent_node;
        if (parentNode && parentNode.inputs) {
            const inputIdx = originNode.properties?.subgraph_input_idx ?? originSlotIndex ?? 0;
            const parentInput = parentNode.inputs[inputIdx];
            if (parentInput && parentInput.link != null) {
                const parentGraph = parentNode.graph || app.graph;
                const outerLink = parentGraph.links ? (Array.isArray(parentGraph.links) ? parentGraph.links.find(l => l && String(l.id) === String(parentInput.link)) : parentGraph.links[parentInput.link]) : null;
                if (outerLink) {
                    return findTrueUpstreamAnchor(app, parentNode, outerLink.origin_id, outerLink.origin_slot);
                }
            }
            const fallbackTitle = parentInput?.label || parentInput?.name || originNode.properties?.name || originNode.title;
            return {
                name: sanitizeAndTruncateText(fallbackTitle, 16),
                type: parentInput?.type || originNode.outputs?.[originSlotIndex]?.type || "*"
            };
        }
    }

    // 5. Known Multi-Output Signatures (Checkpoints, DualCLIP, etc.)
    if (KNOWN_MULTI_OUTPUT_MAPS[originNode.type]) {
        const slotMap = KNOWN_MULTI_OUTPUT_MAPS[originNode.type];
        if (slotMap[originSlotIndex]) {
            return { name: slotMap[originSlotIndex], type: slotMap[originSlotIndex] };
        }
    }

    // 6. Generic Multi-Output Slot Label Prioritization
    if (originNode.outputs && originNode.outputs.length > 1) {
        if (rawSlotLabel && rawSlotLabel !== "◦" && rawSlotLabel !== "") {
            return {
                name: sanitizeAndTruncateText(rawSlotLabel, 16),
                type: slotDef?.type || "*"
            };
        }
        if (slotDef?.type && slotDef.type !== "*") {
            return {
                name: sanitizeAndTruncateText(slotDef.type, 16),
                type: slotDef.type
            };
        }
    }

    // 7. Custom User-Renamed Nodes (Excluding SSG Multiplexers)
    const isSSGNode = (originNode.type && (originNode.type.startsWith("SSGSmart") || originNode.type.startsWith("SSG"))) ||
                      (originNode.comfyClass && (originNode.comfyClass.startsWith("SSGSmart") || originNode.comfyClass.startsWith("SSG")));

    if (!isSSGNode && originNode.title && originNode.title !== originNode.type && originNode.title !== originNode.comfyClass) {
        const cleanTitle = sanitizeAndTruncateText(originNode.title, 16);
        const slotType = slotDef?.type || "*";
        return { name: cleanTitle, type: slotType };
    }

    // 8. Output Slot Explicit Label Fallback
    if (rawSlotLabel && rawSlotLabel !== "◦" && rawSlotLabel !== "") {
        return {
            name: sanitizeAndTruncateText(rawSlotLabel, 16),
            type: slotDef?.type || "*"
        };
    }

    // 9. Root Type Fallback
    const fallbackType = (slotDef?.type && slotDef.type !== "*") ? slotDef.type : originNode.type;
    const cleanFallback = fallbackType ? sanitizeAndTruncateText(fallbackType, 16) : "Track";

    return {
        name: cleanFallback,
        type: slotDef?.type || "*"
    };
}

export function scanActiveBroadcasters(app) {
    if (!app?.graph) return [];

    const activeChannels = new Set();
    const allNodes = getAllGraphNodes(app.graph);

    for (const node of allNodes) {
        if (!node) continue;

        if (node.type === "SSGSmartPipe" || node.type === "SSGSmartRouter") {
            const val = node.properties?.channel_id;
            if (val) activeChannels.add(val);
        } else if (node.type === "SSGSmartGate") {
            const val = node.properties?.channel_id || node.widgets?.find(w => w.name === "channel_name")?.value?.trim();
            if (val && val !== "UNASSIGNED" && val !== "Default") {
                activeChannels.add(`${val}_TX`);
                activeChannels.add(`${val}_RX`);
            }
        }
    }

    for (const chan in window.SSG_PipeRegistry) {
        if (!activeChannels.has(chan)) {
            delete window.SSG_PipeRegistry[chan];
        }
    }

    return Array.from(activeChannels);
}

export function scanActiveSockets(app) {
    if (!app?.graph) return [];

    const activeSocketIds = new Set();
    const allNodes = getAllGraphNodes(app.graph);

    for (const node of allNodes) {
        if (node && node.type === "SSGSmartSocket") {
            const chanId = node.properties?.channel_id;
            if (chanId) {
                activeSocketIds.add(chanId);
                window.SSG_SocketRegistry[chanId] = {
                    node: node,
                    module_id: node.properties?.module_id || null,
                    channel_id: chanId,
                    bypass: !!node.properties?.bypass
                };
            }
        }
    }

    for (const chan in window.SSG_SocketRegistry) {
        if (!activeSocketIds.has(chan)) {
            delete window.SSG_SocketRegistry[chan];
        }
    }

    return Array.from(activeSocketIds);
}

export function registerChannel(channelName, tracks, explicitGen = null, is_editing = false, is_bypassed = false) {
    if (!channelName || channelName === "UNASSIGNED") return;

    const currentRecord = window.SSG_PipeRegistry[channelName] || { generation: 0 };
    const nextGen = explicitGen !== null ? explicitGen : currentRecord.generation + 1;

    window.SSG_PipeRegistry[channelName] = {
        tracks: [...tracks],
        generation: nextGen,
        is_editing: is_editing,
        is_bypassed: is_bypassed,
        timestamp: Date.now()
    };
}

export function registerGateLoopState(channelBaseName, isLoopActive) {
    if (!channelBaseName) return;
    const isBypassed = !isLoopActive;
    if (window.SSG_PipeRegistry[`${channelBaseName}_TX`]) {
        window.SSG_PipeRegistry[`${channelBaseName}_TX`.trim()].is_bypassed = isBypassed;
    }
    if (window.SSG_PipeRegistry[`${channelBaseName}_RX`]) {
        window.SSG_PipeRegistry[`${channelBaseName}_RX`.trim()].is_bypassed = isBypassed;
    }
}

export function isChannelBypassed(channelName) {
    if (!channelName || !window.SSG_PipeRegistry) return false;
    const record = window.SSG_PipeRegistry[channelName];
    if (record && record.is_bypassed === true) return true;

    const baseName = channelName.replace(/_TX$/, "").replace(/_RX$/, "");
    const baseTx = window.SSG_PipeRegistry[`${baseName}_TX`];
    if (baseTx && baseTx.is_bypassed === true) return true;

    return false;
}

export function getChannelRecord(channelName) {
    return window.SSG_PipeRegistry[channelName] || null;
}

export function checkSchemaGenerationMismatch(node, channelName) {
    const record = getChannelRecord(channelName);
    if (!record) return false;
    return node._ssgBoundGeneration !== undefined && node._ssgBoundGeneration !== record.generation;
}

export function forceNetworkUpdate(app) {
    if (app?.graph) {
        hydrateSSGNetwork(app);
        scanActiveBroadcasters(app);
        scanActiveSockets(app);

        const allNodes = getAllGraphNodes(app.graph);

        for (const node of allNodes) {
            if (!node) continue;

            if (
                (node.type === "SSGSmartSatellite" ||
                 node.type === "SSGSmartGateRelay" ||
                 node.type === "SSGSmartGateReturn") &&
                typeof node._ssgRefreshDropdown === "function"
            ) {
                node._ssgRefreshDropdown();
            }

            if (typeof node._ssgRefreshSocketDropdown === "function") {
                node._ssgRefreshSocketDropdown();
            }

            if (
                (node.type === "SSGSmartTag" || node.comfyClass === "SSGSmartTag") &&
                typeof node.updateTagSlotState === "function"
            ) {
                node.updateTagSlotState();
            }
        }

        if (typeof window.SSG_updateHUDState === "function") {
            window.SSG_updateHUDState(app);
        }

        app.graph.setDirtyCanvas(true, true);
    }
}

export function hydrateSSGNetwork(app) {
    if (!app?.graph) return;
    const allNodes = getAllGraphNodes(app.graph);

    for (const node of allNodes) {
        if (!node) continue;

        if (node.type === "SSGSmartPipe" || node.type === "SSGSmartRouter") {
            const isLocked = node.properties?.is_locked === true;
            if (isLocked) {
                node._isEditMode = false;
                const channelName = node.properties?.channel_id;
                const manifestStr = node.properties?.pipe_manifest || node.properties?.router_manifest;
                const genW = node.widgets?.find(w => w.name === "schema_generation");

                if (channelName && manifestStr) {
                    try {
                        const tracks = JSON.parse(manifestStr);
                        registerChannel(channelName, tracks, genW?.value || 1, false, false);
                    } catch (e) {
                        console.warn("[SSG] Failed to parse manifest during hydration:", e);
                    }
                }
            }
        } else if (node.type === "SSGSmartGate") {
            const isLocked = node.properties?.is_locked === true;
            const channelName = node.properties?.channel_id;
            const injectWidget = node.widgets?.find(w => w.name === "injection_loop");
            
            const isLoopActive = (node.properties?.injection_loop !== undefined)
                ? !!node.properties.injection_loop
                : (injectWidget ? !!injectWidget.value : false);

            if (injectWidget && node.properties?.injection_loop !== undefined) {
                injectWidget.value = !!node.properties.injection_loop;
            }

            if (isLocked) {
                node._isEditMode = false;
                const manifestStr = node.properties?.gate_manifest;
                const genW = node.widgets?.find(w => w.name === "schema_generation");

                if (channelName && manifestStr) {
                    try {
                        const tracks = JSON.parse(manifestStr);
                        registerChannel(`${channelName}_TX`, tracks, genW?.value || 1, false, !isLoopActive);
                        registerChannel(`${channelName}_RX`, tracks, genW?.value || 1, false, !isLoopActive);
                    } catch (e) {
                        console.warn("[SSG] Failed to parse Gate manifest during hydration:", e);
                    }
                }
            }

            if (channelName) {
                registerGateLoopState(channelName, isLoopActive);
            }
        } else if (node.type === "SSGSmartTag" || node.comfyClass === "SSGSmartTag") {
            if (typeof node.updateTagSlotState === "function") {
                node.updateTagSlotState();
            }
        }
    }

    for (const node of allNodes) {
        if (!node) continue;
        if (node.type === "SSGSmartSatellite" || node.type === "SSGSmartGateRelay" || node.type === "SSGSmartGateReturn") {
            const channelW = node.widgets?.find(w => w.name === "channel");
            const targetChannel = channelW?.value || node.properties?.bound_channel;
            if (targetChannel && window.SSG_PipeRegistry[targetChannel]) {
                const record = window.SSG_PipeRegistry[targetChannel];
                node._ssgBoundGeneration = record.generation;
            }
        }
    }

    app.graph.setDirtyCanvas(true, true);
}