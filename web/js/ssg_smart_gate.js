// ==========================================================================
// SSG CUSTOM NODE ECOSYSTEM (V4 ARCHITECTURE)
// Module: SSG Smart Gate Trio (Master Gate, Gate Relay & Gate Return)
// File: /web/js/ssg_smart_gate.js
// ==========================================================================

import {
    SSG_DEFAULT_WIDTH,
    SSG_COLOR_YELLOW_TOPAZ,
    SSG_COLOR_FIRE_OPAL,
    SSG_COLOR_RUBY_RED,
    SSG_COLOR_MUTED,
    sanitizeAndTruncateText,
    findTrueUpstreamAnchor,
    registerChannel,
    registerGateLoopState,
    isChannelBypassed,
    getChannelRecord,
    scanActiveBroadcasters,
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

function getNextSequentialGateName(app, currentNode) {
    const basePrefix = "SSG_Gate_";
    let highestIndex = 0;

    const allNodes = app?.graph ? getAllGraphNodes(app.graph) : [];

    for (const n of allNodes) {
        if (n && n.type === "SSGSmartGate" && n !== currentNode) {
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

function refreshGateDropdown(node, app, targetSuffix) {
    const channelWidget = node.widgets?.find(w => w.name === "channel");
    if (!channelWidget) return;

    const activeBroadcasters = scanActiveBroadcasters(app);
    const validChannels = activeBroadcasters.filter(c => c.endsWith(targetSuffix));

    const currentVal = channelWidget.value;
    const boundVal = node.properties?.bound_channel || node._ssgBoundChannel;
    const channelSet = new Set(validChannels);

    if (currentVal && currentVal !== "Available" && currentVal !== "Unavailable" && currentVal !== "Default") {
        channelSet.add(currentVal);
    }
    if (boundVal && boundVal !== "Available" && boundVal !== "Unavailable" && boundVal !== "Default") {
        channelSet.add(boundVal);
    }

    const finalOptions = Array.from(channelSet);

    if (finalOptions.length === 0) {
        channelWidget.options = channelWidget.options || {};
        channelWidget.options.values = ["Unavailable"];
        if (boundVal) {
            channelWidget.value = boundVal;
        } else if (!node._isLoading && channelWidget.value !== "Unavailable") {
            channelWidget.value = "Unavailable";
        }
    } else {
        const menuOptions = ["Available", ...finalOptions];
        channelWidget.options = channelWidget.options || {};
        channelWidget.options.values = menuOptions;

        if (boundVal && finalOptions.includes(boundVal)) {
            channelWidget.value = boundVal;
        } else if (!channelWidget.value || channelWidget.value === "Unavailable" || channelWidget.value === "Default") {
            channelWidget.value = "Available";
        }
    }
}

// ==========================================================================
// 1. MASTER GATE (SSGSmartGate)
// ==========================================================================

export function setupSmartGate(nodeType, nodeData, app) {
    const origClone = nodeType.prototype.clone;
    nodeType.prototype.clone = function () {
        const clonedNode = origClone ? origClone.apply(this, arguments) : null;
        if (clonedNode) {
            clonedNode._isEditMode = true;
            if (!clonedNode.properties) clonedNode.properties = {};
            clonedNode.properties.is_locked = false;
            clonedNode.properties.gate_manifest = "";
            clonedNode.properties.channel_id = getNextSequentialGateName(app, clonedNode);
            clonedNode.properties.injection_loop = true;
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
        const injectWidget = node.widgets?.find(w => w.name === "injection_loop");
        const manifestVal = node.properties.gate_manifest;
        const channelName = node.properties.channel_id;

        const isLoopActive = (node.properties.injection_loop !== undefined)
            ? !!node.properties.injection_loop
            : (injectWidget ? !!injectWidget.value : true);

        node.properties.injection_loop = isLoopActive;
        if (injectWidget) {
            injectWidget.value = isLoopActive;
        }

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

            node.properties.gate_manifest = JSON.stringify(savedTracks);

            if (channelName && savedTracks.length > 0) {
                registerChannel(`${channelName}_TX`, savedTracks, genW?.value || 1, false, !isLoopActive);
                registerChannel(`${channelName}_RX`, savedTracks, genW?.value || 1, false, !isLoopActive);
                registerGateLoopState(channelName, isLoopActive);
            }

            const targetHeight = Math.max(120, (savedTracks.length * 20) + 115);
            updateNodeBounds(node, SSG_DEFAULT_WIDTH, targetHeight);
        } else {
            node._isEditMode = true;
            if (node.refreshSlotLayout) {
                node.refreshSlotLayout();
            }
        }

        if (typeof node.updateGateBannerState === "function") {
            node.updateGateBannerState();
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
            node.properties.channel_id = getNextSequentialGateName(app, node);
        }

        if (node.properties.gate_manifest === undefined) {
            node.properties.gate_manifest = "";
        }

        if (node.properties.injection_loop === undefined) {
            node.properties.injection_loop = true;
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

        let injectWidget = node.widgets?.find(w => w.name === "injection_loop");

        // Slot 0: Native DOM Status Banner Widget
        const domBannerWidget = createSSGDOMBanner(node, {
            widgetName: "channel_display",
            initialText: `CH: ${node.properties.channel_id} [Edit Mode]`,
            initialColor: SSG_COLOR_YELLOW_TOPAZ
        });

        node.updateGateBannerState = function () {
            const chanId = node.properties?.channel_id || "UNASSIGNED";
            const isBypassed = isChannelBypassed(chanId);
            const isInjecting = !!node.properties?.injection_loop;

            let displayText = `CH: ${chanId}`;
            let bannerColor = SSG_COLOR_NOMINAL; // Tier 0 Nominal: Native ComfyUI

            if (node._isEditMode) {
                displayText = `CH: ${chanId} [Edit Mode]`;
                bannerColor = SSG_COLOR_YELLOW_TOPAZ;
            } else if (isBypassed) {
                displayText = "Injection Bypass Detected";
                bannerColor = SSG_COLOR_MUTED;
            } else {
                let hasCriticalFault = false;
                let criticalMsg = "";
                let hasDesync = false;
                let desyncMsg = "";

                // 1. Primary Locked Input Integrity Audit
                const trackInputs = node.inputs?.filter(inp => inp && inp.type !== -1 && inp.widget === undefined) || [];
                if (trackInputs.length > 0 && trackInputs.some(i => i.link === null || i.link === undefined)) {
                    hasCriticalFault = true;
                    criticalMsg = `CH: ${chanId} [Input Unlinked]`;
                }

                // 2. Hardware Loop & Affiliate Integrity Audit
                if (isInjecting) {
                    const allNodes = app?.graph ? getAllGraphNodes(app.graph) : [];
                    const rxChan = `${chanId}_RX`;
                    const txChan = `${chanId}_TX`;
                    const returnNode = allNodes.find(n => n && n.type === "SSGSmartGateReturn" && (n.properties?.bound_channel === rxChan || n.widgets?.find(w => w.name === "channel")?.value === rxChan));
                    const relayNode = allNodes.find(n => n && n.type === "SSGSmartGateRelay" && (n.properties?.bound_channel === txChan || n.widgets?.find(w => w.name === "channel")?.value === txChan));

                    if (!returnNode || !relayNode) {
                        if (!hasCriticalFault) {
                            hasCriticalFault = true;
                            criticalMsg = `CH: ${chanId} [Pair Missing]`;
                        }
                    } else {
                        const returnInputs = returnNode.inputs?.filter(inp => inp && inp.type !== -1 && inp.widget === undefined) || [];
                        const relayOutputs = relayNode.outputs?.filter(out => out && out.type !== -1 && out.widget === undefined) || [];
                        const masterGen = node.widgets?.find(w => w.name === "schema_generation")?.value || 1;
                        const rGen = relayNode.properties?.bound_generation ?? relayNode._ssgBoundGeneration;
                        const retGen = returnNode.properties?.bound_generation ?? returnNode._ssgBoundGeneration;

                        // Check Critical Unlinked Wire inside Return Loop (Priority over Desync)
                        if (returnInputs.length > 0 && returnInputs.some(i => i.link === null || i.link === undefined)) {
                            if (!hasCriticalFault) {
                                hasCriticalFault = true;
                                criticalMsg = `CH: ${chanId} [Loop Broken]`;
                            }
                        }

                        // Check Slot Count Mismatches & Generation Drift (Tier 1 Warning)
                        if (returnInputs.length !== trackInputs.length || relayOutputs.length !== trackInputs.length) {
                            hasDesync = true;
                            desyncMsg = `CH: ${chanId} [Sync Required]`;
                        } else if ((rGen !== undefined && rGen < masterGen) || (retGen !== undefined && retGen < masterGen)) {
                            hasDesync = true;
                            desyncMsg = `CH: ${chanId} [Desync]`;
                        }
                    }
                }

                if (hasCriticalFault) {
                    displayText = criticalMsg;
                    bannerColor = SSG_COLOR_FIRE_OPAL;
                } else if (hasDesync) {
                    displayText = desyncMsg;
                    bannerColor = SSG_COLOR_YELLOW_TOPAZ;
                }
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
                const isLoopActive = !!node.properties.injection_loop;

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

                    node.properties.gate_manifest = JSON.stringify(currentTracks);

                    if (channelName) {
                        registerChannel(`${channelName}_TX`, currentTracks, genWidget?.value || 1, true, !isLoopActive);
                        registerChannel(`${channelName}_RX`, currentTracks, genWidget?.value || 1, true, !isLoopActive);
                        registerGateLoopState(channelName, isLoopActive);
                    }
                } else {
                    let savedTracks = [];
                    try {
                        savedTracks = JSON.parse(node.properties.gate_manifest || "[]");
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

                    node.properties.gate_manifest = JSON.stringify(savedTracks);

                    if (channelName) {
                        registerChannel(`${channelName}_TX`, savedTracks, genWidget?.value || 1, false, !isLoopActive);
                        registerChannel(`${channelName}_RX`, savedTracks, genWidget?.value || 1, false, !isLoopActive);
                        registerGateLoopState(channelName, isLoopActive);
                    }
                }

                const targetHeight = Math.max(120, (node.inputs.length * 20) + 115);
                updateNodeBounds(node, SSG_DEFAULT_WIDTH, targetHeight);
                node.updateGateBannerState();
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

                    node.properties.gate_manifest = JSON.stringify(currentTracks);

                    if (genWidget) {
                        genWidget.value = (genWidget.value || 0) + 1;
                    }

                    const channelName = node.properties.channel_id;
                    const isLoopActive = !!node.properties.injection_loop;

                    if (channelName) {
                        registerChannel(`${channelName}_TX`, currentTracks, genWidget?.value || 1, false, !isLoopActive);
                        registerChannel(`${channelName}_RX`, currentTracks, genWidget?.value || 1, false, !isLoopActive);
                        registerGateLoopState(channelName, isLoopActive);
                    }
                }

                node.refreshSlotLayout();
                node.updateGateBannerState();

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

                // Immediate affiliate redraw propagation
                const allNodes = app?.graph ? getAllGraphNodes(app.graph) : [];
                const chanId = node.properties?.channel_id;
                if (chanId) {
                    allNodes.forEach(n => {
                        if (n && n.type === "SSGSmartGateRelay" && typeof n.updateRelayBannerState === "function") {
                            n.updateRelayBannerState();
                        } else if (n && n.type === "SSGSmartGateReturn" && typeof n.updateReturnBannerState === "function") {
                            n.updateReturnBannerState();
                        }
                    });
                }

                forceNetworkUpdate(app);
            }
        };

        // Slot 3: Hardware Toggle Switch
        if (!injectWidget) {
            injectWidget = node.addWidget(
                "toggle",
                "injection_loop",
                node.properties.injection_loop,
                function (val) {
                    const activeVal = !!val;
                    node.properties.injection_loop = activeVal;
                    const channelName = node.properties.channel_id;
                    if (channelName) {
                        registerGateLoopState(channelName, activeVal);
                    }
                    node.updateGateBannerState();
                    forceNetworkUpdate(app);
                    if (node.graph) {
                        node.graph._version = (node.graph._version || 0) + 1;
                        node.graph.setDirtyCanvas(true, true);
                    }
                },
                { on: "On", off: "Off" }
            );
        } else {
            const origCallback = injectWidget.callback;
            injectWidget.value = !!node.properties.injection_loop;
            injectWidget.callback = function (val) {
                const activeVal = !!val;
                node.properties.injection_loop = activeVal;
                if (origCallback) origCallback.call(this, activeVal);

                const channelName = node.properties.channel_id;
                if (channelName) {
                    registerGateLoopState(channelName, activeVal);
                }

                node.updateGateBannerState();
                forceNetworkUpdate(app);

                if (node.graph) {
                    node.graph._version = (node.graph._version || 0) + 1;
                    node.graph.setDirtyCanvas(true, true);
                }
            };
        }

        // Deterministic Slot Assembly: [Slot 0: Banner, Slot 1: Button, ...Remaining, Slot 3: Toggle]
        const remainingWidgets = (node.widgets || []).filter(
            w => w !== injectWidget && w !== domBannerWidget && w !== lockButton
        );
        node.widgets = [domBannerWidget, lockButton, ...remainingWidgets, injectWidget].filter(Boolean);

        node.onConnectionsChange = function () {
            if (node._isEditMode) {
                node.refreshSlotLayout();
            }
            node.updateGateBannerState();
            forceNetworkUpdate(app);
        };

        node.refreshSlotLayout();
        node.updateGateBannerState();
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

        if (chanId) {
            delete window.SSG_PipeRegistry[`${chanId}_TX`];
            delete window.SSG_PipeRegistry[`${chanId}_RX`];
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

// ==========================================================================
// 2. GATE RELAY (SSGSmartGateRelay) - Loop Transmitter Consumer
// ==========================================================================

export function setupSmartGateRelay(nodeType, nodeData, app) {
    const origOnConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function (info) {
        syncIncomingProperties(this, info);

        if (origOnConfigure) origOnConfigure.apply(this, arguments);

        const node = this;
        node.properties = node.properties || {};

        node._ssgBoundGeneration = node.properties.bound_generation ?? 0;
        node._ssgBoundChannel = node.properties.bound_channel || "";

        const manifestVal = node.properties.relay_manifest;

        if (manifestVal && node.outputs) {
            try {
                const savedTracks = typeof manifestVal === "string" ? JSON.parse(manifestVal) : manifestVal;
                if (Array.isArray(savedTracks)) {
                    savedTracks.forEach((track, idx) => {
                        if (node.outputs[idx]) {
                            node.outputs[idx]._trackIdx = track.index !== undefined ? track.index : idx;
                            if (track.type && track.type !== "*") {
                                node.outputs[idx].type = track.type;
                            }
                        }
                    });
                }
            } catch (e) {}
        }

        refreshGateDropdown(node, app, "_TX");
        if (typeof node.updateRelayBannerState === "function") {
            node.updateRelayBannerState();
        }
        const targetHeight = Math.max(80, (node.outputs ? node.outputs.length * 20 : 0) + 95);
        updateNodeBounds(node, SSG_DEFAULT_WIDTH, targetHeight);
    };

    const origOnNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
        if (origOnNodeCreated) origOnNodeCreated.apply(this, arguments);

        const node = this;
        node.properties = node.properties || {};
        node.properties.bound_channel = "";
        node.properties.bound_generation = 0;
        node._ssgBoundGeneration = 0;
        node._ssgBoundChannel = "";
        node._isLoading = false;

        while (node.outputs && node.outputs.length > 0) {
            node.removeOutput(0);
        }
        node.outputs = [];

        let channelWidget = node.widgets?.find(w => w.name === "channel");

        // Slot 0: Native DOM Status Banner Widget
        const domBannerWidget = createSSGDOMBanner(node, {
            widgetName: "channel_display",
            initialText: "CH: Available",
            initialColor: SSG_COLOR_YELLOW_TOPAZ
        });

        node.updateRelayBannerState = function () {
            const chW = node.widgets?.find(w => w.name === "channel");
            const targetChan = chW?.value || node.properties?.bound_channel || "Available";
            const record = getChannelRecord(targetChan);
            const isBypassed = isChannelBypassed(targetChan);

            let displayText = `CH: ${targetChan}`;
            let bannerColor = SSG_COLOR_NOMINAL; // Tier 0 Nominal: Native ComfyUI

            if (targetChan === "Available") {
                displayText = "CH: Available";
                bannerColor = SSG_COLOR_YELLOW_TOPAZ;
            } else if (targetChan === "Unavailable" || !record) {
                displayText = targetChan === "Unavailable" ? "CH: Unavailable" : `CH: ${targetChan}`;
                bannerColor = SSG_COLOR_RUBY_RED;
            } else if (isBypassed) {
                displayText = "Injection Bypass Detected";
                bannerColor = SSG_COLOR_MUTED;
            } else if (record.is_editing) {
                displayText = `CH: ${targetChan} [Edit Mode]`;
                bannerColor = SSG_COLOR_YELLOW_TOPAZ;
            } else {
                const relayOutputs = node.outputs?.filter(out => out && out.type !== -1 && out.widget === undefined) || [];
                const isTrackMismatch = record.tracks && (relayOutputs.length !== record.tracks.length);
                const isGenMismatch = record.generation !== node._ssgBoundGeneration;

                if (relayOutputs.length === 0 || isTrackMismatch) {
                    displayText = `CH: ${targetChan} [Sync Required]`;
                    bannerColor = SSG_COLOR_YELLOW_TOPAZ;
                } else if (isGenMismatch) {
                    displayText = `CH: ${targetChan} [Desync]`;
                    bannerColor = SSG_COLOR_YELLOW_TOPAZ;
                }
            }

            if (typeof node.updateSSGBanner === "function") {
                node.updateSSGBanner(displayText, bannerColor);
            }
        };

        function syncRelayTracks() {
            const chW = node.widgets?.find(w => w.name === "channel");
            const targetChannel = chW?.value;
            if (!targetChannel || targetChannel === "Available" || targetChannel === "Unavailable") return;

            const record = getChannelRecord(targetChannel);
            if (!record || !record.tracks) return;

            const existingLinksMap = new Map();
            if (node.outputs) {
                node.outputs.forEach(out => {
                    if (out.links && out.links.length > 0) {
                        const key = out._trackIdx !== undefined ? out._trackIdx : out.name;
                        existingLinksMap.set(key, [...out.links]);
                    }
                });
            }

            node.outputs = [];

            record.tracks.forEach((track, idx) => {
                const cleanName = sanitizeAndTruncateText(track.name, 16);
                const cleanType = track.type || "*";

                node.addOutput(cleanName, cleanType);
                const newSlot = node.outputs[idx];
                newSlot._trackIdx = track.index !== undefined ? track.index : idx;

                const savedLinks = existingLinksMap.get(newSlot._trackIdx) || existingLinksMap.get(cleanName);
                if (savedLinks) {
                    newSlot.links = savedLinks;
                    savedLinks.forEach(linkId => {
                        const graphLink = getGraphLink(app, node, linkId);
                        if (graphLink) {
                            graphLink.origin_slot = idx;
                        }
                    });
                }
            });

            node._ssgBoundGeneration = record.generation;
            node._ssgBoundChannel = targetChannel;
            node.properties.bound_generation = record.generation;
            node.properties.bound_channel = targetChannel;

            node.properties.relay_manifest = record.tracks.map(track => ({
                index: track.index,
                name: track.name,
                type: track.type
            }));

            const targetHeight = Math.max(80, (node.outputs.length * 20) + 95);
            updateNodeBounds(node, SSG_DEFAULT_WIDTH, targetHeight);

            node.updateRelayBannerState();
            node.setDirtyCanvas(true, true);

            // Notify Master Gate immediately
            const cleanBase = targetChannel.replace(/_TX$/, "");
            const allNodes = app?.graph ? getAllGraphNodes(app.graph) : [];
            const masterGate = allNodes.find(n => n && n.type === "SSGSmartGate" && (n.properties?.channel_id === cleanBase || n.widgets?.find(w => w.name === "channel_name")?.value?.trim() === cleanBase));
            if (masterGate) {
                if (typeof masterGate.updateGateBannerState === "function") {
                    masterGate.updateGateBannerState();
                }
                masterGate.setDirtyCanvas(true, true);
            }

            forceNetworkUpdate(app);
        }

        // Slot 1: Native Action Button
        const syncButton = {
            type: "button",
            name: "[ Sync Tracks ]",
            label: "[ Sync Tracks ]",
            value: null,
            callback: () => {
                syncRelayTracks();
                if (typeof node.onWidgetChanged === "function") {
                    node.onWidgetChanged(syncButton.name, syncButton.value, null, syncButton);
                }
            }
        };

        // Slot 2: Channel Dropdown Combo
        if (!channelWidget) {
            channelWidget = node.addWidget("combo", "channel", "Available", (v) => {
                const clean = (v || "").trim();
                if (clean !== "Available" && clean !== "Unavailable") {
                    node.properties.bound_channel = clean;
                    node._ssgBoundChannel = clean;
                }
                refreshGateDropdown(node, app, "_TX");
                node.updateRelayBannerState();
                if (node.graph) node.graph.setDirtyCanvas(true, true);
                forceNetworkUpdate(app);
            }, { values: ["Available"] });
        } else {
            const origCallback = channelWidget.callback;
            channelWidget.callback = function (v) {
                const clean = (v || "").trim();
                if (clean !== "Available" && clean !== "Unavailable") {
                    node.properties.bound_channel = clean;
                    node._ssgBoundChannel = clean;
                }
                refreshGateDropdown(node, app, "_TX");
                node.updateRelayBannerState();
                if (origCallback) origCallback.apply(this, arguments);
                if (node.graph) node.graph.setDirtyCanvas(true, true);
                forceNetworkUpdate(app);
            };
        }

        node._ssgRefreshDropdown = () => {
            refreshGateDropdown(node, app, "_TX");
            node.updateRelayBannerState();
        };

        // Deterministic Slot Assembly: [Slot 0: Banner, Slot 1: Button, Slot 2: Channel, ...Remaining]
        const remainingWidgets = (node.widgets || []).filter(
            w => w !== domBannerWidget && w !== syncButton && w !== channelWidget
        );
        node.widgets = [domBannerWidget, syncButton, channelWidget, ...remainingWidgets].filter(Boolean);

        refreshGateDropdown(node, app, "_TX");
        node.updateRelayBannerState();
        updateNodeBounds(node, SSG_DEFAULT_WIDTH, 100);
    };

    const origOnDrawForeground = nodeType.prototype.onDrawForeground;
    nodeType.prototype.onDrawForeground = function (ctx) {
        if (origOnDrawForeground) origOnDrawForeground.apply(this, arguments);
    };
}

// ==========================================================================
// 3. GATE RETURN (SSGSmartGateReturn) - Loop Return Receiver
// ==========================================================================

export function setupSmartGateReturn(nodeType, nodeData, app) {
    const origOnConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function (info) {
        syncIncomingProperties(this, info);

        if (origOnConfigure) origOnConfigure.apply(this, arguments);

        const node = this;
        node.properties = node.properties || {};

        node._ssgBoundGeneration = node.properties.bound_generation ?? 0;
        node._ssgBoundChannel = node.properties.bound_channel || "";

        const manifestVal = node.properties.return_manifest;
        let savedTracks = [];

        if (manifestVal) {
            try {
                savedTracks = typeof manifestVal === "string" ? JSON.parse(manifestVal) : manifestVal;
                if (Array.isArray(savedTracks)) {
                    savedTracks.forEach((track, idx) => {
                        if (node.inputs[idx]) {
                            node.inputs[idx]._trackIdx = track.index !== undefined ? track.index : idx;
                            if (track.type && track.type !== "*") {
                                node.inputs[idx].type = track.type;
                            }
                        }
                    });
                }
            } catch (e) {
                savedTracks = [];
            }
        }

        // Return Self-Healing Pre-Hydration Check
        if (node._ssgBoundChannel && savedTracks.length > 0) {
            const curRec = getChannelRecord(node._ssgBoundChannel);
            if (!curRec) {
                const cleanBase = node._ssgBoundChannel.replace(/_RX$/, "");
                const isBypassed = isChannelBypassed(cleanBase);
                registerChannel(node._ssgBoundChannel, savedTracks, node._ssgBoundGeneration || 1, false, isBypassed);
            }
        }

        refreshGateDropdown(node, app, "_RX");
        if (typeof node.updateReturnBannerState === "function") {
            node.updateReturnBannerState();
        }
        const targetHeight = Math.max(80, (node.inputs ? node.inputs.length * 20 : 0) + 95);
        updateNodeBounds(node, SSG_DEFAULT_WIDTH, targetHeight);
    };

    const origOnNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
        if (origOnNodeCreated) origOnNodeCreated.apply(this, arguments);

        const node = this;
        node.properties = node.properties || {};
        node.properties.bound_channel = "";
        node.properties.bound_generation = 0;
        node._ssgBoundGeneration = 0;
        node._ssgBoundChannel = "";
        node._isLoading = false;

        while (node.inputs && node.inputs.length > 0) {
            node.removeInput(0);
        }
        node.inputs = [];

        let channelWidget = node.widgets?.find(w => w.name === "channel");

        // Slot 0: Native DOM Status Banner Widget
        const domBannerWidget = createSSGDOMBanner(node, {
            widgetName: "channel_display",
            initialText: "CH: Available",
            initialColor: SSG_COLOR_YELLOW_TOPAZ
        });

        node.updateReturnBannerState = function () {
            const chW = node.widgets?.find(w => w.name === "channel");
            const targetChan = chW?.value || node.properties?.bound_channel || "Available";
            const record = getChannelRecord(targetChan);
            const isBypassed = isChannelBypassed(targetChan);

            let displayText = `CH: ${targetChan}`;
            let bannerColor = SSG_COLOR_NOMINAL; // Tier 0 Nominal: Native ComfyUI

            if (targetChan === "Available") {
                displayText = "CH: Available";
                bannerColor = SSG_COLOR_YELLOW_TOPAZ;
            } else if (targetChan === "Unavailable" || !record) {
                displayText = targetChan === "Unavailable" ? "CH: Unavailable" : `CH: ${targetChan}`;
                bannerColor = SSG_COLOR_RUBY_RED;
            } else if (isBypassed) {
                displayText = "Injection Bypass Detected";
                bannerColor = SSG_COLOR_MUTED;
            } else if (record.is_editing) {
                displayText = `CH: ${targetChan} [Edit Mode]`;
                bannerColor = SSG_COLOR_YELLOW_TOPAZ;
            } else {
                const retInputs = node.inputs?.filter(inp => inp && inp.type !== -1 && inp.widget === undefined) || [];
                const isTrackMismatch = record.tracks && (retInputs.length !== record.tracks.length);
                const isGenMismatch = record.generation !== node._ssgBoundGeneration;

                if (retInputs.length === 0 || isTrackMismatch) {
                    displayText = `CH: ${targetChan} [Sync Required]`;
                    bannerColor = SSG_COLOR_YELLOW_TOPAZ;
                } else if (retInputs.some(i => i.link === null || i.link === undefined)) {
                    displayText = `CH: ${targetChan} [Unlinked]`;
                    bannerColor = SSG_COLOR_FIRE_OPAL;
                } else if (isGenMismatch) {
                    displayText = `CH: ${targetChan} [Desync]`;
                    bannerColor = SSG_COLOR_YELLOW_TOPAZ;
                }
            }

            if (typeof node.updateSSGBanner === "function") {
                node.updateSSGBanner(displayText, bannerColor);
            }
        };

        function syncReturnTracks() {
            const chW = node.widgets?.find(w => w.name === "channel");
            const targetChannel = chW?.value;
            if (!targetChannel || targetChannel === "Available" || targetChannel === "Unavailable") return;

            const record = getChannelRecord(targetChannel);
            if (!record || !record.tracks) return;

            const existingLinksMap = new Map();
            if (node.inputs) {
                node.inputs.forEach(inp => {
                    if (inp.link !== null && inp.link !== undefined) {
                        const key = inp._trackIdx !== undefined ? inp._trackIdx : inp.name;
                        existingLinksMap.set(key, inp.link);
                    }
                });
            }

            node.inputs = [];

            record.tracks.forEach((track, idx) => {
                const cleanName = sanitizeAndTruncateText(track.name, 16);
                const cleanType = track.type || "*";

                node.addInput(cleanName, cleanType);
                const newSlot = node.inputs[idx];
                newSlot._trackIdx = track.index !== undefined ? track.index : idx;

                const savedLink = existingLinksMap.get(newSlot._trackIdx) || existingLinksMap.get(cleanName);
                if (savedLink !== undefined) {
                    newSlot.link = savedLink;
                    const graphLink = getGraphLink(app, node, savedLink);
                    if (graphLink) {
                        graphLink.target_slot = idx;
                    }
                }
            });

            node._ssgBoundGeneration = record.generation;
            node._ssgBoundChannel = targetChannel;
            node.properties.bound_generation = record.generation;
            node.properties.bound_channel = targetChannel;

            node.properties.return_manifest = record.tracks.map(track => ({
                index: track.index,
                name: track.name,
                type: track.type
            }));

            const targetHeight = Math.max(80, (node.inputs.length * 20) + 95);
            updateNodeBounds(node, SSG_DEFAULT_WIDTH, targetHeight);

            node.updateReturnBannerState();
            node.setDirtyCanvas(true, true);

            // Notify Master Gate immediately
            const cleanBase = targetChannel.replace(/_RX$/, "");
            const allNodes = app?.graph ? getAllGraphNodes(app.graph) : [];
            const masterGate = allNodes.find(n => n && n.type === "SSGSmartGate" && (n.properties?.channel_id === cleanBase || n.widgets?.find(w => w.name === "channel_name")?.value?.trim() === cleanBase));
            if (masterGate) {
                if (typeof masterGate.updateGateBannerState === "function") {
                    masterGate.updateGateBannerState();
                }
                masterGate.setDirtyCanvas(true, true);
            }

            forceNetworkUpdate(app);
        }

        // Slot 1: Native Action Button
        const syncButton = {
            type: "button",
            name: "[ Sync Tracks ]",
            label: "[ Sync Tracks ]",
            value: null,
            callback: () => {
                syncReturnTracks();
                if (typeof node.onWidgetChanged === "function") {
                    node.onWidgetChanged(syncButton.name, syncButton.value, null, syncButton);
                }
            }
        };

        // Slot 2: Channel Dropdown Combo
        if (!channelWidget) {
            channelWidget = node.addWidget("combo", "channel", "Available", (v) => {
                const clean = (v || "").trim();
                if (clean !== "Available" && clean !== "Unavailable") {
                    node.properties.bound_channel = clean;
                    node._ssgBoundChannel = clean;
                }
                refreshGateDropdown(node, app, "_RX");
                node.updateReturnBannerState();
                if (node.graph) node.graph.setDirtyCanvas(true, true);
                forceNetworkUpdate(app);
            }, { values: ["Available"] });
        } else {
            const origCallback = channelWidget.callback;
            channelWidget.callback = function (v) {
                const clean = (v || "").trim();
                if (clean !== "Available" && clean !== "Unavailable") {
                    node.properties.bound_channel = clean;
                    node._ssgBoundChannel = clean;
                }
                refreshGateDropdown(node, app, "_RX");
                node.updateReturnBannerState();
                if (origCallback) origCallback.apply(this, arguments);
                if (node.graph) node.graph.setDirtyCanvas(true, true);
                forceNetworkUpdate(app);
            };
        }

        node.onConnectionsChange = function () {
            node.updateReturnBannerState();
            const cleanBase = (node.properties?.bound_channel || "").replace(/_RX$/, "");
            if (cleanBase) {
                const allNodes = app?.graph ? getAllGraphNodes(app.graph) : [];
                const masterGate = allNodes.find(n => n && n.type === "SSGSmartGate" && (n.properties?.channel_id === cleanBase || n.widgets?.find(w => w.name === "channel_name")?.value?.trim() === cleanBase));
                if (masterGate) {
                    if (typeof masterGate.updateGateBannerState === "function") {
                        masterGate.updateGateBannerState();
                    }
                    masterGate.setDirtyCanvas(true, true);
                }
            }
            forceNetworkUpdate(app);
        };

        node._ssgRefreshDropdown = () => {
            refreshGateDropdown(node, app, "_RX");
            node.updateReturnBannerState();
        };

        // Deterministic Slot Assembly: [Slot 0: Banner, Slot 1: Button, Slot 2: Channel, ...Remaining]
        const remainingWidgets = (node.widgets || []).filter(
            w => w !== domBannerWidget && w !== syncButton && w !== channelWidget
        );
        node.widgets = [domBannerWidget, syncButton, channelWidget, ...remainingWidgets].filter(Boolean);

        refreshGateDropdown(node, app, "_RX");
        node.updateReturnBannerState();
        updateNodeBounds(node, SSG_DEFAULT_WIDTH, 100);
    };

    const origOnDrawForeground = nodeType.prototype.onDrawForeground;
    nodeType.prototype.onDrawForeground = function (ctx) {
        if (origOnDrawForeground) origOnDrawForeground.apply(this, arguments);
    };
}