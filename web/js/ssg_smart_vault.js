// ==========================================================================
// SSG CUSTOM NODE ECOSYSTEM (V2 ARCHITECTURE)
// Module: SSG Smart Vault (Master Inline RAM/VRAM Storage & Engine Severer)
// File: /web/js/ssg_smart_vault.js
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

function getNextSequentialVaultName(app, currentNode) {
    const basePrefix = "SSG_Vault_";
    let highestIndex = 0;

    const allNodes = [];
    function collectNodes(graph) {
        if (!graph) return;
        const nodes = graph._nodes || graph.nodes || [];
        for (const n of nodes) {
            allNodes.push(n);
            if (n?.subgraph) collectNodes(n.subgraph);
        }
    }
    if (app?.graph) collectNodes(app.graph);

    for (const n of allNodes) {
        if (n.type === "SSGSmartVault" && n !== currentNode) {
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

function createReadOnlyChannelWidget(node, prefix = "VAULT:") {
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
        const manifestVal = node.properties.vault_manifest;
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

            while (node.inputs && node.inputs.length < targetSlots) {
                const idx = node.inputs.length;
                node.addInput(`SSG_${idx}`, "*");
            }
            while (node.inputs && node.inputs.length > targetSlots) {
                node.removeInput(node.inputs.length - 1);
            }

            while (node.outputs && node.outputs.length < targetSlots) {
                const idx = node.outputs.length;
                node.addOutput(`SSG_${idx}`, "*");
            }
            while (node.outputs && node.outputs.length > targetSlots) {
                node.removeOutput(node.outputs.length - 1);
            }

            if (node.inputs && node.outputs) {
                for (let i = 0; i < targetSlots; i++) {
                    const track = savedTracks[i];
                    const inp = node.inputs[i];
                    const out = node.outputs[i];

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
            }

            node.properties.vault_manifest = JSON.stringify(savedTracks);

            if (channelName && savedTracks.length > 0) {
                registerChannel(channelName, savedTracks, genW?.value || 1, false);
            }

            node.size = [SSG_DEFAULT_WIDTH, Math.max(120, (targetSlots * 20) + 115)];
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
        node.size = [SSG_DEFAULT_WIDTH, 160];
        node.properties = node.properties || {};
        node.properties.is_locked = false;
        node._isEditMode = true;

        if (!node.properties.channel_id) {
            node.properties.channel_id = getNextSequentialVaultName(app, node);
        }

        if (node.properties.vault_manifest === undefined) {
            node.properties.vault_manifest = "";
        }

        while (node.inputs && node.inputs.length > 1) {
            node.removeInput(node.inputs.length - 1);
        }
        while (node.outputs && node.outputs.length > 1) {
            node.removeOutput(node.outputs.length - 1);
        }

        if (!node.inputs || node.inputs.length === 0) {
            node.addInput("SSG_0", "*");
        }
        if (!node.outputs || node.outputs.length === 0) {
            node.addOutput("SSG_0", "*");
        }

        node.inputs[0].name = "SSG_0";
        node.inputs[0].label = "◦";
        node.inputs[0].type = "*";

        node.outputs[0].name = "SSG_0";
        node.outputs[0].label = "◦";
        node.outputs[0].type = "*";

        // Mutex switch callbacks
        const flushWidget = node.widgets?.find(w => w.name === "flush_switch");
        const cacheWidget = node.widgets?.find(w => w.name === "cache_switch");

        if (cacheWidget) {
            const origCacheCb = cacheWidget.callback;
            cacheWidget.callback = function (val) {
                if (origCacheCb) origCacheCb.apply(this, arguments);
                if (val === true && flushWidget) {
                    flushWidget.value = false;
                }
                if (node.graph) node.graph.setDirtyCanvas(true, true);
            };
        }

        if (flushWidget) {
            const origFlushCb = flushWidget.callback;
            flushWidget.callback = function (val) {
                if (origFlushCb) origFlushCb.apply(this, arguments);
                if (val === true && cacheWidget) {
                    cacheWidget.value = false;
                }
                if (node.graph) node.graph.setDirtyCanvas(true, true);
            };
        }

        createReadOnlyChannelWidget(node, "VAULT:");

        const genWidget = node.widgets?.find(w => w.name === "schema_generation");

        node.refreshSlotLayout = function () {
            const channelName = node.properties.channel_id;

            if (node._isEditMode) {
                const connectedCount = node.inputs?.filter(i => i.link !== null && i.link !== undefined).length || 0;
                const targetCount = Math.min(24, Math.max(1, connectedCount + 1));

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
                }
                while (node.outputs.length > node.inputs.length) {
                    node.removeOutput(node.outputs.length - 1);
                }

                const currentTracks = [];
                for (let i = 0; i < node.inputs.length; i++) {
                    const inp = node.inputs[i];
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

                node.properties.vault_manifest = JSON.stringify(currentTracks);

                if (channelName) {
                    registerChannel(channelName, currentTracks, genWidget?.value || 1, true);
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
                }
                while (node.inputs.length > targetCount) {
                    node.removeInput(node.inputs.length - 1);
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
                    const inp = node.inputs[i];
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

                node.properties.vault_manifest = JSON.stringify(currentTracks);

                if (channelName) {
                    registerChannel(channelName, currentTracks, genWidget?.value || 1, false);
                }
            }

            node.size = [SSG_DEFAULT_WIDTH, Math.max(120, (node.inputs.length * 20) + 115)];
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
                    for (let i = node.inputs.length - 1; i >= 0; i--) {
                        if (node.inputs[i].link === null || node.inputs[i].link === undefined) {
                            node.removeInput(i);
                            if (node.outputs[i]) node.removeOutput(i);
                        }
                    }

                    const currentTracks = [];
                    for (let i = 0; i < node.inputs.length; i++) {
                        const inp = node.inputs[i];
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

                    node.properties.vault_manifest = JSON.stringify(currentTracks);

                    if (genWidget) {
                        genWidget.value = (genWidget.value || 0) + 1;
                    }

                    const channelName = node.properties.channel_id;
                    if (channelName) {
                        registerChannel(channelName, currentTracks, genWidget?.value || 1, false);
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
    };

    const origOnDrawForeground = nodeType.prototype.onDrawForeground;
    nodeType.prototype.onDrawForeground = function (ctx) {
        if (origOnDrawForeground) origOnDrawForeground.apply(this, arguments);

        const node = this;

        const channelName = node.properties.channel_id;
        const flushWidget = node.widgets?.find(w => w.name === "flush_switch");
        const cacheWidget = node.widgets?.find(w => w.name === "cache_switch");

        const isRecording = flushWidget?.value === true && !cacheWidget?.value;
        const isPlayback = cacheWidget?.value === true;
        const isFrozen = !isRecording && !isPlayback;

        // Dynamic Header Status Icon & Clean Shave Assignment
        if (node.flags?.collapsed) {
            node.title = "Vault";
        } else {
            let stateBadge = "❄";
            if (isRecording) stateBadge = "🔴";
            else if (isPlayback) stateBadge = "⚡";

            node.title = `SSG Smart Vault ${stateBadge}`;
        }

        let activeTier = DIAGNOSTIC_TIERS.TIER_0_NOMINAL;
        const hasBrokenInputLink = !node._isEditMode && node.inputs && node.inputs.length > 0 && node.inputs.some(i => i.link === null || i.link === undefined);

        let hasTypeMismatch = false;
        let hasNameMismatch = false;

        if (!node._isEditMode && node.inputs && node.inputs.length > 0) {
            let savedTracks = [];
            try {
                savedTracks = JSON.parse(node.properties.vault_manifest || "[]");
            } catch (e) {
                savedTracks = [];
            }

            for (let i = 0; i < node.inputs.length; i++) {
                const input = node.inputs[i];
                const manifestTrack = savedTracks[i];

                if (input.link !== null && input.link !== undefined && manifestTrack) {
                    const link = getGraphLink(app, node, input.link);
                    if (link) {
                        const resolved = findTrueUpstreamAnchor(app, node, link.origin_id, link.origin_slot);

                        // Data Type Mismatch Check
                        const expectedType = manifestTrack.type || "*";
                        const actualType = resolved.type || "*";
                        if (expectedType !== "*" && actualType !== "*" && expectedType !== actualType) {
                            hasTypeMismatch = true;
                        }

                        // Name Mismatch Check
                        const expectedName = manifestTrack.name || `SSG_${i}`;
                        const actualName = resolved.name || "◦";
                        if (expectedName !== actualName) {
                            hasNameMismatch = true;
                        }
                    }
                }
            }
        }

        if (!channelName) {
            activeTier = DIAGNOSTIC_TIERS.TIER_3_RED;
        } else if (hasBrokenInputLink || hasTypeMismatch) {
            activeTier = DIAGNOSTIC_TIERS.TIER_2_ORANGE;
        } else if (node._isEditMode || hasNameMismatch) {
            activeTier = DIAGNOSTIC_TIERS.TIER_1_YELLOW;
        }

        drawSSGWarningOutline(node, ctx, activeTier);

        if (node.flags?.collapsed) {
            const cleanName = sanitizeAndTruncateText(channelName || "ERROR", 16);
            const activeCount = node.inputs?.filter(i => i.link !== null && i.link !== undefined).length || 0;
            const modeState = node._isEditMode ? "EDIT" : "LOCKED";
            
            let statusText = "FROZEN";
            if (isRecording) statusText = "RECORDING";
            else if (isPlayback) statusText = "PLAYBACK";

            const customTitle = node.title !== "Vault" && node.title !== "SSG Smart Vault" ? ` - ${node.title}` : "";
            const badgeLabel = `VAULT: ${cleanName}${customTitle} [${activeCount} Trk | ${statusText} | ${modeState}]`;

            drawMasterGlobalTooltip(node, ctx, app, badgeLabel);
        }
    };
}