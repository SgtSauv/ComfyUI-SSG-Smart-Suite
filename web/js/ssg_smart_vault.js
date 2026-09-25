// ==========================================================================
// SSG CUSTOM NODE ECOSYSTEM (V4 ARCHITECTURE)
// Module: SSG Smart Vault (State-Aware Latent Cache & Multi-Track Store)
// File: /web/js/ssg_smart_vault.js
// ==========================================================================

import {
    SSG_DEFAULT_WIDTH,
    SSG_COLOR_EMERALD_GREEN,
    SSG_COLOR_ICE_BLUE,
    SSG_COLOR_YELLOW_TOPAZ,
    SSG_COLOR_ELECTRIC_PURPLE,
    SSG_COLOR_MUTED,
    findTrueUpstreamAnchor,
    registerChannel,
    isChannelBypassed,
    forceNetworkUpdate,
    syncIncomingProperties,
    getAllGraphNodes,
    updateNodeBounds
} from "./ssg_core_utils.js";
import { createSSGDOMBanner, SSG_COLOR_NOMINAL } from "./ssg_dom_banner.js";

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

function getNextSequentialVaultName(app, currentNode) {
    const basePrefix = "SSG_Vault_";
    let highestIndex = 0;

    const allNodes = app?.graph ? getAllGraphNodes(app.graph) : [];

    for (const n of allNodes) {
        if (n && n.type === "SSGSmartVault" && n !== currentNode) {
            const val = n.properties?.channel_id || n.properties?.vault_id;
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

export function setupSmartVault(nodeType, nodeData, app) {
    const origClone = nodeType.prototype.clone;
    nodeType.prototype.clone = function () {
        const clonedNode = origClone ? origClone.apply(this, arguments) : null;
        if (clonedNode) {
            clonedNode._isEditMode = true;
            if (!clonedNode.properties) clonedNode.properties = {};
            clonedNode.properties.is_locked = false;
            clonedNode.properties.vault_manifest = "";
            clonedNode.properties.channel_id = getNextSequentialVaultName(app, clonedNode);
            clonedNode.properties.vault_id = clonedNode.properties.channel_id;
        }
        return clonedNode;
    };

    const origOnConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function (info) {
        syncIncomingProperties(this, info);

        if (origOnConfigure) origOnConfigure.apply(this, arguments);

        const node = this;
        node.properties = node.properties || {};

        if (node.properties.vault_id && !node.properties.channel_id) {
            node.properties.channel_id = node.properties.vault_id;
        }

        const genW = node.widgets?.find(w => w.name === "schema_generation");
        const manifestVal = node.properties.vault_manifest;
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

            while (node.inputs && node.inputs.length < savedTracks.length) {
                const idx = node.inputs.length;
                node.addInput(`SSG_${idx}`, "*");
                node.inputs[idx].label = "◦";
            }
            while (node.inputs && node.inputs.length > savedTracks.length) {
                node.removeInput(node.inputs.length - 1);
            }

            while (node.outputs && node.outputs.length < savedTracks.length) {
                const idx = node.outputs.length;
                node.addOutput(`SSG_${idx}`, "*");
                node.outputs[idx].label = "◦";
            }
            while (node.outputs && node.outputs.length > savedTracks.length) {
                node.removeOutput(node.outputs.length - 1);
            }

            if (node.inputs) {
                node.inputs.forEach((input, idx) => {
                    const track = savedTracks[idx];
                    if (track) {
                        input.name = `SSG_${idx}`;
                        input.label = track.name || `SSG_${idx}`;
                        input.type = track.type || "*";
                    }
                });
            }

            if (node.outputs) {
                node.outputs.forEach((output, idx) => {
                    const track = savedTracks[idx];
                    if (track) {
                        output.name = `SSG_${idx}`;
                        output.label = track.name || `SSG_${idx}`;
                        output.type = track.type || "*";
                    }
                });
            }

            node.properties.vault_manifest = JSON.stringify(savedTracks);

            if (channelName && savedTracks.length > 0) {
                registerChannel(channelName, savedTracks, genW?.value || 1, false, false);
            }

            const targetHeight = Math.max(120, (savedTracks.length * 20) + 140);
            updateNodeBounds(node, SSG_DEFAULT_WIDTH, targetHeight);
        } else {
            node._isEditMode = true;
            if (node.refreshSlotLayout) {
                node.refreshSlotLayout();
            }
        }

        if (typeof node.updateVaultBannerState === "function") {
            node.updateVaultBannerState();
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
            node.properties.channel_id = getNextSequentialVaultName(app, node);
            node.properties.vault_id = node.properties.channel_id;
        }

        if (node.properties.vault_manifest === undefined) {
            node.properties.vault_manifest = "";
        }

        while (node.inputs && node.inputs.length > 1) {
            node.removeInput(node.inputs.length - 1);
        }
        while (node.inputs && node.inputs.length < 1) {
            node.addInput("SSG_0", "*");
        }
        node.inputs[0].name = "SSG_0";
        node.inputs[0].label = "◦";
        node.inputs[0].type = "*";

        while (node.outputs && node.outputs.length > 1) {
            node.removeOutput(node.outputs.length - 1);
        }
        while (node.outputs && node.outputs.length < 1) {
            node.addOutput("SSG_0", "*");
        }
        node.outputs[0].name = "SSG_0";
        node.outputs[0].label = "◦";
        node.outputs[0].type = "*";

        let flushWidget = node.widgets?.find(w => w.name === "flush_switch");
        let cacheWidget = node.widgets?.find(w => w.name === "cache_switch");
        // Slot 0: Native DOM Status Banner Widget
        const domBannerWidget = createSSGDOMBanner(node, {
            widgetName: "channel_display",
            initialText: `CH: ${node.properties.channel_id} [Edit Mode]`,
            initialColor: SSG_COLOR_YELLOW_TOPAZ
        });

        node.updateVaultBannerState = function () {
            const chanId = node.properties?.channel_id || "UNASSIGNED";
            const flushW = node.widgets?.find(w => w.name === "flush_switch");
            const cacheW = node.widgets?.find(w => w.name === "cache_switch");
            const isBypassed = isChannelBypassed(chanId);

            let displayText = `CH: ${chanId}`;
            let bannerColor = SSG_COLOR_NOMINAL;

            if (isBypassed) {
                displayText = "Injection Bypass Detected";
                bannerColor = SSG_COLOR_MUTED;
            } else if (node._isEditMode) {
                displayText = `CH: ${chanId} [Edit Mode]`;
                bannerColor = SSG_COLOR_YELLOW_TOPAZ;
            } else if (cacheW && cacheW.value) {
                displayText = `CH: ${chanId} [Playback]`;
                bannerColor = SSG_COLOR_EMERALD_GREEN;
            } else if (flushW && flushW.value) {
                displayText = `CH: ${chanId} [Buffer]`;
                bannerColor = SSG_COLOR_ELECTRIC_PURPLE;
            } else {
                displayText = `CH: ${chanId} [Frozen]`;
                bannerColor = SSG_COLOR_ICE_BLUE;
            }

            if (typeof node.updateSSGBanner === "function") {
                node.updateSSGBanner(displayText, bannerColor);
            }
        };

        const genWidget = node.widgets?.find(w => w.name === "schema_generation");

        node.refreshSlotLayout = function () {
            if (node._isRefreshingSlots) return;
            node._isRefreshingSlots = true;

            try {
                const channelName = node.properties.channel_id;

                if (node._isEditMode) {
                    const connectedCount = node.inputs?.filter(i => i.link !== null && i.link !== undefined).length || 0;
                    const targetCount = Math.min(24, connectedCount + 1);

                    while (node.inputs.length < targetCount) {
                        const idx = node.inputs.length;
                        node.addInput(`SSG_${idx}`, "*");
                        node.inputs[idx].label = "◦";
                    }
                    while (node.inputs.length > targetCount && (node.inputs[node.inputs.length - 1].link === null || node.inputs[node.inputs.length - 1].link === undefined)) {
                        node.removeInput(node.inputs.length - 1);
                    }

                    while (node.outputs.length < node.inputs.length) {
                        const idx = node.outputs.length;
                        node.addOutput(`SSG_${idx}`, "*");
                        node.outputs[idx].label = "◦";
                    }
                    while (node.outputs.length > node.inputs.length) {
                        node.removeOutput(node.outputs.length - 1);
                    }

                    const currentTracks = [];
                    node.inputs.forEach((input, idx) => {
                        input.name = `SSG_${idx}`;
                        if (input.link !== null && input.link !== undefined) {
                            const link = getGraphLink(app, node, input.link);
                            if (link) {
                                const resolved = findTrueUpstreamAnchor(app, node, link.origin_id, link.origin_slot);
                                input.label = resolved.name;
                                input.type = resolved.type;
                                currentTracks.push({ index: idx, name: resolved.name, type: resolved.type });
                            }
                        } else {
                            input.label = "◦";
                            input.type = "*";
                        }

                        if (node.outputs[idx]) {
                            node.outputs[idx].name = `SSG_${idx}`;
                            node.outputs[idx].label = input.label;
                            node.outputs[idx].type = input.type;
                        }
                    });

                    node.properties.vault_manifest = JSON.stringify(currentTracks);

                    if (channelName) {
                        registerChannel(channelName, currentTracks, genWidget?.value || 1, true, false);
                    }
                } else {
                    let savedTracks = [];
                    try {
                        savedTracks = JSON.parse(node.properties.vault_manifest || "[]");
                    } catch (e) {
                        savedTracks = [];
                    }

                    const targetCount = savedTracks.length;

                    while (node.inputs.length < targetCount) {
                        const idx = node.inputs.length;
                        node.addInput(`SSG_${idx}`, "*");
                        node.inputs[idx].label = "◦";
                    }
                    while (node.inputs.length > targetCount) {
                        node.removeInput(node.inputs.length - 1);
                    }

                    while (node.outputs.length < targetCount) {
                        const idx = node.outputs.length;
                        node.addOutput(`SSG_${idx}`, "*");
                        node.outputs[idx].label = "◦";
                    }
                    while (node.outputs > targetCount) {
                        node.removeOutput(node.outputs.length - 1);
                    }

                    savedTracks.forEach((track, idx) => {
                        if (node.inputs[idx]) {
                            node.inputs[idx].name = `SSG_${idx}`;
                            node.inputs[idx].label = track.name || `SSG_${idx}`;
                            node.inputs[idx].type = track.type || "*";
                        }
                        if (node.outputs[idx]) {
                            node.outputs[idx].name = `SSG_${idx}`;
                            node.outputs[idx].label = track.name || `SSG_${idx}`;
                            node.outputs[idx].type = track.type || "*";
                        }
                    });

                    node.properties.vault_manifest = JSON.stringify(savedTracks);

                    if (channelName) {
                        registerChannel(channelName, savedTracks, genWidget?.value || 1, false, false);
                    }
                }

                const targetHeight = Math.max(120, (node.inputs.length * 20) + 140);
                updateNodeBounds(node, SSG_DEFAULT_WIDTH, targetHeight);
                node.updateVaultBannerState();
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
                node._isEditMode = !node._isEditMode;
                node.properties.is_locked = !node._isEditMode;

                const nextLabel = node._isEditMode ? "[ Lock Schema ]" : "[ Edit Schema ]";
                lockButton.name = nextLabel;
                lockButton.label = nextLabel;

                if (typeof node.onWidgetChanged === "function") {
                    node.onWidgetChanged(lockButton.name, lockButton.value, null, lockButton);
                }

                if (!node._isEditMode) {
                    for (let i = node.inputs.length - 1; i >= 0; i--) {
                        if (node.inputs[i].link === null || node.inputs[i].link === undefined) {
                            node.removeInput(i);
                            if (node.outputs[i]) node.removeOutput(i);
                        }
                    }

                    const currentTracks = [];
                    node.inputs.forEach((input, idx) => {
                        input.name = `SSG_${idx}`;
                        if (input.link !== null && input.link !== undefined) {
                            const link = getGraphLink(app, node, input.link);
                            if (link) {
                                const resolved = findTrueUpstreamAnchor(app, node, link.origin_id, link.origin_slot);
                                input.label = resolved.name;
                                input.type = resolved.type || "*";
                            }
                        }
                        currentTracks.push({ index: idx, name: input.label, type: input.type });

                        if (node.outputs[idx]) {
                            node.outputs[idx].name = `SSG_${idx}`;
                            node.outputs[idx].label = input.label;
                            node.outputs[idx].type = input.type;
                        }
                    });

                    node.properties.vault_manifest = JSON.stringify(currentTracks);

                    if (genWidget) {
                        genWidget.value = (genWidget.value || 0) + 1;
                    }

                    const channelName = node.properties.channel_id;
                    if (channelName) {
                        registerChannel(channelName, currentTracks, genWidget?.value || 1, false, false);
                    }
                }

                node.refreshSlotLayout();
                node.updateVaultBannerState();

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

        if (!flushWidget) {
            flushWidget = node.addWidget("toggle", "flush_switch", true, null, { on: "Flush On", off: "Flush Off" });
        }
        if (!cacheWidget) {
            cacheWidget = node.addWidget("toggle", "cache_switch", false, null, { on: "Playback", off: "Live Pass" });
        }

        const origFlushCb = flushWidget.callback;
        flushWidget.callback = function (v) {
            if (v && cacheWidget && cacheWidget.value) {
                cacheWidget.value = false;
            }
            if (origFlushCb) origFlushCb.apply(this, arguments);
            node.updateVaultBannerState();
            forceNetworkUpdate(app);
            if (node.graph) node.graph.setDirtyCanvas(true, true);
        };

        const origCacheCb = cacheWidget.callback;
        cacheWidget.callback = function (v) {
            if (v && flushWidget && flushWidget.value) {
                flushWidget.value = false;
            }
            if (origCacheCb) origCacheCb.apply(this, arguments);
            node.updateVaultBannerState();
            forceNetworkUpdate(app);
            if (node.graph) node.graph.setDirtyCanvas(true, true);
        };

        // Deterministic Slot Assembly: [Slot 0: Banner, Slot 1: Button, ...Remaining, Slot 3: Flush, Slot 4: Cache]
        const remainingWidgets = (node.widgets || []).filter(
            w => w !== domBannerWidget && w !== lockButton && w !== flushWidget && w !== cacheWidget
        );
        node.widgets = [domBannerWidget, lockButton, ...remainingWidgets, flushWidget, cacheWidget].filter(Boolean);

        node.onConnectionsChange = function () {
            if (node._isEditMode) {
                node.refreshSlotLayout();
            }
            node.updateVaultBannerState();
        };

        node.refreshSlotLayout();
        node.updateVaultBannerState();
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
        const chanId = node.properties?.channel_id || node.properties?.vault_id;

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