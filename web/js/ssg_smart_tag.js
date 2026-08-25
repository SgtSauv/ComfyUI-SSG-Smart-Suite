// ==========================================================================
// SSG CUSTOM NODE ECOSYSTEM (V2 ARCHITECTURE)
// Module: SSG Smart Tag (Boundary Namer & Type Normalizer)
// File: /web/js/ssg_smart_tag.js
// ==========================================================================

import {
    SSG_DEFAULT_WIDTH,
    DIAGNOSTIC_TIERS,
    sanitizeAndTruncateText,
    applyDynamicShavePass,
    drawSSGWarningOutline,
    drawMasterGlobalTooltip,
    findTrueUpstreamAnchor,
    findGraphAndNode
} from "./ssg_core_utils.js";

/**
 * Multi-layer graph link finder supporting subgraphs, local graphs, and root graph maps.
 */
function getGraphLink(app, node, linkId) {
    if (linkId == null) return null;
    const strId = String(linkId);

    if (node?.graph?.links) {
        const localLinks = node.graph.links;
        if (Array.isArray(localLinks)) {
            const found = localLinks.find(l => l && String(l.id) === strId);
            if (found) return found;
        } else if (typeof localLinks === "object") {
            if (localLinks[linkId]) return localLinks[linkId];
            for (const k in localLinks) {
                if (localLinks[k] && String(localLinks[k].id) === strId) return localLinks[k];
            }
        }
    }

    if (app?.graph?.links) {
        const rootLinks = app.graph.links;
        if (Array.isArray(rootLinks)) {
            const found = rootLinks.find(l => l && String(l.id) === strId);
            if (found) return found;
        } else if (typeof rootLinks === "object") {
            if (rootLinks[linkId]) return rootLinks[linkId];
            for (const k in rootLinks) {
                if (rootLinks[k] && String(rootLinks[k].id) === strId) return rootLinks[k];
            }
        }
    }

    return null;
}

/**
 * Traverses downstream connections leaving this Tag and updates connected SSG nodes.
 * Recursively resolves through intermediate Reroute nodes.
 */
function notifyDownstreamTargets(app, tagNode) {
    if (!tagNode || !tagNode.outputs || !tagNode.outputs[0]) return;

    const outLinks = tagNode.outputs[0].links;
    if (!outLinks || outLinks.length === 0) return;

    const visitedNodes = new Set();

    function propagate(linkId) {
        const link = getGraphLink(app, tagNode, linkId);
        if (!link || link.target_id == null) return;

        const targetResult = findGraphAndNode(app, tagNode, link.target_id);
        if (!targetResult || !targetResult.node) return;

        const targetNode = targetResult.node;
        if (visitedNodes.has(targetNode)) return;
        visitedNodes.add(targetNode);

        if (targetNode.type === "Reroute") {
            if (targetNode.outputs && targetNode.outputs[0] && targetNode.outputs[0].links) {
                for (const rLink of targetNode.outputs[0].links) {
                    propagate(rLink);
                }
            }
            return;
        }

        if (targetNode.type && targetNode.type.startsWith("SSGSmart")) {
            if (targetNode._isEditMode && typeof targetNode.refreshSlotLayout === "function") {
                targetNode.refreshSlotLayout();
            } else if (targetNode.graph) {
                targetNode.graph.setDirtyCanvas(true, true);
            }
        }
    }

    for (const linkId of outLinks) {
        propagate(linkId);
    }
}

export function setupSmartTag(nodeType, nodeData, app) {
    const origOnNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
        if (origOnNodeCreated) origOnNodeCreated.apply(this, arguments);

        const node = this;

        // 1. Structural Baseline
        node.size = [SSG_DEFAULT_WIDTH, 60];
        node._ssgOriginalTitle = "SSG Smart Tag";

        // 2. Widget References & Validation
        const tagWidget = node.widgets?.find(w => w.name === "tag_name");
        const typeWidget = node.widgets?.find(w => w.name === "type_override");

        if (tagWidget) {
            const origCallback = tagWidget.callback;
            tagWidget.callback = function (v) {
                const clean = sanitizeAndTruncateText(v, 16);
                if (clean !== v) {
                    tagWidget.value = clean;
                }
                if (node.outputs?.[0]) {
                    node.outputs[0].name = clean || "◦";
                }
                if (origCallback) origCallback.apply(this, arguments);
                
                notifyDownstreamTargets(app, node);
                if (node.graph) node.graph.setDirtyCanvas(true, true);
            };
        }

        if (typeWidget) {
            const origTypeCallback = typeWidget.callback;
            typeWidget.callback = function (v) {
                if (node.updateTagSlotState) node.updateTagSlotState();
                if (origTypeCallback) origTypeCallback.apply(this, arguments);

                notifyDownstreamTargets(app, node);
                if (node.graph) node.graph.setDirtyCanvas(true, true);
            };
        }

        // 3. Dynamic Type Latching & Validation
        node.updateTagSlotState = function () {
            const linkId = node.inputs?.[0]?.link;
            const overrideType = typeWidget?.value || "AUTO";

            if (linkId !== null && linkId !== undefined) {
                const link = getGraphLink(app, node, linkId);
                if (link) {
                    const resolved = findTrueUpstreamAnchor(app, node, link.origin_id, link.origin_slot);

                    if (tagWidget && (!tagWidget.value || tagWidget.value === "Tag_1" || tagWidget.value === "Tag")) {
                        tagWidget.value = sanitizeAndTruncateText(resolved.name || "Tag", 16);
                    }

                    if (node.outputs?.[0]) {
                        node.outputs[0].type = overrideType === "AUTO" ? (resolved.type || "*") : overrideType;
                        node.outputs[0].name = tagWidget?.value || resolved.name || "◦";
                    }
                }
            } else {
                if (node.outputs?.[0]) {
                    node.outputs[0].type = overrideType === "AUTO" ? "*" : overrideType;
                    node.outputs[0].name = tagWidget?.value || "◦";
                }
            }
        };

        node.onConnectionsChange = function () {
            node.updateTagSlotState();
            notifyDownstreamTargets(app, node);
        };
    };

    // 4. Canvas Draw Pass: Outline Diagnostics, Shave Pass, & Collapsed Mini-Bar HUD
    const origOnDrawForeground = nodeType.prototype.onDrawForeground;
    nodeType.prototype.onDrawForeground = function (ctx) {
        if (origOnDrawForeground) origOnDrawForeground.apply(this, arguments);

        const node = this;

        // A. Shave Pass ("SSG Smart Tag" -> "Tag" when collapsed)
        applyDynamicShavePass(node);

        // B. Diagnostic Telemetry (Tier 2 Orange if forced override creates collision)
        let activeTier = DIAGNOSTIC_TIERS.TIER_0_NOMINAL;
        const typeWidget = node.widgets?.find(w => w.name === "type_override");
        const tagWidget = node.widgets?.find(w => w.name === "tag_name");

        if (node.inputs?.[0]?.link) {
            const link = getGraphLink(app, node, node.inputs[0].link);
            if (link) {
                const resolved = findTrueUpstreamAnchor(app, node, link.origin_id, link.origin_slot);
                const overrideType = typeWidget?.value;

                if (overrideType && overrideType !== "AUTO" && overrideType !== "*" && resolved.type && resolved.type !== "*") {
                    if (overrideType !== resolved.type) {
                        activeTier = DIAGNOSTIC_TIERS.TIER_2_ORANGE;
                    }
                }
            }
        }
        drawSSGWarningOutline(node, ctx, activeTier);

        // C. Collapsed Mini-Bar HUD Overlay (Left-Anchored Alienware Blue Badge)
        if (node.flags?.collapsed) {
            const tagName = sanitizeAndTruncateText(tagWidget?.value || "Tag", 16);
            const tagType = typeWidget?.value || "AUTO";
            const badgeLabel = `Tag: ${tagName} [${tagType}]`;
            drawMasterGlobalTooltip(node, ctx, app, badgeLabel);
        }
    };
}