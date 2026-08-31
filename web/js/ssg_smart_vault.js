// ==========================================================================
// SSG CUSTOM NODE ECOSYSTEM (V2 ARCHITECTURE)
// Module: SSG Smart Vault (Master Inline RAM/VRAM Storage & Engine Severer)
// File: /web/js/ssg_smart_vault.js
// ==========================================================================

import {
    SSG_DEFAULT_WIDTH,
    DIAGNOSTIC_TIERS,
    sanitizeAndTruncateText,
    applyDynamicShavePass,
    drawSSGWarningOutline,
    drawMasterGlobalTooltip,
    findTrueUpstreamAnchor,
    syncIncomingProperties,
    forceNetworkUpdate,
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

function getTrackInputs(node) {
    if (!node.inputs) return [];
    return node.inputs.filter(inp => inp.name && inp.name.startsWith("SSG_"));
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

        if (!node.properties.channel_id && node.properties.vault_id) {
            node.properties.channel_id = node.properties.vault_id;
        }

        const manifestVal = node.properties.vault_manifest;

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
                const lastTrack = trackInputs[trackInputs.length - 1];
                const realIdx = node.inputs.indexOf(lastTrack);
                node.removeInput(realIdx);
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

            node.properties.vault_manifest = JSON.stringify(savedTracks);
            node.size = [SSG_DEFAULT_WIDTH, Math.max(100, (targetSlots * 20) + 90)];
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
        node.size = [SSG_DEFAULT_WIDTH, 130];
        node.properties = node.properties || {};
        node.properties.is_locked = false;
        node._isEditMode = true;

        if (!node.properties.channel_id) {
            node.properties.channel_id = getNextSequentialVaultName(app, node);
        }
        node.properties.vault_id = node.properties.channel_id;

        if (node.properties.vault_manifest === undefined) {
            node.properties.vault_manifest = "";
        }

        let trackInputs = getTrackInputs(node);
        while (trackInputs.length > 1) {
            const lastTrack = trackInputs[trackInputs.length - 1];
            node.removeInput(node.inputs.indexOf(lastTrack));
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
                forceNetworkUpdate(app);
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
                forceNetworkUpdate(app);
                if (node.graph) node.graph.setDirtyCanvas(true, true);
            };
        }

        node.refreshSlotLayout = function () {
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
                    const lastTrack = trackInputs[trackInputs.length - 1];
                    node.removeInput(node.inputs.indexOf(lastTrack));
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

                node.properties.vault_manifest = JSON.stringify(currentTracks);
            } else {
                let savedTracks = [];
                try {
                    savedTracks = JSON.parse(node.properties.vault_manifest || "[]");
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
                    const lastTrack = trackInputs[trackInputs.length - 1];
                    node.removeInput(node.inputs.indexOf(lastTrack));
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

                node.properties.vault_manifest = JSON.stringify(currentTracks);
            }

            node.size = [SSG_DEFAULT_WIDTH, Math.max(100, (trackInputs.length * 20) + 90)];
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

                    node.properties.vault_manifest = JSON.stringify(currentTracks);
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
        setTimeout(() => {
            forceNetworkUpdate(app);
        }, 30);
    };

    const origOnDrawForeground = nodeType.prototype.onDrawForeground;
    nodeType.prototype.onDrawForeground = function (ctx) {
        if (origOnDrawForeground) origOnDrawForeground.apply(this, arguments);

        const node = this;

        const channelName = node.properties.channel_id || node.properties.vault_id;
        const flushWidget = node.widgets?.find(w => w.name === "flush_switch");
        const cacheWidget = node.widgets?.find(w => w.name === "cache_switch");

        const isRecording = flushWidget?.value === true && !cacheWidget?.value;
        const isPlayback = cacheWidget?.value === true;

        if (node.flags?.collapsed) {
            node.title = "Vault";
        } else {
            let stateBadge = "❄";
            if (isRecording) stateBadge = "🔴";
            else if (isPlayback) stateBadge = "⚡";

            node.title = `SSG Smart Vault ${stateBadge}`;
        }

        const trackInputs = getTrackInputs(node);
        let activeTier = DIAGNOSTIC_TIERS.TIER_0_NOMINAL;
        const hasBrokenInputLink = !node._isEditMode && trackInputs.length > 0 && trackInputs.some(i => i.link === null || i.link === undefined);

        let hasTypeMismatch = false;
        let hasNameMismatch = false;

        if (!node._isEditMode && trackInputs.length > 0) {
            let savedTracks = [];
            try {
                savedTracks = JSON.parse(node.properties.vault_manifest || "[]");
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
            const activeCount = trackInputs.filter(i => i.link !== null && i.link !== undefined).length || 0;
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