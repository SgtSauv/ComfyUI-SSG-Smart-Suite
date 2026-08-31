// ==========================================================================
// SSG CUSTOM NODE ECOSYSTEM (V2 ARCHITECTURE)
// Module: SSG Smart Pipe (Master Multi-Track Broadcaster)
// File: /web/js/ssg_smart_pipe.js
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

function getNextSequentialPipeName(app, currentNode) {
    const basePrefix = "SSG_Pipe_";
    let highestIndex = 0;

    const allNodes = app?.graph ? getAllGraphNodes(app.graph) : [];

    for (const n of allNodes) {
        if (n && n.type === "SSGSmartPipe" && n !== currentNode) {
            const val = n.properties?.channel_id;
            if (val && val.startsWith(basePrefix)) {
                const num = parseInt(val.substring(basePrefix.length), 10);
                if (!isNaN(num) && num > highestIndex) {
                    highestIndex = num;
                }
            }
        }
    }

    const registryKeys = Object.keys(window.SSG_PipeRegistry || {});
    for (const key of registryKeys) {
        if (key.startsWith(basePrefix)) {
            const num = parseInt(key.substring(basePrefix.length), 10);
            if (!isNaN(num) && num > highestIndex) {
                highestIndex = num;
            }
        }
    }

    return `${basePrefix}${highestIndex + 1}`;
}

export function setupSmartPipe(nodeType, nodeData, app) {
    const origClone = nodeType.prototype.clone;
    nodeType.prototype.clone = function () {
        const clonedNode = origClone ? origClone.apply(this, arguments) : null;
        if (clonedNode) {
            clonedNode._isEditMode = true;
            if (!clonedNode.properties) clonedNode.properties = {};
            clonedNode.properties.is_locked = false;
            clonedNode.properties.pipe_manifest = "";
            clonedNode.properties.channel_id = getNextSequentialPipeName(app, clonedNode);
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
        const manifestVal = node.properties.pipe_manifest;
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

            while (node.outputs && node.outputs.length > 0) {
                node.removeOutput(0);
            }
            node.outputs = [];

            while (node.inputs && node.inputs.length < savedTracks.length) {
                const idx = node.inputs.length;
                node.addInput(`SSG_${idx}`, "*");
            }
            while (node.inputs && node.inputs.length > savedTracks.length) {
                node.removeInput(node.inputs.length - 1);
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

            node.properties.pipe_manifest = JSON.stringify(savedTracks);

            if (channelName && savedTracks.length > 0) {
                registerChannel(channelName, savedTracks, genW?.value || 1, false);
            }

            node.size = [SSG_DEFAULT_WIDTH, Math.max(100, (node.inputs ? node.inputs.length * 20 : 0) + 70)];
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
        node.size = [SSG_DEFAULT_WIDTH, 120];
        node.properties = node.properties || {};
        node.properties.is_locked = false;
        node._isEditMode = true;

        if (!node.properties.channel_id) {
            node.properties.channel_id = getNextSequentialPipeName(app, node);
        }

        if (node.properties.pipe_manifest === undefined) {
            node.properties.pipe_manifest = "";
        }

        while (node.outputs && node.outputs.length > 0) {
            node.removeOutput(0);
        }

        while (node.inputs && node.inputs.length > 1) {
            node.removeInput(node.inputs.length - 1);
        }
        if (node.inputs && node.inputs.length === 1) {
            node.inputs[0].name = "SSG_0";
            node.inputs[0].label = "◦";
            node.inputs[0].type = "*";
        }

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
            ctx.fillText(`CH: ${chanId}`, margin + (drawWidth / 2), y + (drawHeight / 2));
            ctx.restore();
        };

        channelDisplayWidget.computeSize = function () {
            return [SSG_DEFAULT_WIDTH, 26];
        };
        // ----------------------------------------------

        const genWidget = node.widgets?.find(w => w.name === "schema_generation");

        node.refreshSlotLayout = function () {
            while (node.outputs && node.outputs.length > 0) {
                node.removeOutput(0);
            }

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
                });

                node.properties.pipe_manifest = JSON.stringify(currentTracks);

                if (channelName) {
                    registerChannel(channelName, currentTracks, genWidget?.value || 1, true);
                }
            } else {
                let savedTracks = [];
                try {
                    savedTracks = JSON.parse(node.properties.pipe_manifest || "[]");
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

                const currentTracks = [];
                node.inputs.forEach((input, idx) => {
                    input.name = `SSG_${idx}`;
                    if (input.link !== null && input.link !== undefined) {
                        const link = getGraphLink(app, node, input.link);
                        if (link) {
                            const resolved = findTrueUpstreamAnchor(app, node, link.origin_id, link.origin_slot);
                            input.label = resolved.name;
                            input.type = resolved.type;
                        }
                    }
                    currentTracks.push({ index: idx, name: input.label || input.name, type: input.type });
                });

                node.properties.pipe_manifest = JSON.stringify(currentTracks);

                if (channelName) {
                    registerChannel(channelName, currentTracks, genWidget?.value || 1, false);
                }
            }

            node.size = [SSG_DEFAULT_WIDTH, Math.max(100, (node.inputs.length * 20) + 70)];
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
                    });

                    node.properties.pipe_manifest = JSON.stringify(currentTracks);

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

        const channelName = node.properties.channel_id;

        let activeTier = DIAGNOSTIC_TIERS.TIER_0_NOMINAL;
        const hasBrokenLockedLink = !node._isEditMode && node.inputs && node.inputs.length > 0 && node.inputs.some(i => i.link === null || i.link === undefined);

        let hasTypeMismatch = false;
        let hasNameMismatch = false;

        if (!node._isEditMode && node.inputs && node.inputs.length > 0) {
            let savedTracks = [];
            try {
                savedTracks = JSON.parse(node.properties.pipe_manifest || "[]");
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
            const activeCount = node.inputs?.filter(i => i.link !== null && i.link !== undefined).length || 0;
            const modeState = node._isEditMode ? "EDIT" : "LOCKED";
            const customTitle = node.title !== "Pipe" && node.title !== "SSG Smart Pipe" ? ` - ${node.title}` : "";
            const badgeLabel = `TX: ${cleanName}${customTitle} [${activeCount} Trk | ${modeState}]`;

            drawMasterGlobalTooltip(node, ctx, app, badgeLabel);
        }
    };
}