// ==========================================================================
// SSG CUSTOM NODE ECOSYSTEM (V2 ARCHITECTURE)
// Module: SSG Smart Router (A/B Crossbar Multi-Track Broadcaster)
// File: /web/js/ssg_smart_router.js
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
    forceNetworkUpdate,
    syncIncomingProperties
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

function getNextSequentialRouterName(app, currentNode) {
    const basePrefix = "SSG_Router_";
    let highestIndex = 0;

    const allNodes = [];
    function collectNodes(graph) {
        if (!graph) return;
        const nodes = graph._nodes || graph.nodes || [];
        for (const n of nodes) {
            allNodes.push(n);
            if (n?.subgraph) {
                collectNodes(n.subgraph);
            }
        }
    }

    if (app?.graph) {
        collectNodes(app.graph);
    }

    for (const n of allNodes) {
        if (n.type === "SSGSmartRouter" && n !== currentNode) {
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
        // 1. Explicitly hydrate serialized properties before running configure logic
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
            if (lockBtn) lockBtn.name = "[ Edit Schema ]";

            // Parse saved manifest
            let savedTracks = [];
            try {
                savedTracks = JSON.parse(manifestVal || "[]");
            } catch (e) {
                savedTracks = [];
            }

            const targetPairs = Math.max(1, savedTracks.length);
            const targetSlots = targetPairs * 2;

            // Ensure no outputs exist
            while (node.outputs && node.outputs.length > 0) {
                node.removeOutput(0);
            }
            node.outputs = [];

            // Synchronize input slots strictly to pair count
            while (node.inputs && node.inputs.length < targetSlots) {
                const pairIdx = Math.floor(node.inputs.length / 2);
                node.addInput(`SSG_${pairIdx}_A`, "*");
                node.addInput(`SSG_${pairIdx}_B`, "*");
            }
            while (node.inputs && node.inputs.length > targetSlots) {
                node.removeInput(node.inputs.length - 1);
            }

            // Restore exact names and types directly from savedTracks without calling getGraphLink
            if (node.inputs) {
                for (let i = 0; i < targetPairs; i++) {
                    const inpA = node.inputs[i * 2];
                    const inpB = node.inputs[(i * 2) + 1];
                    const track = savedTracks[i];

                    if (inpA) {
                        inpA.name = `SSG_${i}_A`;
                        inpA.label = track ? `A${i}: ${track.name}` : `A${i}: ◦`;
                        inpA.type = track ? (track.type || "*") : "*";
                    }
                    if (inpB) {
                        inpB.name = `SSG_${i}_B`;
                        inpB.label = track ? `B${i}: ${track.name}` : `B${i}: ◦`;
                        inpB.type = track ? (track.type || "*") : "*";
                    }
                }
            }

            node.properties.router_manifest = JSON.stringify(savedTracks);

            if (channelName && savedTracks.length > 0) {
                registerChannel(channelName, savedTracks, genW?.value || 1, false);
            }

            node.size = [SSG_DEFAULT_WIDTH, Math.max(120, (node.inputs ? node.inputs.length * 20 : 0) + 90)];
        } else {
            node._isEditMode = true;
            if (node.refreshSlotLayout) {
                node.refreshSlotLayout();
            }
        }

        if (node.graph) node.graph.setDirtyCanvas(true, true);
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
            node.properties.channel_id = getNextSequentialRouterName(app, node);
        }

        if (node.properties.router_manifest === undefined) {
            node.properties.router_manifest = "";
        }

        while (node.outputs && node.outputs.length > 0) {
            node.removeOutput(0);
        }
        node.outputs = [];

        while (node.inputs && node.inputs.length > 2) {
            node.removeInput(node.inputs.length - 1);
        }

        if (!node.inputs || node.inputs.length === 0) {
            node.addInput("SSG_0_A", "*");
            node.addInput("SSG_0_B", "*");
        } else if (node.inputs.length === 1) {
            node.addInput("SSG_0_B", "*");
        }

        node.inputs[0].name = "SSG_0_A";
        node.inputs[0].label = "A0: ◦";
        node.inputs[0].type = "*";

        node.inputs[1].name = "SSG_0_B";
        node.inputs[1].label = "B0: ◦";
        node.inputs[1].type = "*";

        // --- READ-ONLY NATIVE CHANNEL BANNER WIDGET ---
        const channelDisplayWidget = node.addWidget(
            "custom",
            "channel_display",
            null,
            () => {},
            { serialize: false }
        );

        channelDisplayWidget.draw = function (ctx, nodeRef, widgetWidth, y, widgetHeight) {
            const chanId = nodeRef.properties?.channel_id || "UNASSIGNED";
            const margin = 10;
            const drawWidth = widgetWidth - (margin * 2);
            const drawHeight = 22;

            ctx.save();
            // Background Pill Bar
            ctx.fillStyle = "rgba(15, 18, 22, 0.85)";
            ctx.strokeStyle = "rgba(0, 229, 255, 0.35)";
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.roundRect(margin, y, drawWidth, drawHeight, [4]);
            ctx.fill();
            ctx.stroke();

            // Centered Alienware Blue Text
            ctx.font = "bold 11px 'Courier New', monospace";
            ctx.fillStyle = AW_BLUE;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(`CH: ${chanId}`, margin + (drawWidth / 2), y + (drawHeight / 2));
            ctx.restore();
        };

        channelDisplayWidget.computeSize = function () {
            return [SSG_DEFAULT_WIDTH, 26];
        };
        // ----------------------------------------------

        const bankWidget = node.widgets?.find(w => w.name === "router_switch");
        const genWidget = node.widgets?.find(w => w.name === "schema_generation");

        if (bankWidget) {
            const origBankCallback = bankWidget.callback;
            bankWidget.callback = function () {
                if (origBankCallback) origBankCallback.apply(this, arguments);
                node.refreshSlotLayout();
            };
        }

        node.refreshSlotLayout = function () {
            while (node.outputs && node.outputs.length > 0) {
                node.removeOutput(0);
            }
            node.outputs = [];

            const currentBank = bankWidget?.value || "Bank A";
            const channelName = node.properties.channel_id;

            if (node._isEditMode) {
                let connectedPairs = 0;
                const totalPairs = Math.floor((node.inputs?.length || 0) / 2);

                for (let i = 0; i < totalPairs; i++) {
                    const inpA = node.inputs[i * 2];
                    const inpB = node.inputs[(i * 2) + 1];
                    if ((inpA && inpA.link !== null) || (inpB && inpB.link !== null)) {
                        connectedPairs = i + 1;
                    }
                }

                const targetPairs = Math.min(12, Math.max(1, connectedPairs + 1));
                const targetSlots = targetPairs * 2;

                while (node.inputs.length < targetSlots) {
                    const pairIdx = Math.floor(node.inputs.length / 2);
                    node.addInput(`SSG_${pairIdx}_A`, "*");
                    node.addInput(`SSG_${pairIdx}_B`, "*");
                }

                while (node.inputs.length > targetSlots) {
                    const lastIdx = node.inputs.length - 1;
                    if (!node.inputs[lastIdx].link && !node.inputs[lastIdx - 1].link) {
                        node.removeInput(lastIdx);
                        node.removeInput(lastIdx - 1);
                    } else {
                        break;
                    }
                }

                const tracksA = [];
                const tracksB = [];

                for (let i = 0; i < Math.floor(node.inputs.length / 2); i++) {
                    const inpA = node.inputs[i * 2];
                    const inpB = node.inputs[(i * 2) + 1];

                    inpA.name = `SSG_${i}_A`;
                    inpB.name = `SSG_${i}_B`;

                    let resolvedA = null;
                    let resolvedB = null;

                    if (inpA.link !== null) {
                        const linkA = getGraphLink(app, node, inpA.link);
                        if (linkA) {
                            resolvedA = findTrueUpstreamAnchor(app, node, linkA.origin_id, linkA.origin_slot);
                            inpA.label = `A${i}: ${resolvedA.name}`;
                            inpA.type = resolvedA.type;
                            tracksA.push({ index: i, name: resolvedA.name, type: resolvedA.type });
                        }
                    } else {
                        inpA.label = `A${i}: ◦`;
                    }

                    if (inpB.link !== null) {
                        const linkB = getGraphLink(app, node, inpB.link);
                        if (linkB) {
                            resolvedB = findTrueUpstreamAnchor(app, node, linkB.origin_id, linkB.origin_slot);
                            inpB.label = `B${i}: ${resolvedB.name}`;
                            inpB.type = resolvedB.type;
                            tracksB.push({ index: i, name: resolvedB.name, type: resolvedB.type });
                        }
                    } else {
                        inpB.label = `B${i}: ◦`;
                    }

                    if (inpA.link !== null && inpB.link === null && resolvedA) {
                        inpB.type = resolvedA.type;
                    } else if (inpB.link !== null && inpA.link === null && resolvedB) {
                        inpA.type = resolvedB.type;
                    } else if (inpA.link === null && inpB.link === null) {
                        inpA.type = "*";
                        inpB.type = "*";
                    }
                }

                const activeBroadcastTracks = (currentBank === "Bank A" || currentBank === "A") ? tracksA : tracksB;
                node.properties.router_manifest = JSON.stringify(activeBroadcastTracks);

                if (channelName) {
                    registerChannel(channelName, activeBroadcastTracks, genWidget?.value || 1, true);
                }
            } else {
                const tracksA = [];
                const tracksB = [];

                for (let i = 0; i < Math.floor(node.inputs.length / 2); i++) {
                    const inpA = node.inputs[i * 2];
                    const inpB = node.inputs[(i * 2) + 1];

                    inpA.name = `SSG_${i}_A`;
                    inpB.name = `SSG_${i}_B`;

                    if (inpA.link !== null) {
                        const linkA = getGraphLink(app, node, inpA.link);
                        if (linkA) {
                            const resA = findTrueUpstreamAnchor(app, node, linkA.origin_id, linkA.origin_slot);
                            inpA.label = `A${i}: ${resA.name}`;
                            inpA.type = resA.type;
                        }
                    }

                    if (inpB.link !== null) {
                        const linkB = getGraphLink(app, node, inpB.link);
                        if (linkB) {
                            const resB = findTrueUpstreamAnchor(app, node, linkB.origin_id, linkB.origin_slot);
                            inpB.label = `B${i}: ${resB.name}`;
                            inpB.type = resB.type;
                        }
                    }

                    const cleanNameA = inpA.label.replace(/^A\d+:\s*/, "");
                    const cleanNameB = inpB.label.replace(/^B\d+:\s*/, "");

                    tracksA.push({ index: i, name: cleanNameA, type: inpA.type });
                    tracksB.push({ index: i, name: cleanNameB, type: inpB.type });
                }

                const activeBroadcastTracks = (currentBank === "Bank A" || currentBank === "A") ? tracksA : tracksB;
                node.properties.router_manifest = JSON.stringify(activeBroadcastTracks);

                if (channelName) {
                    registerChannel(channelName, activeBroadcastTracks, genWidget?.value || 1, false);
                }
            }

            node.size = [SSG_DEFAULT_WIDTH, Math.max(120, (node.inputs.length * 20) + 90)];
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

                if (!node._isEditMode) {
                    let savedTracks = [];
                    try {
                        savedTracks = JSON.parse(node.properties.router_manifest || "[]");
                    } catch (e) {
                        savedTracks = [];
                    }

                    const targetPairs = savedTracks.length;
                    const targetSlots = targetPairs * 2;

                    while (node.inputs.length < targetSlots) {
                        const pairIdx = Math.floor(node.inputs.length / 2);
                        node.addInput(`SSG_${pairIdx}_A`, "*");
                        node.addInput(`SSG_${pairIdx}_B`, "*");
                    }

                    while (node.inputs.length > targetSlots) {
                        node.removeInput(node.inputs.length - 1);
                    }

                    const currentBank = bankWidget?.value || "Bank A";
                    const activeTracks = [];

                    for (let i = 0; i < Math.floor(node.inputs.length / 2); i++) {
                        const inp = (currentBank === "Bank A" || currentBank === "A") ? node.inputs[i * 2] : node.inputs[(i * 2) + 1];
                        const cleanName = inp.label.replace(/^[AB]\d+:\s*/, "");
                        activeTracks.push({ index: i, name: cleanName, type: inp.type });
                    }

                    node.properties.router_manifest = JSON.stringify(activeTracks);

                    if (genWidget) {
                        genWidget.value = (genWidget.value || 0) + 1;
                    }

                    const channelName = node.properties.channel_id;
                    if (channelName) {
                        registerChannel(channelName, activeTracks, genWidget?.value || 1, false);
                    }
                }

                node.refreshSlotLayout();
                forceNetworkUpdate(app);
            }
        );

        node.onConnectionsChange = function (type) {
            if (node._isEditMode && type === 1) {
                node.refreshSlotLayout();
            }
        };

        node.refreshSlotLayout();
    };

    const origOnDrawForeground = nodeType.prototype.onDrawForeground;
    nodeType.prototype.onDrawForeground = function (ctx) {
        if (origOnDrawForeground) origOnDrawForeground.apply(this, arguments);

        const node = this;
        applyDynamicShavePass(node);

        const channelName = node.properties.channel_id;

        let activeTier = DIAGNOSTIC_TIERS.TIER_0_NOMINAL;
        const bankWidget = node.widgets?.find(w => w.name === "router_switch");
        const currentBank = bankWidget?.value || "Bank A";

        let hasBrokenLockedLink = false;
        let hasTypeMismatch = false;
        let hasNameMismatch = false;

        if (node.inputs && node.inputs.length > 0) {
            const pairCount = Math.floor(node.inputs.length / 2);

            let savedTracks = [];
            if (!node._isEditMode) {
                try {
                    savedTracks = JSON.parse(node.properties.router_manifest || "[]");
                } catch (e) {
                    savedTracks = [];
                }
            }

            for (let i = 0; i < pairCount; i++) {
                const inpA = node.inputs[i * 2];
                const inpB = node.inputs[(i * 2) + 1];

                let resolvedA = null;
                let resolvedB = null;

                if (inpA && inpA.link !== null && inpA.link !== undefined) {
                    const linkA = getGraphLink(app, node, inpA.link);
                    if (linkA) {
                        resolvedA = findTrueUpstreamAnchor(app, node, linkA.origin_id, linkA.origin_slot);
                    }
                }

                if (inpB && inpB.link !== null && inpB.link !== undefined) {
                    const linkB = getGraphLink(app, node, inpB.link);
                    if (linkB) {
                        resolvedB = findTrueUpstreamAnchor(app, node, linkB.origin_id, linkB.origin_slot);
                    }
                }

                // 1. Paired A/B Crossbar Type Collision Check
                const typeA = resolvedA ? (resolvedA.type || "*") : (inpA?.type || "*");
                const typeB = resolvedB ? (resolvedB.type || "*") : (inpB?.type || "*");
                if (resolvedA && resolvedB && typeA !== "*" && typeB !== "*" && typeA !== typeB) {
                    hasTypeMismatch = true;
                }

                // 2. Locked Mode Diagnostics against Saved Manifest
                if (!node._isEditMode) {
                    const isBankA = (currentBank === "Bank A" || currentBank === "A");
                    const activeSlot = isBankA ? inpA : inpB;
                    const activeResolved = isBankA ? resolvedA : resolvedB;
                    const manifestTrack = savedTracks[i];

                    // Missing wire on the active bank
                    if (activeSlot && (activeSlot.link === null || activeSlot.link === undefined)) {
                        hasBrokenLockedLink = true;
                    }

                    if (manifestTrack) {
                        const expectedType = manifestTrack.type || "*";
                        const expectedName = manifestTrack.name || `Track_${i}`;

                        // Check live active bank against manifest
                        if (activeResolved) {
                            const actualType = activeResolved.type || "*";
                            if (expectedType !== "*" && actualType !== "*" && expectedType !== actualType) {
                                hasTypeMismatch = true;
                            }
                            if (activeResolved.name && activeResolved.name !== expectedName) {
                                hasNameMismatch = true;
                            }
                        }
                    }
                }
            }
        }

        if (!channelName) {
            activeTier = DIAGNOSTIC_TIERS.TIER_3_RED;
        } else if (hasBrokenLockedLink || hasTypeMismatch) {
            activeTier = DIAGNOSTIC_TIERS.TIER_2_ORANGE;
        } else if (node._isEditMode || hasNameMismatch) {
            activeTier = DIAGNOSTIC_TIERS.TIER_1_YELLOW;
        }
        drawSSGWarningOutline(node, ctx, activeTier);

        if (node.flags?.collapsed) {
            const cleanName = sanitizeAndTruncateText(channelName || "ERROR", 16);
            const pairCount = Math.floor((node.inputs?.length || 0) / 2);
            const modeState = node._isEditMode ? "EDIT" : "LOCKED";
            const customTitle = node.title !== "Router" && node.title !== "SSG Smart Router" ? ` - ${node.title}` : "";
            const badgeLabel = `ROUTER: ${cleanName}${customTitle} [${currentBank} | ${pairCount} Pairs | ${modeState}]`;

            drawMasterGlobalTooltip(node, ctx, app, badgeLabel);
        }
    };
}