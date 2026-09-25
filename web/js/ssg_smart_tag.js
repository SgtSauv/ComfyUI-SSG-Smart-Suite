// ==========================================================================
// SSG CUSTOM NODE ECOSYSTEM (V4 ARCHITECTURE)
// Module: SSG Smart Tag (Boundary Namer & Type Normalizer)
// File: /web/js/ssg_smart_tag.js
// ==========================================================================

import {
    SSG_DEFAULT_WIDTH,
    SSG_COLOR_YELLOW_TOPAZ,
    SSG_COLOR_FIRE_OPAL,
    sanitizeAndTruncateText,
    findTrueUpstreamAnchor,
    findGraphAndNode,
    syncIncomingProperties,
    updateNodeBounds,
    forceNetworkUpdate
} from "./ssg_core_utils.js";
import { createSSGDOMBanner, SSG_COLOR_NOMINAL } from "./ssg_dom_banner.js";

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
    const origOnConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function (info) {
        syncIncomingProperties(this, info);

        if (origOnConfigure) origOnConfigure.apply(this, arguments);

        const node = this;
        node.properties = node.properties || {};

        if (typeof node.updateTagSlotState === "function") {
            node.updateTagSlotState();
        }

        updateNodeBounds(node, SSG_DEFAULT_WIDTH, 110);

        // Phase 2 Deserialization Guard: Wait for LiteGraph to populate graph.links
        setTimeout(() => {
            if (typeof node.updateTagSlotState === "function") {
                node.updateTagSlotState();
            }
            notifyDownstreamTargets(app, node);
            if (node.graph) node.graph.setDirtyCanvas(true, true);
        }, 60);
    };

    const origOnNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
        if (origOnNodeCreated) origOnNodeCreated.apply(this, arguments);

        const node = this;
        node.properties = node.properties || {};

        // Extract pre-instantiated widgets created by ComfyUI core
        const tagWidget = node.widgets?.find(w => w.name === "tag_name" || w.name === "tag");
        const typeWidget = node.widgets?.find(w => w.name === "type_override");

        // Slot 0: Native DOM Status Banner Widget
        const domBannerWidget = createSSGDOMBanner(node, {
            widgetName: "channel_display",
            initialText: "Tag : *",
            initialColor: SSG_COLOR_YELLOW_TOPAZ
        });

        // Slot 1 & 2: Parameter Controls Bindings
        if (tagWidget) {
            const origCallback = tagWidget.callback;
            tagWidget.callback = function (v) {
                const clean = sanitizeAndTruncateText(v, 16);
                if (clean !== v) {
                    tagWidget.value = clean;
                }
                node.properties.tag_name = clean;
                if (node.outputs?.[0]) {
                    node.outputs[0].name = clean || "◦";
                }
                if (origCallback) origCallback.apply(this, arguments);

                if (node.updateTagSlotState) node.updateTagSlotState();
                notifyDownstreamTargets(app, node);
                if (node.graph) node.graph.setDirtyCanvas(true, true);
                forceNetworkUpdate(app);
            };
        }

        if (typeWidget) {
            const origTypeCallback = typeWidget.callback;
            typeWidget.callback = function (v) {
                if (node.updateTagSlotState) node.updateTagSlotState();
                if (origTypeCallback) origTypeCallback.apply(this, arguments);

                notifyDownstreamTargets(app, node);
                if (node.graph) node.graph.setDirtyCanvas(true, true);
                forceNetworkUpdate(app);
            };
        }

        // Dynamic Type Latching & Validation Engine (Synchronous Single Source of Truth)
        node.updateTagSlotState = function () {
            const inp = node.inputs?.[0];
            const out = node.outputs?.[0];
            const overrideType = typeWidget?.value || "AUTO";
            const linkId = inp?.link;

            let upstreamType = "*";
            let hasCollision = false;
            const isConnected = linkId !== null && linkId !== undefined;

            if (isConnected) {
                const link = getGraphLink(app, node, linkId);
                if (link) {
                    const resolved = findTrueUpstreamAnchor(app, node, link.origin_id, link.origin_slot);
                    upstreamType = resolved.type || "*";

                    if (tagWidget && (!tagWidget.value || tagWidget.value === "Tag_1" || tagWidget.value === "Tag")) {
                        const cleanResolvedName = sanitizeAndTruncateText(resolved.name || "Tag", 16);
                        tagWidget.value = cleanResolvedName;
                        node.properties.tag_name = cleanResolvedName;
                    }
                }
            }

            let resolvedType = "*";
            if (overrideType && overrideType !== "AUTO" && overrideType !== "*") {
                resolvedType = overrideType;
                if (upstreamType !== "*" && overrideType !== upstreamType) {
                    hasCollision = true;
                }
            } else {
                resolvedType = upstreamType;
            }

            const cleanName = sanitizeAndTruncateText(tagWidget?.value || node.properties?.tag_name || "Tag", 12);
            const cleanType = sanitizeAndTruncateText(resolvedType || "*", 10);
            const displayText = `${cleanName} : ${cleanType}`;

            let bannerColor = SSG_COLOR_NOMINAL;
            if (hasCollision) {
                bannerColor = SSG_COLOR_FIRE_OPAL;
            } else if (!isConnected || (cleanType === "*" && overrideType === "AUTO")) {
                bannerColor = SSG_COLOR_YELLOW_TOPAZ;
            } else {
                bannerColor = SSG_COLOR_NOMINAL;
            }

            if (inp) inp.type = resolvedType;
            if (out) {
                out.type = resolvedType;
                out.name = tagWidget?.value || "◦";
            }

            // Direct synchronous repaint of the native DOM Status Banner
            if (typeof node.updateSSGBanner === "function") {
                node.updateSSGBanner(displayText, bannerColor);
            }
        };

        // Deterministic Slot Assembly: [Slot 0: DOM Banner, Slot 1: Tag Name, Slot 2: Type Override, ...Remaining]
        const remainingWidgets = (node.widgets || []).filter(
            w => w !== domBannerWidget && w !== tagWidget && w !== typeWidget
        );
        node.widgets = [domBannerWidget, tagWidget, typeWidget, ...remainingWidgets].filter(Boolean);

        node.onConnectionsChange = function () {
            node.updateTagSlotState();
            notifyDownstreamTargets(app, node);
            forceNetworkUpdate(app);
        };

        node.updateTagSlotState();
        updateNodeBounds(node, SSG_DEFAULT_WIDTH, 110);
    };

    const origOnDrawForeground = nodeType.prototype.onDrawForeground;
    nodeType.prototype.onDrawForeground = function (ctx) {
        if (origOnDrawForeground) origOnDrawForeground.apply(this, arguments);
    };
}