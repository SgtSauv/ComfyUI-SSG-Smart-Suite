// ==========================================================================
// SSG CUSTOM NODE ECOSYSTEM (V2 ARCHITECTURE)
// Module: SSG Smart Gate Trio (Transceiver, Subgraph Relay & Return)
// File: /web/js/ssg_smart_gate.js
// ==========================================================================

import {
    SSG_DEFAULT_WIDTH,
    AW_BLUE,
    DIAGNOSTIC_TIERS,
    sanitizeAndTruncateText,
    applyDynamicShavePass,
    drawSSGWarningOutline,
    drawMasterGlobalTooltip,
    findTrueUpstreamAnchor,
    registerChannel,
    getChannelRecord,
    forceNetworkUpdate,
    syncIncomingProperties,
    getAllGraphNodes
} from "./ssg_core_utils.js";

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

function getTrackInputs(node) {
    if (!node.inputs) return [];
    return node.inputs.filter(inp => inp.name && inp.name.startsWith("SSG_"));
}

function createReadOnlyChannelWidget(node, prefix = "GATE:") {
    const widget = node.addWidget(
        "custom",
        "channel_display",
        null,
        () => {},
        { serialize: false }
    );

    widget.draw = function (ctx, nodeRef, widgetWidth, y, widgetHeight) {
        const chanId = nodeRef.properties?.channel_id || "UNASSIGNED";
        const margin = 10;
        const drawWidth = widgetWidth - (margin * 2);
        const drawHeight = 22;

        ctx.save();
        ctx.fillStyle = "rgba(15, 18, 22, 0.85)";
        ctx.strokeStyle = "rgba(0, 229, 255, 0.35)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(margin, y, drawWidth, drawHeight, [4]);
        ctx.fill();
        ctx.stroke();

        ctx.font = "bold 11px 'Courier New', monospace";
        ctx.fillStyle = AW_BLUE;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(`${prefix} ${chanId}`, margin + (drawWidth / 2), y + (drawHeight / 2));
        ctx.restore();
    };

    widget.computeSize = function () {
        return [SSG_DEFAULT_WIDTH, 26];
    };

    return widget;
}

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
        const manifestVal = node.properties.gate_manifest;
        const channelName = node.properties.channel_id;

        if (node.properties.is_locked) {
            node._isEditMode = false;
            const lockBtn = node.widgets?.find(w => w.name === "[ Lock Schema ]" || w.name === "[ Edit Schema ]");
            if (lockBtn) lockBtn.name = "[ Edit Schema ]";

            let savedTracks = [];
            try {
                savedTracks = JSON.parse(manifestVal || "[]");
            } catch (e) {
                savedTracks = [];
            }

            const targetSlots = savedTracks.length;
            let trackInputs = getTrackInputs(node);

            while (trackInputs.length < targetSlots) {
                const idx = trackInputs.length;
                node.addInput(`SSG_${idx}`, "*");
                trackInputs = getTrackInputs(node);
            }
            while (trackInputs.length > targetSlots) {
                const last = trackInputs[trackInputs.length - 1];
                node.removeInput(node.inputs.indexOf(last));
                trackInputs = getTrackInputs(node);
            }

            while (node.outputs && node.outputs.length < targetSlots) {
                const idx = node.outputs.length;
                node.addOutput(`SSG_${idx}`, "*");
            }
            while (node.outputs && node.outputs.length > targetSlots) {
                node.removeOutput(node.outputs.length - 1);
            }

            trackInputs = getTrackInputs(node);
            for (let i = 0; i < targetSlots; i++) {
                const track = savedTracks[i];
                const inp = trackInputs[i];
                const out = node.outputs?.[i];

                if (inp) {
                    inp.name = `SSG_${i}`;
                    inp.label = "◦";
                    inp.type = track ? (track.type || "*") : "*";
                }
                if (out) {
                    out.name = `SSG_${i}`;
                    out.label = track ? (track.name || `Track_${i}`) : `Track_${i}`;
                    out.type = track ? (track.type || "*") : "*";
                }
            }

            node.properties.gate_manifest = JSON.stringify(savedTracks);

            if (channelName && savedTracks.length > 0) {
                registerChannel(`${channelName}_TX`, savedTracks, genW?.value || 1, false);
            }

            node.size = [SSG_DEFAULT_WIDTH, Math.max(120, (targetSlots * 20) + 95)];
        } else {
            node._isEditMode = true;
            if (node.refreshSlotLayout) {
                node.refreshSlotLayout();
            }
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
        node.size = [SSG_DEFAULT_WIDTH, 140];
        node.properties = node.properties || {};
        node.properties.is_locked = false;
        node._isEditMode = true;

        if (!node.properties.channel_id) {
            node.properties.channel_id = getNextSequentialGateName(app, node);
        }

        if (node.properties.gate_manifest === undefined) {
            node.properties.gate_manifest = "";
        }

        let trackInputs = getTrackInputs(node);
        while (trackInputs.length > 1) {
            const last = trackInputs[trackInputs.length - 1];
            node.removeInput(node.inputs.indexOf(last));
            trackInputs = getTrackInputs(node);
        }

        while (node.outputs && node.outputs.length > 1) {
            node.removeOutput(node.outputs.length - 1);
        }

        if (trackInputs.length === 0) {
            node.addInput("SSG_0", "*");
            trackInputs = getTrackInputs(node);
        }
        if (!node.outputs || node.outputs.length === 0) {
            node.addOutput("SSG_0", "*");
        }

        trackInputs[0].name = "SSG_0";
        trackInputs[0].label = "◦";
        trackInputs[0].type = "*";

        node.outputs[0].name = "SSG_0";
        node.outputs[0].label = "◦";
        node.outputs[0].type = "*";

        const injectWidget = node.widgets?.find(w => w.name === "injection_loop" || w.name === "injection_switch" || w.name === "injection");
        if (injectWidget) {
            injectWidget.name = "injection_loop";
            injectWidget.value = false;
            injectWidget.callback = () => {
                forceNetworkUpdate(app);
            };
        }

        createReadOnlyChannelWidget(node, "GATE:");

        const genWidget = node.widgets?.find(w => w.name === "schema_generation");

        node.refreshSlotLayout = function () {
            const channelName = node.properties.channel_id;
            let trackInputs = getTrackInputs(node);

            if (node._isEditMode) {
                const connectedCount = trackInputs.filter(i => i.link !== null && i.link !== undefined).length || 0;
                const targetCount = Math.min(24, Math.max(1, connectedCount + 1));

                while (trackInputs.length < targetCount) {
                    const idx = trackInputs.length;
                    node.addInput(`SSG_${idx}`, "*");
                    trackInputs = getTrackInputs(node);
                    trackInputs[idx].label = "◦";
                }
                while (trackInputs.length > targetCount && (trackInputs[trackInputs.length - 1].link === null || trackInputs[trackInputs.length - 1].link === undefined)) {
                    const last = trackInputs[trackInputs.length - 1];
                    node.removeInput(node.inputs.indexOf(last));
                    trackInputs = getTrackInputs(node);
                }

                while (node.outputs.length < trackInputs.length) {
                    const idx = node.outputs.length;
                    node.addOutput(`SSG_${idx}`, "*");
                }
                while (node.outputs.length > trackInputs.length) {
                    node.removeOutput(node.outputs.length - 1);
                }

                const currentTracks = [];
                for (let i = 0; i < trackInputs.length; i++) {
                    const inp = trackInputs[i];
                    const out = node.outputs[i];

                    inp.name = `SSG_${i}`;
                    inp.label = "◦";

                    if (out) out.name = `SSG_${i}`;

                    if (inp.link !== null && inp.link !== undefined) {
                        const link = getGraphLink(app, node, inp.link);
                        if (link) {
                            const resolved = findTrueUpstreamAnchor(app, node, link.origin_id, link.origin_slot);
                            inp.type = resolved.type || "*";
                            if (out) {
                                out.label = resolved.name;
                                out.type = resolved.type || "*";
                            }
                            currentTracks.push({ index: i, name: resolved.name, type: resolved.type || "*" });
                        }
                    } else {
                        inp.type = "*";
                        if (out) {
                            out.label = "◦";
                            out.type = "*";
                        }
                    }
                }

                node.properties.gate_manifest = JSON.stringify(currentTracks);

                if (channelName) {
                    registerChannel(`${channelName}_TX`, currentTracks, genWidget?.value || 1, true);
                }
            } else {
                let savedTracks = [];
                try {
                    savedTracks = JSON.parse(node.properties.gate_manifest || "[]");
                } catch (e) {
                    savedTracks = [];
                }

                const targetCount = savedTracks.length;

                while (trackInputs.length < targetCount) {
                    const idx = trackInputs.length;
                    node.addInput(`SSG_${idx}`, "*");
                    trackInputs = getTrackInputs(node);
                }
                while (trackInputs.length > targetCount) {
                    const last = trackInputs[trackInputs.length - 1];
                    node.removeInput(node.inputs.indexOf(last));
                    trackInputs = getTrackInputs(node);
                }

                while (node.outputs.length < targetCount) {
                    const idx = node.outputs.length;
                    node.addOutput(`SSG_${idx}`, "*");
                }
                while (node.outputs.length > targetCount) {
                    node.removeOutput(node.outputs.length - 1);
                }

                const currentTracks = [];
                for (let i = 0; i < targetCount; i++) {
                    const inp = trackInputs[i];
                    const out = node.outputs[i];

                    inp.name = `SSG_${i}`;
                    inp.label = "◦";

                    if (out) out.name = `SSG_${i}`;

                    if (inp.link !== null && inp.link !== undefined) {
                        const link = getGraphLink(app, node, inp.link);
                        if (link) {
                            const resolved = findTrueUpstreamAnchor(app, node, link.origin_id, link.origin_slot);
                            inp.type = resolved.type || "*";
                            if (out) {
                                out.label = resolved.name;
                                out.type = resolved.type || "*";
                            }
                        }
                    }
                    currentTracks.push({ index: i, name: out?.label || `Track_${i}`, type: inp.type });
                }

                node.properties.gate_manifest = JSON.stringify(currentTracks);

                if (channelName) {
                    registerChannel(`${channelName}_TX`, currentTracks, genWidget?.value || 1, false);
                }
            }

            node.size = [SSG_DEFAULT_WIDTH, Math.max(120, (trackInputs.length * 20) + 95)];
            if (node.graph) node.graph.setDirtyCanvas(true, true);
        };

        const lockButton = node.addWidget(
            "button",
            node._isEditMode ? "[ Lock Schema ]" : "[ Edit Schema ]",
            null,
            () => {
                node._isEditMode = !node._isEditMode;
                node.properties.is_locked = !node._isEditMode;
                lockButton.name = node._isEditMode ? "[ Lock Schema ]" : "[ Edit Schema ]";

                let trackInputs = getTrackInputs(node);

                if (!node._isEditMode) {
                    for (let i = trackInputs.length - 1; i >= 0; i--) {
                        if (trackInputs[i].link === null || trackInputs[i].link === undefined) {
                            const realIdx = node.inputs.indexOf(trackInputs[i]);
                            node.removeInput(realIdx);
                            if (node.outputs[i]) node.removeOutput(i);
                        }
                    }

                    trackInputs = getTrackInputs(node);
                    const currentTracks = [];
                    for (let i = 0; i < trackInputs.length; i++) {
                        const inp = trackInputs[i];
                        const out = node.outputs[i];

                        inp.name = `SSG_${i}`;
                        inp.label = "◦";

                        if (out) out.name = `SSG_${i}`;

                        if (inp.link !== null && inp.link !== undefined) {
                            const link = getGraphLink(app, node, inp.link);
                            if (link) {
                                const resolved = findTrueUpstreamAnchor(app, node, link.origin_id, link.origin_slot);
                                inp.type = resolved.type || "*";
                                if (out) {
                                    out.label = resolved.name;
                                    out.type = resolved.type || "*";
                                }
                            }
                        }
                        currentTracks.push({ index: i, name: out?.label || `Track_${i}`, type: inp.type });
                    }

                    node.properties.gate_manifest = JSON.stringify(currentTracks);

                    if (genWidget) {
                        genWidget.value = (genWidget.value || 0) + 1;
                    }

                    const channelName = node.properties.channel_id;
                    if (channelName) {
                        registerChannel(`${channelName}_TX`, currentTracks, genWidget?.value || 1, false);
                    }
                }

                node.refreshSlotLayout();
                forceNetworkUpdate(app);
            }
        );

        node.onConnectionsChange = function () {
            if (node._isEditMode) {
                node.refreshSlotLayout();
            }
        };

        node.refreshSlotLayout();

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

        if (chanId && window.SSG_PipeRegistry) {
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

        const node = this;
        applyDynamicShavePass(node);

        const channelName = node.properties.channel_id;
        const injectWidget = node.widgets?.find(w => w.name === "injection_loop" || w.name === "injection_switch" || w.name === "injection");
        const isInjecting = injectWidget?.value === true;
        const trackInputs = getTrackInputs(node);

        let activeTier = DIAGNOSTIC_TIERS.TIER_0_NOMINAL;
        const hasBrokenInputLink = !node._isEditMode && trackInputs.length > 0 && trackInputs.some(i => i.link === null || i.link === undefined);

        let hasTypeMismatch = false;
        let hasNameMismatch = false;

        if (!node._isEditMode && trackInputs.length > 0) {
            let savedTracks = [];
            try {
                savedTracks = JSON.parse(node.properties.gate_manifest || "[]");
            } catch (e) {
                savedTracks = [];
            }

            for (let i = 0; i < trackInputs.length; i++) {
                const input = trackInputs[i];
                const manifestTrack = savedTracks[i];

                if (input.link !== null && input.link !== undefined && manifestTrack) {
                    const link = getGraphLink(app, node, input.link);
                    if (link) {
                        const resolved = findTrueUpstreamAnchor(app, node, link.origin_id, link.origin_slot);

                        const expectedType = manifestTrack.type || "*";
                        const actualType = resolved.type || "*";
                        if (expectedType !== "*" && actualType !== "*" && expectedType !== actualType) {
                            hasTypeMismatch = true;
                        }

                        const expectedName = manifestTrack.name || `SSG_${i}`;
                        const actualName = resolved.name || "◦";
                        if (expectedName !== actualName) {
                            hasNameMismatch = true;
                        }
                    }
                }
            }
        }

        let moduleError = false;
        if (isInjecting && channelName) {
            const txRecord = getChannelRecord(`${channelName}_TX`);
            const rxRecord = getChannelRecord(`${channelName}_RX`);

            if (!txRecord || txRecord.is_editing || !rxRecord || rxRecord.is_editing) {
                moduleError = true;
            } else if (txRecord.tracks.length !== rxRecord.tracks.length) {
                moduleError = true;
            }
        }

        if (!channelName) {
            activeTier = DIAGNOSTIC_TIERS.TIER_3_RED;
        } else if (hasBrokenInputLink || hasTypeMismatch || (isInjecting && moduleError)) {
            activeTier = DIAGNOSTIC_TIERS.TIER_2_ORANGE;
        } else if (node._isEditMode || hasNameMismatch) {
            activeTier = DIAGNOSTIC_TIERS.TIER_1_YELLOW;
        }
        drawSSGWarningOutline(node, ctx, activeTier);

        if (node.flags?.collapsed) {
            const cleanName = sanitizeAndTruncateText(channelName || "ERROR", 16);
            const activeCount = trackInputs.filter(i => i.link !== null && i.link !== undefined).length || 0;
            const modeState = node._isEditMode ? "EDIT" : "LOCKED";
            const injectState = isInjecting ? "INJECT" : "BYPASS";
            const customTitle = node.title !== "Gate" && node.title !== "SSG Smart Gate" ? ` - ${node.title}` : "";
            const badgeLabel = `GATE: ${cleanName}${customTitle} [${activeCount} Trk | ${injectState} | ${modeState}]`;

            drawMasterGlobalTooltip(node, ctx, app, badgeLabel);
        }
    };
}

export function setupSmartGateRelay(nodeType, nodeData, app) {
    const origClone = nodeType.prototype.clone;
    nodeType.prototype.clone = function () {
        const clonedNode = origClone ? origClone.apply(this, arguments) : null;
        if (clonedNode) {
            clonedNode.properties = clonedNode.properties || {};
            clonedNode.properties.bound_channel = "";
            clonedNode.properties.bound_generation = 0;
            clonedNode.properties.relay_manifest = "";
            clonedNode.properties.channel_id = "";
            clonedNode._ssgBoundGeneration = 0;
            clonedNode._ssgBoundChannel = "";

            while (clonedNode.outputs && clonedNode.outputs.length > 0) {
                clonedNode.removeOutput(0);
            }
            clonedNode.outputs = [];

            if (clonedNode._ssgRefreshDropdown) clonedNode._ssgRefreshDropdown();
        }
        return clonedNode;
    };

    const origOnConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function (info) {
        syncIncomingProperties(this, info);

        if (origOnConfigure) origOnConfigure.apply(this, arguments);

        const node = this;
        node.properties = node.properties || {};

        node._ssgBoundGeneration = node.properties.bound_generation || 0;
        node._ssgBoundChannel = node.properties.bound_channel || "";

        let savedTracks = [];
        try {
            savedTracks = JSON.parse(node.properties.relay_manifest || "[]");
        } catch (e) {
            savedTracks = [];
        }

        while (node.inputs && node.inputs.length > 0) {
            node.removeInput(0);
        }
        node.inputs = [];

        while (node.outputs && node.outputs.length < savedTracks.length) {
            const idx = node.outputs.length;
            node.addOutput(`SSG_${idx}`, "*");
        }
        while (node.outputs && node.outputs.length > savedTracks.length) {
            node.removeOutput(node.outputs.length - 1);
        }

        if (node.outputs) {
            node.outputs.forEach((out, idx) => {
                const track = savedTracks[idx];
                if (track) {
                    out.name = `SSG_${idx}`;
                    out.label = track.name || `SSG_${idx}`;
                    out.type = track.type || "*";
                }
            });
        }

        node.size = [SSG_DEFAULT_WIDTH, Math.max(100, (savedTracks.length * 20) + 70)];

        if (node._ssgRefreshDropdown) node._ssgRefreshDropdown();
        setTimeout(() => {
            forceNetworkUpdate(app);
            if (node.graph) node.graph.setDirtyCanvas(true, true);
        }, 50);
    };

    const origOnNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
        if (origOnNodeCreated) origOnNodeCreated.apply(this, arguments);

        const node = this;
        node.size = [SSG_DEFAULT_WIDTH, 100];
        node.properties = node.properties || {};
        node.properties.bound_generation = node.properties.bound_generation || 0;
        node.properties.bound_channel = node.properties.bound_channel || "";
        node._ssgBoundGeneration = node.properties.bound_generation;
        node._ssgBoundChannel = node.properties.bound_channel;

        while (node.inputs && node.inputs.length > 0) {
            node.removeInput(0);
        }
        node.inputs = [];

        while (node.outputs && node.outputs.length > 0) {
            node.removeOutput(0);
        }
        node.outputs = [];

        let channelWidget = node.widgets?.find(w => w.name === "channel");
        if (!channelWidget) {
            channelWidget = node.addWidget("combo", "channel", "Unavailable", (val) => {
                const cleanVal = (val || "").trim();
                if (cleanVal !== "Available" && cleanVal !== "Unavailable") {
                    node.properties.channel_id = cleanVal;
                }
                if (node.graph) node.graph.setDirtyCanvas(true, true);
            }, { values: ["Unavailable"] });
        }

        if (channelWidget) {
            const origMouse = channelWidget.mouse;
            channelWidget.mouse = function() {
                if (typeof node._ssgRefreshDropdown === "function") {
                    node._ssgRefreshDropdown();
                }
                if (origMouse) return origMouse.apply(this, arguments);
            };
        }

        node._ssgRefreshDropdown = function () {
            if (!channelWidget) return;
            const currentSelected = (channelWidget.value || "").trim();

            const activeTxChannels = [];
            const allNodes = app?.graph ? getAllGraphNodes(app.graph) : [];

            for (const n of allNodes) {
                if (n && n.type === "SSGSmartGate") {
                    const val = n.properties?.channel_id;
                    if (val) activeTxChannels.push(`${val}_TX`);
                }
            }

            for (const chan in window.SSG_PipeRegistry) {
                if (chan.endsWith("_TX") && !activeTxChannels.includes(chan)) {
                    activeTxChannels.push(chan);
                }
            }

            if (activeTxChannels.length === 0) {
                channelWidget.options.values = ["Unavailable"];
                if (node.properties.bound_channel) {
                    channelWidget.value = node.properties.bound_channel;
                } else {
                    channelWidget.value = "Unavailable";
                    node.properties.channel_id = "";
                }
                return;
            }

            const menuOptions = ["Available", ...activeTxChannels];
            channelWidget.options.values = menuOptions;

            if (currentSelected && activeTxChannels.includes(currentSelected)) {
                channelWidget.value = currentSelected;
                node.properties.channel_id = currentSelected;
            } else if (node.properties.bound_channel && activeTxChannels.includes(node.properties.bound_channel)) {
                channelWidget.value = node.properties.bound_channel;
                node.properties.channel_id = node.properties.bound_channel;
            } else if (!currentSelected || currentSelected === "Unavailable" || currentSelected === "Default") {
                channelWidget.value = "Available";
                node.properties.channel_id = "";
            }
        };

        node.addWidget(
            "button",
            "[ Sync Tracks ]",
            null,
            () => {
                const rawChannel = (channelWidget.value || "").trim();
                if (!rawChannel || rawChannel === "Available" || rawChannel === "Unavailable") {
                    return;
                }

                const record = getChannelRecord(rawChannel);
                if (!record || !record.tracks || record.tracks.length === 0) {
                    return;
                }

                node.properties.channel_id = rawChannel;
                node.properties.bound_channel = rawChannel;
                node.properties.bound_generation = record.generation;
                node.properties.relay_manifest = JSON.stringify(record.tracks);
                node._ssgBoundGeneration = record.generation;
                node._ssgBoundChannel = rawChannel;

                while (node.outputs.length < record.tracks.length) {
                    const idx = node.outputs.length;
                    node.addOutput(`SSG_${idx}`, "*");
                }
                while (node.outputs.length > record.tracks.length) {
                    node.removeOutput(node.outputs.length - 1);
                }

                node.outputs.forEach((out, idx) => {
                    const track = record.tracks[idx];
                    if (track) {
                        out.name = `SSG_${idx}`;
                        out.label = track.name || `SSG_${idx}`;
                        out.type = track.type || "*";
                    }
                });

                node.size = [SSG_DEFAULT_WIDTH, Math.max(100, (node.outputs.length * 20) + 70)];
                if (node.graph) node.graph.setDirtyCanvas(true, true);
            }
        );

        node._ssgRefreshDropdown();

        setTimeout(() => {
            forceNetworkUpdate(app);
            if (node.graph) node.graph.setDirtyCanvas(true, true);
        }, 50);
    };

    const origOnRemoved = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
        if (origOnRemoved) origOnRemoved.apply(this, arguments);
        setTimeout(() => {
            forceNetworkUpdate(app);
        }, 30);
    };

    const origOnDrawForeground = nodeType.prototype.onDrawForeground;
    nodeType.prototype.onDrawForeground = function (ctx) {
        if (origOnDrawForeground) origOnDrawForeground.apply(this, arguments);

        const node = this;
        applyDynamicShavePass(node);

        const channelWidget = node.widgets?.find(w => w.name === "channel");
        const rawChannel = (channelWidget?.value || "").trim();
        const record = getChannelRecord(rawChannel);

        let activeTier = DIAGNOSTIC_TIERS.TIER_0_NOMINAL;
        const boundChannel = node.properties?.bound_channel || node._ssgBoundChannel || "";
        const boundGen = node.properties?.bound_generation ?? node._ssgBoundGeneration ?? 0;
        const isChannelMismatch = rawChannel !== boundChannel;
        const isSlotMismatch = record && node.outputs && node.outputs.length !== record.tracks.length;

        if (!rawChannel || rawChannel === "Unavailable") {
            activeTier = DIAGNOSTIC_TIERS.TIER_3_RED;
        } else if (rawChannel === "Available" || record?.is_editing || isChannelMismatch || boundGen === 0) {
            activeTier = DIAGNOSTIC_TIERS.TIER_1_YELLOW;
        } else if (!record || record.generation !== boundGen || isSlotMismatch) {
            activeTier = DIAGNOSTIC_TIERS.TIER_2_ORANGE;
        }

        drawSSGWarningOutline(node, ctx, activeTier);

        if (node.flags?.collapsed) {
            const cleanName = sanitizeAndTruncateText(rawChannel || "NONE", 16);
            const activeCount = node.outputs?.length || 0;
            const customTitle = node.title !== "Relay" && node.title !== "SSG Smart Gate Relay" ? ` - ${node.title}` : "";
            const badgeLabel = `RELAY: ${cleanName}${customTitle} [${activeCount} Trk]`;

            drawMasterGlobalTooltip(node, ctx, app, badgeLabel);
        }
    };
}

export function setupSmartGateReturn(nodeType, nodeData, app) {
    const origClone = nodeType.prototype.clone;
    nodeType.prototype.clone = function () {
        const clonedNode = origClone ? origClone.apply(this, arguments) : null;
        if (clonedNode) {
            clonedNode.properties = clonedNode.properties || {};
            clonedNode.properties.bound_channel = "";
            clonedNode.properties.bound_generation = 0;
            clonedNode.properties.return_manifest = "";
            clonedNode.properties.channel_id = "";
            clonedNode._ssgBoundGeneration = 0;
            clonedNode._ssgBoundChannel = "";

            while (clonedNode.inputs && clonedNode.inputs.length > 0) {
                clonedNode.removeInput(0);
            }
            clonedNode.inputs = [];

            if (clonedNode._ssgRefreshDropdown) clonedNode._ssgRefreshDropdown();
        }
        return clonedNode;
    };

    const origOnConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function (info) {
        syncIncomingProperties(this, info);

        if (origOnConfigure) origOnConfigure.apply(this, arguments);

        const node = this;
        node.properties = node.properties || {};

        node._ssgBoundGeneration = node.properties.bound_generation || 0;
        node._ssgBoundChannel = node.properties.bound_channel || "";

        let savedTracks = [];
        try {
            savedTracks = JSON.parse(node.properties.return_manifest || "[]");
        } catch (e) {
            savedTracks = [];
        }

        while (node.outputs && node.outputs.length > 0) {
            node.removeOutput(0);
        }
        node.outputs = [];

        let trackInputs = getTrackInputs(node);
        while (trackInputs.length < savedTracks.length) {
            const idx = trackInputs.length;
            node.addInput(`SSG_${idx}`, "*");
            trackInputs = getTrackInputs(node);
        }
        while (trackInputs.length > savedTracks.length) {
            const last = trackInputs[trackInputs.length - 1];
            node.removeInput(node.inputs.indexOf(last));
            trackInputs = getTrackInputs(node);
        }

        trackInputs = getTrackInputs(node);
        trackInputs.forEach((inp, idx) => {
            const track = savedTracks[idx];
            if (track) {
                inp.name = `SSG_${idx}`;
                inp.label = track.name || `SSG_${idx}`;
                inp.type = track.type || "*";
            }
        });

        const rawChannel = node.properties.channel_id;
        if (rawChannel && savedTracks.length > 0) {
            registerChannel(rawChannel, savedTracks, node._ssgBoundGeneration || 1, false);
        }

        node.size = [SSG_DEFAULT_WIDTH, Math.max(100, (savedTracks.length * 20) + 70)];

        if (node._ssgRefreshDropdown) node._ssgRefreshDropdown();
        setTimeout(() => {
            forceNetworkUpdate(app);
            if (node.graph) node.graph.setDirtyCanvas(true, true);
        }, 50);
    };

    const origOnNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
        if (origOnNodeCreated) origOnNodeCreated.apply(this, arguments);

        const node = this;
        node.size = [SSG_DEFAULT_WIDTH, 100];
        node.properties = node.properties || {};
        node.properties.bound_generation = node.properties.bound_generation || 0;
        node.properties.bound_channel = node.properties.bound_channel || "";
        node._ssgBoundGeneration = node.properties.bound_generation;
        node._ssgBoundChannel = node.properties.bound_channel;

        while (node.outputs && node.outputs.length > 0) {
            node.removeOutput(0);
        }
        node.outputs = [];

        let trackInputs = getTrackInputs(node);
        while (trackInputs.length > 0) {
            const last = trackInputs[trackInputs.length - 1];
            node.removeInput(node.inputs.indexOf(last));
            trackInputs = getTrackInputs(node);
        }

        let channelWidget = node.widgets?.find(w => w.name === "channel");
        if (!channelWidget) {
            channelWidget = node.addWidget("combo", "channel", "Unavailable", (val) => {
                const cleanVal = (val || "").trim();
                if (cleanVal !== "Available" && cleanVal !== "Unavailable") {
                    node.properties.channel_id = cleanVal;
                }
                if (node.graph) node.graph.setDirtyCanvas(true, true);
            }, { values: ["Unavailable"] });
        }

        if (channelWidget) {
            const origMouse = channelWidget.mouse;
            channelWidget.mouse = function() {
                if (typeof node._ssgRefreshDropdown === "function") {
                    node._ssgRefreshDropdown();
                }
                if (origMouse) return origMouse.apply(this, arguments);
            };
        }
        
        node._ssgRefreshDropdown = function () {
            if (!channelWidget) return;
            const currentSelected = (channelWidget.value || "").trim();

            const activeRxChannels = [];
            const allNodes = app?.graph ? getAllGraphNodes(app.graph) : [];

            for (const n of allNodes) {
                if (n && n.type === "SSGSmartGate") {
                    const val = n.properties?.channel_id;
                    if (val) activeRxChannels.push(`${val}_RX`);
                }
            }

            for (const chan in window.SSG_PipeRegistry) {
                if (chan.endsWith("_RX") && !activeRxChannels.includes(chan)) {
                    activeRxChannels.push(chan);
                }
            }

            if (activeRxChannels.length === 0) {
                channelWidget.options.values = ["Unavailable"];
                if (node.properties.bound_channel) {
                    channelWidget.value = node.properties.bound_channel;
                } else {
                    channelWidget.value = "Unavailable";
                    node.properties.channel_id = "";
                }
                return;
            }

            const menuOptions = ["Available", ...activeRxChannels];
            channelWidget.options.values = menuOptions;

            if (currentSelected && activeRxChannels.includes(currentSelected)) {
                channelWidget.value = currentSelected;
                node.properties.channel_id = currentSelected;
            } else if (node.properties.bound_channel && activeRxChannels.includes(node.properties.bound_channel)) {
                channelWidget.value = node.properties.bound_channel;
                node.properties.channel_id = node.properties.bound_channel;
            } else if (!currentSelected || currentSelected === "Unavailable" || currentSelected === "Default") {
                channelWidget.value = "Available";
                node.properties.channel_id = "";
            }
        };

        node.addWidget(
            "button",
            "[ Sync Tracks ]",
            null,
            () => {
                const rawChannel = (channelWidget.value || "").trim();
                if (!rawChannel || rawChannel === "Available" || rawChannel === "Unavailable") {
                    return;
                }

                const gateBaseName = rawChannel.replace(/_RX$/, "");
                const txRecord = getChannelRecord(`${gateBaseName}_TX`);

                if (!txRecord || !txRecord.tracks || txRecord.tracks.length === 0) {
                    return;
                }

                node.properties.channel_id = rawChannel;
                node.properties.bound_channel = rawChannel;
                node.properties.bound_generation = txRecord.generation;
                node.properties.return_manifest = JSON.stringify(txRecord.tracks);
                node._ssgBoundGeneration = txRecord.generation;
                node._ssgBoundChannel = rawChannel;

                let trackInputs = getTrackInputs(node);
                while (trackInputs.length < txRecord.tracks.length) {
                    const idx = trackInputs.length;
                    node.addInput(`SSG_${idx}`, "*");
                    trackInputs = getTrackInputs(node);
                }
                while (trackInputs.length > txRecord.tracks.length) {
                    const last = trackInputs[trackInputs.length - 1];
                    node.removeInput(node.inputs.indexOf(last));
                    trackInputs = getTrackInputs(node);
                }

                trackInputs = getTrackInputs(node);
                trackInputs.forEach((inp, idx) => {
                    const track = txRecord.tracks[idx];
                    if (track) {
                        inp.name = `SSG_${idx}`;
                        inp.label = track.name || `SSG_${idx}`;
                        inp.type = track.type || "*";
                    }
                });

                registerChannel(rawChannel, txRecord.tracks, txRecord.generation, false);
                node.size = [SSG_DEFAULT_WIDTH, Math.max(100, (trackInputs.length * 20) + 70)];
                
                forceNetworkUpdate(app);
                if (node.graph) node.graph.setDirtyCanvas(true, true);
            }
        );

        node._ssgRefreshDropdown();

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

        const node = this;
        applyDynamicShavePass(node);

        const channelWidget = node.widgets?.find(w => w.name === "channel");
        const rawChannel = (channelWidget?.value || "").trim();
        const gateBaseName = rawChannel.replace(/_RX$/, "");
        const txRecord = getChannelRecord(`${gateBaseName}_TX`);
        const trackInputs = getTrackInputs(node);

        let activeTier = DIAGNOSTIC_TIERS.TIER_0_NOMINAL;
        const boundChannel = node.properties?.bound_channel || node._ssgBoundChannel || "";
        const boundGen = node.properties?.bound_generation ?? node._ssgBoundGeneration ?? 0;
        const isChannelMismatch = rawChannel !== boundChannel;
        const isSlotMismatch = txRecord && trackInputs.length !== txRecord.tracks.length;
        const hasBrokenInputLink = trackInputs.length > 0 && trackInputs.some(i => i.link === null || i.link === undefined);

        if (!rawChannel || rawChannel === "Unavailable") {
            activeTier = DIAGNOSTIC_TIERS.TIER_3_RED;
        } else if (rawChannel === "Available" || txRecord?.is_editing || isChannelMismatch || boundGen === 0) {
            activeTier = DIAGNOSTIC_TIERS.TIER_1_YELLOW;
        } else if (!txRecord || txRecord.generation !== boundGen || isSlotMismatch || hasBrokenInputLink) {
            activeTier = DIAGNOSTIC_TIERS.TIER_2_ORANGE;
        }

        drawSSGWarningOutline(node, ctx, activeTier);

        if (node.flags?.collapsed) {
            const cleanName = sanitizeAndTruncateText(rawChannel || "NONE", 16);
            const activeCount = trackInputs.filter(i => i.link !== null && i.link !== undefined).length || 0;
            const customTitle = node.title !== "Return" && node.title !== "SSG Smart Gate Return" ? ` - ${node.title}` : "";
            const badgeLabel = `RETURN: ${cleanName}${customTitle} [${activeCount} Trk]`;

            drawMasterGlobalTooltip(node, ctx, app, badgeLabel);
        }
    };
}