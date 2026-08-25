// ==========================================================================
// SSG CUSTOM NODE ECOSYSTEM (V2 ARCHITECTURE)
// Core Engine Utilities, Recursive Drill & Canvas Telemetry
// File: /web/js/ssg_core_utils.js
// ==========================================================================

export const SSG_DEFAULT_WIDTH = 220;
export const AW_BLUE = "#00E5FF";

export const DIAGNOSTIC_TIERS = {
    TIER_0_NOMINAL: null,
    TIER_1_YELLOW: "#ffcc00",
    TIER_2_ORANGE: "#ff7700",
    TIER_3_RED: "#ff3333"
};

if (!window.SSG_PipeRegistry) {
    window.SSG_PipeRegistry = {};
}

/**
 * Universal property synchronizer for LiteGraph configure lifecycle.
 * Ensures properties serialized in info.properties are reliably copied
 * onto the node instance before custom configuration runs.
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
    return cleanStr.length > maxLen ? cleanStr.substring(0, maxLen) : cleanStr;
}

export function applyDynamicShavePass(node) {
    const typeNameMap = {
        "SSGSmartPipe": { full: "SSG Smart Pipe", shaved: "Pipe" },
        "SSGSmartRouter": { full: "SSG Smart Router", shaved: "Router" },
        "SSGSmartSatellite": { full: "SSG Smart Satellite", shaved: "Satellite" },
        "SSGSmartGate": { full: "SSG Smart Gate", shaved: "Gate" },
        "SSGSmartGateRelay": { full: "SSG Smart Gate Relay", shaved: "Relay" },
        "SSGSmartGateReturn": { full: "SSG Smart Gate Return", shaved: "Return" },
        "SSGSmartVault": { full: "SSG Smart Vault", shaved: "Vault" },
        "SSGSmartTag": { full: "SSG Smart Tag", shaved: "Tag" }
    };

    const map = typeNameMap[node.type];
    if (!map) return;

    if (!node.flags?.collapsed) {
        if (node.title === map.shaved) {
            node.title = map.full;
        }
    } else {
        if (node.title === map.full) {
            node.title = map.shaved;
        }
    }
}

export function drawSSGWarningOutline(node, ctx, tierColor) {
    if (!tierColor) return;

    ctx.save();
    ctx.strokeStyle = tierColor;
    ctx.lineWidth = 2.5;
    ctx.beginPath();

    if (node.flags?.collapsed) {
        // LiteGraph standard title bar geometry
        const titleHeight = (typeof LiteGraph !== "undefined" && LiteGraph.NODE_TITLE_HEIGHT) ? LiteGraph.NODE_TITLE_HEIGHT : 30;
        const collapsedWidth = node._collapsed_width || (ctx.measureText(node.title || "").width + 50);

        // Collapsed header spans vertically from -titleHeight to 0
        ctx.roundRect(0, -titleHeight, collapsedWidth, titleHeight, [6]);
    } else {
        // Standard expanded node body
        ctx.roundRect(0, 0, node.size[0], node.size[1], [6]);
    }

    ctx.stroke();
    ctx.restore();
}

export function isCanvasDragging(app) {
    return !!(app?.canvas?.node_dragged || app?.canvas?.is_dragging || app?.canvas?.dragging_canvas);
}

export function drawMasterGlobalTooltip(node, ctx, app, labelText) {
    if (!node.flags?.collapsed || !labelText || isCanvasDragging(app)) return;

    const isHovered = app.canvas?.node_over === node;
    if (!isHovered) return;

    ctx.save();
    ctx.font = "bold 11px Arial, sans-serif";
    const textWidth = ctx.measureText(labelText).width;
    const badgeWidth = textWidth + 16;
    const badgeHeight = 22;

    const posX = -badgeWidth - 8;
    const posY = 3;

    ctx.fillStyle = "rgba(18, 22, 28, 0.94)";
    ctx.strokeStyle = "#4a4d52";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.roundRect(posX, posY, badgeWidth, badgeHeight, [4]);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = AW_BLUE;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(labelText, posX + 8, posY + (badgeHeight / 2));
    ctx.restore();
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
                if (n?.subgraph) searchSubgraphs(n.subgraph);
            }
        }
        searchSubgraphs(app.graph);
        if (found) return found;
    }

    return null;
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

    if (originNode.type === "Reroute") {
        if (originNode.inputs && originNode.inputs[0] && originNode.inputs[0].link !== null) {
            const linkId = originNode.inputs[0].link;
            const linkObj = currentGraph.links ? (Array.isArray(currentGraph.links) ? currentGraph.links.find(l => l && String(l.id) === String(linkId)) : currentGraph.links[linkId]) : null;
            if (linkObj) {
                return findTrueUpstreamAnchor(app, originNode, linkObj.origin_id, linkObj.origin_slot);
            }
        }
    }

    if (originNode.type === "SSGSmartTag") {
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

    if (KNOWN_MULTI_OUTPUT_MAPS[originNode.type]) {
        const slotMap = KNOWN_MULTI_OUTPUT_MAPS[originNode.type];
        if (slotMap[originSlotIndex]) {
            return { name: slotMap[originSlotIndex], type: slotMap[originSlotIndex] };
        }
    }

    const slotDef = originNode.outputs?.[originSlotIndex];
    const rawSlotLabel = slotDef?.label || slotDef?.name;

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

    if (originNode.title && originNode.title !== originNode.type && originNode.title !== originNode.comfyClass) {
        const cleanTitle = sanitizeAndTruncateText(originNode.title, 16);
        const slotType = slotDef?.type || "*";
        return { name: cleanTitle, type: slotType };
    }

    if (rawSlotLabel && rawSlotLabel !== "◦" && rawSlotLabel !== "") {
        return {
            name: sanitizeAndTruncateText(rawSlotLabel, 16),
            type: slotDef?.type || "*"
        };
    }

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
    const allNodes = [];

    function collectNodes(targetGraph) {
        if (!targetGraph) return;
        const nodes = targetGraph._nodes || targetGraph.nodes || [];
        for (const n of nodes) {
            allNodes.push(n);
            if (n?.subgraph) collectNodes(n.subgraph);
        }
    }
    collectNodes(app.graph);

    for (const node of allNodes) {
        if (!node) continue;

        if (node.type === "SSGSmartPipe" || node.type === "SSGSmartRouter" || node.type === "SSGSmartVault") {
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

export function registerChannel(channelName, tracks, explicitGen = null, is_editing = false) {
    if (!channelName || channelName === "UNASSIGNED") return;

    const currentRecord = window.SSG_PipeRegistry[channelName] || { generation: 0 };
    const nextGen = explicitGen !== null ? explicitGen : currentRecord.generation + 1;

    window.SSG_PipeRegistry[channelName] = {
        tracks: [...tracks],
        generation: nextGen,
        is_editing: is_editing,
        timestamp: Date.now()
    };
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

        const allNodes = [];

        function collectNodes(targetGraph) {
            if (!targetGraph) return;
            const nodes = targetGraph._nodes || targetGraph.nodes || [];
            for (const n of nodes) {
                allNodes.push(n);
                if (n?.subgraph) collectNodes(n.subgraph);
            }
        }

        collectNodes(app.graph);

        for (const node of allNodes) {
            if (
                node.type === "SSGSmartSatellite" &&
                typeof node._ssgRefreshDropdown === "function"
            ) {
                node._ssgRefreshDropdown();
            }
        }

        app.graph.setDirtyCanvas(true, true);
    }
}

export function hydrateSSGNetwork(app) {
    if (!app?.graph) return;
    const allNodes = [];

    function collectNodes(targetGraph) {
        if (!targetGraph) return;
        const nodes = targetGraph._nodes || targetGraph.nodes || [];
        for (const n of nodes) {
            allNodes.push(n);
            if (n?.subgraph) collectNodes(n.subgraph);
        }
    }
    collectNodes(app.graph);

    for (const node of allNodes) {
        if (!node) continue;

        if (node.type === "SSGSmartPipe" || node.type === "SSGSmartRouter" || node.type === "SSGSmartVault") {
            const isLocked = node.properties?.is_locked === true;
            if (isLocked) {
                node._isEditMode = false;
                const channelName = node.properties?.channel_id;
                const manifestStr = node.properties?.pipe_manifest || node.properties?.router_manifest || node.properties?.vault_manifest;
                const genW = node.widgets?.find(w => w.name === "schema_generation");

                if (channelName && manifestStr) {
                    try {
                        const tracks = JSON.parse(manifestStr);
                        registerChannel(channelName, tracks, genW?.value || 1, false);
                    } catch (e) {
                        console.warn("[SSG] Failed to parse manifest during hydration:", e);
                    }
                }
            }
        }
    }

    for (const node of allNodes) {
        if (!node) continue;
        if (node.type === "SSGSmartSatellite") {
            const channelW = node.widgets?.find(w => w.name === "channel");
            const targetChannel = channelW?.value;
            if (targetChannel && window.SSG_PipeRegistry[targetChannel]) {
                const record = window.SSG_PipeRegistry[targetChannel];
                node._ssgBoundGeneration = record.generation;
            }
        }
    }

    app.graph.setDirtyCanvas(true, true);
}