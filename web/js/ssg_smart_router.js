// ==========================================================================
// SSG CUSTOM NODE ECOSYSTEM (V4 ARCHITECTURE)
// Module: SSG Smart Router (Dual-Bank A/B Multi-Track Broadcaster)
// File: /web/js/ssg_smart_router.js
// ==========================================================================

import {
    SSG_DEFAULT_WIDTH,
    SSG_COLOR_ICE_BLUE,
    SSG_COLOR_YELLOW_TOPAZ,
    SSG_COLOR_RUBY_RED,
    SSG_COLOR_MUTED,
    findTrueUpstreamAnchor,
    findGraphAndNode,
    registerChannel,
    isChannelBypassed,
    forceNetworkUpdate,
    syncIncomingProperties,
    getAllGraphNodes,
    updateNodeBounds
} from "./ssg_core_utils.js";
import { createSSGDOMBanner, SSG_COLOR_NOMINAL } from "./ssg_dom_banner.js";

function isRouterBankB(val) {
    return val === true || val === "Bank B" || val === "B" || val === 1 || val === "1";
}

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
 * Anti-LoRA Intercept Sniffer:
 * Traverses upstream through any active router input connections and reroute chains.
 * If an SSGLoraLoader is detected upstream of the Router before prompt encoding,
 * flags an illegal architectural intercept.
 */
function checkUpstreamIllegalLoRA(app, node) {
    if (!node.inputs || node.inputs.length === 0) return false;

    for (const input of node.inputs) {
        if (input.link !== null && input.link !== undefined) {
            const link = getGraphLink(app, node, input.link);
            if (link && link.origin_id != null) {
                const search = findGraphAndNode(app, node, link.origin_id);
                if (search && search.node) {
                    let current = search.node;
                    const visited = new Set();

                    // Trace through recursive intermediate Reroutes to true anchor
                    while (current && current.type === "Reroute" && !visited.has(current)) {
                        visited.add(current);
                        const rLink = current.inputs?.[0]?.link;
                        if (rLink !== null && rLink !== undefined) {
                            const upLink = getGraphLink(app, current, rLink);
                            if (upLink && upLink.origin_id != null) {
                                const upSearch = findGraphAndNode(app, current, upLink.origin_id);
                                current = upSearch ? upSearch.node : null;
                            } else {
                                current = null;
                            }
                        } else {
                            current = null;
                        }
                    }

                    if (current) {
                        const candidateType = current.type || current.comfyClass || "";
                        if (candidateType === "SSGLoraLoader" || candidateType === "SSG_LoraLoader") {
                            return true;
                        }
                    }
                }
            }
        }
    }

    return false;
}

function getNextSequentialRouterName(app, currentNode) {
    const basePrefix = "SSG_Router_";
    let highestIndex = 0;

    const allNodes = app?.graph ? getAllGraphNodes(app.graph) : [];

    for (const n of allNodes) {
        if (n && n.type === "SSGSmartRouter" && n !== currentNode) {
            const val = n.properties?.channel_id;
            if (val && val.startsWith(basePrefix)) {
                const num = parseInt(val.substring(basePrefix.length), 10);
                if (!isNaN(num) && num > highestIndex) {
                    highestIndex = num;
                }
            }
        }
    }

    return `${basePrefix}${highestIndex + 1}`;
}

export function setupSmartRouter(nodeType, nodeData, app) {
    const origClone = nodeType.prototype.clone;
    nodeType.prototype.clone = function () {
        const clonedNode = origClone ? origClone.apply(this, arguments) : null;
        if (clonedNode) {
            clonedNode._isEditMode = true;
            if (!clonedNode.properties) clonedNode.properties = {};
            clonedNode.properties.is_locked = false;
            clonedNode.properties.router_manifest = "";
            clonedNode.properties.channel_id = getNextSequentialRouterName(app, clonedNode);
        }
        return clonedNode;
    };

    const origOnConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function (info) {
        syncIncomingProperties(this, info);

        if (origOnConfigure) origOnConfigure.apply(this, arguments);

        const node = this;
        node.properties = node.properties || {};

        const genW = node.widgets?.find(w => w.name === "schema_generation");
        const manifestVal = node.properties.router_manifest;
        const channelName = node.properties.channel_id;

        if (node.properties.is_locked) {
            node._isEditMode = false;
            const lockBtn = node.widgets?.find(w => w.name === "[ Lock Schema ]" || w.name === "[ Edit Schema ]");
            if (lockBtn) {
                lockBtn.name = "[ Edit Schema ]";
                lockBtn.label = "[ Edit Schema ]";
                lockBtn.triggerDraw?.();
            }

            let savedTracks = [];
            try {
                savedTracks = JSON.parse(manifestVal || "[]");
            } catch (e) {
                savedTracks = [];
            }

            while (node.outputs && node.outputs.length > 0) {
                node.removeOutput(0);
            }
            node.outputs = [];

            const totalSlots = savedTracks.length * 2;
            while (node.inputs && node.inputs.length < totalSlots) {
                const idx = node.inputs.length;
                node.addInput(`Slot_${idx}`, "*");
            }
            while (node.inputs && node.inputs.length > totalSlots) {
                node.removeInput(node.inputs.length - 1);
            }

            if (node.inputs) {
                savedTracks.forEach((track, i) => {
                    const idxA = i * 2;
                    const idxB = (i * 2) + 1;
                    const cleanName = track.name || `Track_${i}`;
                    const cleanType = track.type || "*";

                    if (node.inputs[idxA]) {
                        node.inputs[idxA].name = `SSG_${i}_A`;
                        node.inputs[idxA].label = `${cleanName} (A)`;
                        node.inputs[idxA].type = cleanType;
                    }
                    if (node.inputs[idxB]) {
                        node.inputs[idxB].name = `SSG_${i}_B`;
                        node.inputs[idxB].label = `${cleanName} (B)`;
                        node.inputs[idxB].type = cleanType;
                    }
                });
            }

            node.properties.router_manifest = JSON.stringify(savedTracks);

            if (channelName && savedTracks.length > 0) {
                registerChannel(channelName, savedTracks, genW?.value || 1, false, false);
            }

            const targetHeight = Math.max(120, (savedTracks.length * 40) + 115);
            updateNodeBounds(node, SSG_DEFAULT_WIDTH, targetHeight);
        } else {
            node._isEditMode = true;
            if (node.refreshSlotLayout) {
                node.refreshSlotLayout();
            }
        }

        if (typeof node.updateRouterBannerState === "function") {
            node.updateRouterBannerState();
        }

        setTimeout(() => {
            forceNetworkUpdate(app);
            if (node.graph) node.graph.setDirtyCanvas(true, true);
        }, 50);
    };

    const origOnNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
        if (origOnNodeCreated) origOnNodeCreated.apply(this, arguments);

        const node = this;
        node.properties = node.properties || {};
        node.properties.is_locked = false;
        node._isEditMode = true;

        if (!node.properties.channel_id) {
            node.properties.channel_id = getNextSequentialRouterName(app, node);
        }

        if (node.properties.router_manifest === undefined) {
            node.properties.router_manifest = "";
        }

        while (node.outputs && node.outputs.length > 0) {
            node.removeOutput(0);
        }

        while (node.inputs && node.inputs.length > 2) {
            node.removeInput(node.inputs.length - 1);
        }
        while (node.inputs && node.inputs.length < 2) {
            node.addInput(`Slot_${node.inputs.length}`, "*");
        }

        node.inputs[0].name = "SSG_0_A";
        node.inputs[0].label = "Track_0 (A)";
        node.inputs[0].type = "*";

        node.inputs[1].name = "SSG_0_B";
        node.inputs[1].label = "Track_0 (B)";
        node.inputs[1].type = "*";

        let switchWidget = node.widgets?.find(w => w.name === "router_switch");

        const domBannerWidget = createSSGDOMBanner(node, {
            widgetName: "channel_display",
            initialText: `CH: ${node.properties.channel_id} [Edit Mode]`,
            initialColor: SSG_COLOR_YELLOW_TOPAZ,
            initialBadge: "[A]",
            badgeColor: SSG_COLOR_YELLOW_TOPAZ
        });

        node.updateRouterBannerState = function () {
            const chanId = node.properties?.channel_id || "UNASSIGNED";
            const swW = node.widgets?.find(w => w.name === "router_switch");
            const isBankB = isRouterBankB(swW?.value);
            const isBypassed = isChannelBypassed(chanId);
            const hasIllegalLoRA = checkUpstreamIllegalLoRA(app, node);

            let displayText = `CH: ${chanId}`;
            let bannerColor = SSG_COLOR_NOMINAL; // Tier 0 Nominal: Native ComfyUI
            let subBadge = isBankB ? "[B]" : "[A]";
            let badgeColor = isBankB ? SSG_COLOR_ICE_BLUE : SSG_COLOR_NOMINAL;

            if (hasIllegalLoRA) {
                // Tier 3 Red Alert: Architectural Lockout
                displayText = "[ILLEGAL INTERCEPT: ROUTER CANNOT PRECEDE PROMPT ENCODER]";
                bannerColor = SSG_COLOR_RUBY_RED;
                subBadge = null;
                badgeColor = null;
            } else if (isBypassed) {
                displayText = "Injection Bypass Detected";
                bannerColor = SSG_COLOR_MUTED;
                subBadge = null;
                badgeColor = null;
            } else if (node._isEditMode) {
                displayText = `CH: ${chanId} [Edit Mode]`;
                bannerColor = SSG_COLOR_YELLOW_TOPAZ;
                badgeColor = isBankB ? SSG_COLOR_ICE_BLUE : SSG_COLOR_YELLOW_TOPAZ;
            }

            if (typeof node.updateSSGBanner === "function") {
                node.updateSSGBanner(displayText, bannerColor, subBadge, badgeColor);
            }
        };

        const genWidget = node.widgets?.find(w => w.name === "schema_generation");

        node.refreshSlotLayout = function () {
            if (node._isRefreshingSlots) return;
            node._isRefreshingSlots = true;

            try {
                while (node.outputs && node.outputs.length > 0) {
                    node.removeOutput(0);
                }

                const channelName = node.properties.channel_id;

                if (node._isEditMode) {
                    let connectedPairs = 0;
                    const totalInputs = node.inputs ? node.inputs.length : 0;
                    const currentTrackCount = Math.floor(totalInputs / 2);

                    for (let i = 0; i < currentTrackCount; i++) {
                        const inA = node.inputs[i * 2];
                        const inB = node.inputs[(i * 2) + 1];
                        const hasLinkA = inA && inA.link !== null && inA.link !== undefined;
                        const hasLinkB = inB && inB.link !== null && inB.link !== undefined;

                        if (hasLinkA || hasLinkB) {
                            connectedPairs = i + 1;
                        }
                    }

                    const targetTrackCount = Math.min(12, connectedPairs + 1);
                    const targetInputCount = targetTrackCount * 2;

                    while (node.inputs.length < targetInputCount) {
                        const idx = node.inputs.length;
                        node.addInput(`Slot_${idx}`, "*");
                    }
                    while (node.inputs.length > targetInputCount) {
                        node.removeInput(node.inputs.length - 1);
                    }

                    const currentTracks = [];
                    for (let i = 0; i < targetTrackCount; i++) {
                        const idxA = i * 2;
                        const idxB = (i * 2) + 1;
                        const inA = node.inputs[idxA];
                        const inB = node.inputs[idxB];

                        inA.name = `SSG_${i}_A`;
                        inB.name = `SSG_${i}_B`;

                        let trackName = `Track_${i}`;
                        let trackType = "*";

                        if (inA.link !== null && inA.link !== undefined) {
                            const link = getGraphLink(app, node, inA.link);
                            if (link) {
                                const resolved = findTrueUpstreamAnchor(app, node, link.origin_id, link.origin_slot);
                                trackName = resolved.name;
                                trackType = resolved.type;
                            }
                        } else if (inB.link !== null && inB.link !== undefined) {
                            const link = getGraphLink(app, node, inB.link);
                            if (link) {
                                const resolved = findTrueUpstreamAnchor(app, node, link.origin_id, link.origin_slot);
                                trackName = resolved.name;
                                trackType = resolved.type;
                            }
                        }

                        inA.label = `${trackName} (A)`;
                        inA.type = trackType;

                        inB.label = `${trackName} (B)`;
                        inB.type = trackType;

                        currentTracks.push({ index: i, name: trackName, type: trackType });
                    }

                    node.properties.router_manifest = JSON.stringify(currentTracks);

                    if (channelName) {
                        registerChannel(channelName, currentTracks, genWidget?.value || 1, true, false);
                    }
                } else {
                    let savedTracks = [];
                    try {
                        savedTracks = JSON.parse(node.properties.router_manifest || "[]");
                    } catch (e) {
                        savedTracks = [];
                    }

                    const targetTrackCount = savedTracks.length;
                    const targetInputCount = targetTrackCount * 2;

                    while (node.inputs.length < targetInputCount) {
                        const idx = node.inputs.length;
                        node.addInput(`Slot_${idx}`, "*");
                    }
                    while (node.inputs.length > targetInputCount) {
                        node.removeInput(node.inputs.length - 1);
                    }

                    savedTracks.forEach((track, i) => {
                        const idxA = i * 2;
                        const idxB = (i * 2) + 1;
                        const inA = node.inputs[idxA];
                        const inB = node.inputs[idxB];

                        inA.name = `SSG_${i}_A`;
                        inB.name = `SSG_${i}_B`;

                        inA.label = `${track.name || `Track_${i}`} (A)`;
                        inA.type = track.type || "*";

                        inB.label = `${track.name || `Track_${i}`} (B)`;
                        inB.type = track.type || "*";
                    });

                    node.properties.router_manifest = JSON.stringify(savedTracks);

                    if (channelName) {
                        registerChannel(channelName, savedTracks, genWidget?.value || 1, false, false);
                    }
                }

                const targetHeight = Math.max(120, ((node.inputs.length / 2) * 40) + 115);
                updateNodeBounds(node, SSG_DEFAULT_WIDTH, targetHeight);
                node.updateRouterBannerState();
            } finally {
                node._isRefreshingSlots = false;
            }
        };

        const lockButton = {
            type: "button",
            name: node._isEditMode ? "[ Lock Schema ]" : "[ Edit Schema ]",
            label: node._isEditMode ? "[ Lock Schema ]" : "[ Edit Schema ]",
            value: null,
            callback: () => {
                // Pre-lock illegal LoRA check: Prevent locking if illegal intercept exists
                if (node._isEditMode && checkUpstreamIllegalLoRA(app, node)) {
                    node.updateRouterBannerState();
                    return;
                }

                node._isEditMode = !node._isEditMode;
                node.properties.is_locked = !node._isEditMode;

                const nextLabel = node._isEditMode ? "[ Lock Schema ]" : "[ Edit Schema ]";
                lockButton.name = nextLabel;
                lockButton.label = nextLabel;

                if (typeof node.onWidgetChanged === "function") {
                    node.onWidgetChanged(lockButton.name, lockButton.value, null, lockButton);
                }

                if (!node._isEditMode) {
                    const totalInputs = node.inputs ? node.inputs.length : 0;
                    const trackCount = Math.floor(totalInputs / 2);
                    const validTracks = [];

                    for (let i = 0; i < trackCount; i++) {
                        const inA = node.inputs[i * 2];
                        const inB = node.inputs[(i * 2) + 1];
                        const hasLinkA = inA && inA.link !== null && inA.link !== undefined;
                        const hasLinkB = inB && inB.link !== null && inB.link !== undefined;

                        if (hasLinkA || hasLinkB) {
                            let cleanName = `Track_${validTracks.length}`;
                            let cleanType = "*";

                            if (hasLinkA) {
                                const link = getGraphLink(app, node, inA.link);
                                if (link) {
                                    const res = findTrueUpstreamAnchor(app, node, link.origin_id, link.origin_slot);
                                    cleanName = res.name;
                                    cleanType = res.type;
                                }
                            } else if (hasLinkB) {
                                const link = getGraphLink(app, node, inB.link);
                                if (link) {
                                    const res = findTrueUpstreamAnchor(app, node, link.origin_id, link.origin_slot);
                                    cleanName = res.name;
                                    cleanType = res.type;
                                }
                            }

                            validTracks.push({
                                index: validTracks.length,
                                name: cleanName,
                                type: cleanType
                            });
                        }
                    }

                    node.properties.router_manifest = JSON.stringify(validTracks);

                    if (genWidget) {
                        genWidget.value = (genWidget.value || 0) + 1;
                    }

                    const channelName = node.properties.channel_id;
                    if (channelName) {
                        registerChannel(channelName, validTracks, genWidget?.value || 1, false, false);
                    }
                }

                node.refreshSlotLayout();
                node.updateRouterBannerState();

                lockButton.triggerDraw?.();
                node.setDirtyCanvas(true, true);

                if (node.graph) {
                    node.graph._version = (node.graph._version || 0) + 1;
                    if (typeof node.graph.change === "function") {
                        node.graph.change();
                    }
                }
                app.canvas?.setDirty(true, true);

                if (typeof app.canvas?.draw === "function") {
                    app.canvas.draw(true, true);
                }
                requestAnimationFrame(() => {
                    app.canvas?.draw?.(true, true);
                });

                forceNetworkUpdate(app);
            }
        };

        if (!switchWidget) {
            switchWidget = node.addWidget(
                "toggle",
                "router_switch",
                false,
                (val) => {
                    node.updateRouterBannerState();
                    forceNetworkUpdate(app);
                    if (node.graph) {
                        node.graph._version = (node.graph._version || 0) + 1;
                        node.graph.setDirtyCanvas(true, true);
                    }
                },
                { on: "Bank B", off: "Bank A" }
            );
        } else {
            const origSwitchCb = switchWidget.callback;
            switchWidget.callback = function (val) {
                const isBankB = isRouterBankB(val);
                if (origSwitchCb) origSwitchCb.call(this, isBankB);
                node.updateRouterBannerState();
                forceNetworkUpdate(app);
                if (node.graph) {
                    node.graph._version = (node.graph._version || 0) + 1;
                    node.graph.setDirtyCanvas(true, true);
                }
            };
        }

        const remainingWidgets = (node.widgets || []).filter(
            w => w !== switchWidget && w !== domBannerWidget && w !== lockButton
        );
        node.widgets = [domBannerWidget, lockButton, ...remainingWidgets, switchWidget].filter(Boolean);

        node.onConnectionsChange = function () {
            if (node._isEditMode) {
                node.refreshSlotLayout();
            }
            node.updateRouterBannerState();
        };

        node.refreshSlotLayout();
        node.updateRouterBannerState();
        updateNodeBounds(node, SSG_DEFAULT_WIDTH, 140);

        setTimeout(() => {
            forceNetworkUpdate(app);
            if (node.graph) node.graph.setDirtyCanvas(true, true);
        }, 50);
    };

    const origOnRemoved = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
        if (origOnRemoved) origOnRemoved.apply(this, arguments);

        const node = this;
        const chanId = node.properties?.channel_id;

        if (chanId && window.SSG_PipeRegistry && window.SSG_PipeRegistry[chanId]) {
            delete window.SSG_PipeRegistry[chanId];
        }

        setTimeout(() => {
            forceNetworkUpdate(app);
        }, 30);
    };

    const origOnDrawForeground = nodeType.prototype.onDrawForeground;
    nodeType.prototype.onDrawForeground = function (ctx) {
        if (origOnDrawForeground) origOnDrawForeground.apply(this, arguments);
    };
}