// ==========================================================================
// SSG CUSTOM NODE ECOSYSTEM (V2 ARCHITECTURE)
// Module: SSG Smart Satellite (Multi-Track Bus Consumer)
// File: /web/js/ssg_smart_satellite.js
// ==========================================================================

import {
    SSG_DEFAULT_WIDTH,
    DIAGNOSTIC_TIERS,
    sanitizeAndTruncateText,
    applyDynamicShavePass,
    drawSSGWarningOutline,
    drawMasterGlobalTooltip,
    getChannelRecord,
    scanActiveBroadcasters,
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

function refreshChannelDropdown(node, app) {
    const channelWidget = node.widgets?.find(w => w.name === "channel");
    if (!channelWidget) return;

    const activeChannels = scanActiveBroadcasters(app).filter(
        c => !c.endsWith("_RX") && !c.endsWith("_TX")
    );

    const currentVal = channelWidget.value;
    const boundVal = node.properties?.bound_channel || node._ssgBoundChannel;
    const channelSet = new Set(activeChannels);

    if (currentVal && currentVal !== "Available" && currentVal !== "Unavailable" && currentVal !== "Default") {
        channelSet.add(currentVal);
    }
    if (boundVal && boundVal !== "Available" && boundVal !== "Unavailable" && boundVal !== "Default") {
        channelSet.add(boundVal);
    }

    const validChannels = Array.from(channelSet);

    if (validChannels.length === 0) {
        channelWidget.options = channelWidget.options || {};
        channelWidget.options.values = ["Unavailable"];
        if (boundVal) {
            channelWidget.value = boundVal;
        } else if (!node._isLoading && channelWidget.value !== "Unavailable") {
            channelWidget.value = "Unavailable";
        }
    } else {
        const menuOptions = ["Available", ...validChannels];
        channelWidget.options = channelWidget.options || {};
        channelWidget.options.values = menuOptions;

        if (boundVal && validChannels.includes(boundVal)) {
            channelWidget.value = boundVal;
        } else if (!channelWidget.value || channelWidget.value === "Unavailable" || channelWidget.value === "Default") {
            channelWidget.value = "Available";
        }
    }
}

export function setupSmartSatellite(nodeType, nodeData, app) {
    const origOnConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function (info) {
        syncIncomingProperties(this, info);

        if (origOnConfigure) origOnConfigure.apply(this, arguments);

        const node = this;
        node.properties = node.properties || {};

        node._ssgBoundGeneration = node.properties.bound_generation ?? 0;
        node._ssgBoundChannel = node.properties.bound_channel || "";

        const boundGenWidget = node.widgets?.find(w => w.name === "bound_generation");
        const actionButton = node.widgets?.find(w => w.name === "[ Spawn Tracks ]" || w.name === "[ Prune Unused ]");

        if (boundGenWidget && boundGenWidget.value !== undefined) {
            node._ssgBoundGeneration = boundGenWidget.value;
        }

        const isPruned = node.properties.is_pruned ?? true;
        if (isPruned) {
            node._isSpawned = false;
            if (actionButton) actionButton.name = "[ Spawn Tracks ]";
        } else {
            node._isSpawned = true;
            if (actionButton) actionButton.name = "[ Prune Unused ]";
        }

        const manifestVal = node.properties?.satellite_manifest;

        if (manifestVal && node.outputs) {
            try {
                const savedTracks = typeof manifestVal === "string"
                    ? JSON.parse(manifestVal)
                    : manifestVal;

                if (Array.isArray(savedTracks)) {
                    savedTracks.forEach((track, idx) => {
                        if (node.outputs[idx]) {
                            node.outputs[idx]._trackIdx =
                                track.index !== undefined ? track.index : idx;

                            if (track.type && track.type !== "*") {
                                node.outputs[idx].type = track.type;
                            }
                        }
                    });
                }
            } catch (e) {
                console.warn(
                    "[SSG Satellite] Failed to parse saved manifest during configure:",
                    e
                );
            }
        }

        refreshChannelDropdown(node, app);
        if (typeof node.networkSyncCheck === "function") {
            node.networkSyncCheck();
        }

        if (node.graph) node.graph.setDirtyCanvas(true, true);
    };

    const origOnNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
        if (origOnNodeCreated) origOnNodeCreated.apply(this, arguments);

        const node = this;
        node.size = [SSG_DEFAULT_WIDTH, 100];
        node.properties = node.properties || {};
        node.properties.is_pruned = true;
        node.properties.bound_channel = "";
        node.properties.bound_generation = 0;
        node._ssgBoundGeneration = 0;
        node._ssgBoundChannel = "";
        node._isSpawned = false;
        node._isLoading = false;

        while (node.outputs && node.outputs.length > 0) {
            node.removeOutput(0);
        }
        node.outputs = [];

        let channelWidget = node.widgets?.find(w => w.name === "channel");
        const boundGenWidget = node.widgets?.find(w => w.name === "bound_generation");

        if (!channelWidget) {
            channelWidget = node.addWidget("combo", "channel", "Unavailable", (v) => {
                const clean = (v || "").trim();
                if (clean !== "Available" && clean !== "Unavailable" && clean !== "Default") {
                    node.properties.bound_channel = clean;
                    node._ssgBoundChannel = clean;
                }
                refreshChannelDropdown(node, app);
                if (typeof node.networkSyncCheck === "function") {
                    node.networkSyncCheck();
                }
                if (node.graph) node.graph.setDirtyCanvas(true, true);
            }, { values: ["Unavailable"] });
        } else {
            const origCallback = channelWidget.callback;
            channelWidget.callback = function (v) {
                const clean = (v || "").trim();
                if (clean !== "Available" && clean !== "Unavailable" && clean !== "Default") {
                    node.properties.bound_channel = clean;
                    node._ssgBoundChannel = clean;
                }
                refreshChannelDropdown(node, app);
                if (typeof node.networkSyncCheck === "function") {
                    node.networkSyncCheck();
                }
                if (origCallback) origCallback.apply(this, arguments);
                if (node.graph) node.graph.setDirtyCanvas(true, true);
            };
        }

        // Defensive refresh on dropdown interaction
        if (channelWidget) {
            const origMouse = channelWidget.mouse;
            channelWidget.mouse = function() {
                refreshChannelDropdown(node, app);
                if (origMouse) return origMouse.apply(this, arguments);
            };
        }

        node._ssgTrackMismatch = false;

        node.networkSyncCheck = function () {
            if (node._ssgStartupGrace) return;

            refreshChannelDropdown(node, app);
            const targetChannel = channelWidget?.value;
            const record = getChannelRecord(targetChannel);
            const boundChan = node.properties?.bound_channel || node._ssgBoundChannel || "";

            if (!record && targetChannel !== "Available" && targetChannel !== "Unavailable" && targetChannel !== "Default") {
                if (!boundChan || boundChan === targetChannel) {
                    node._ssgTrackMismatch = false;
                }
            } else if (record) {
                let mismatch = false;

                if (targetChannel !== boundChan) {
                    mismatch = true;
                }

                if (record.generation !== (node.properties?.bound_generation ?? node._ssgBoundGeneration)) {
                    mismatch = true;
                }

                if (node.outputs) {
                    node.outputs.forEach(out => {
                        if (out.links && out.links.length > 0) {
                            const masterTrack = record.tracks.find(t => t.index === out._trackIdx);
                            const currentName = out.label || out.name;
                            if (!masterTrack || masterTrack.name !== currentName || masterTrack.type !== out.type) {
                                mismatch = true;
                            }
                        }
                    });
                }

                node._ssgTrackMismatch = mismatch;

                if (mismatch && !node._isSpawned) {
                    const btn = node.widgets?.find(w => w.name === "[ Prune Unused ]" || w.name === "[ Spawn Tracks ]");
                    if (btn) btn.name = "[ Spawn Tracks ]";
                }
            }
            if (node.graph) node.graph.setDirtyCanvas(true, true);
        };

        node._ssgRefreshDropdown = () => {
            if (typeof node.networkSyncCheck === "function") {
                node.networkSyncCheck();
            }
        };

        function spawnChannelTracks() {
            const targetChannel = channelWidget?.value;
            if (!targetChannel || targetChannel === "Available" || targetChannel === "Unavailable") return;

            const record = getChannelRecord(targetChannel);
            if (!record || !record.tracks || record.tracks.length === 0) return;

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

            if (boundGenWidget) boundGenWidget.value = record.generation;

            node.properties.satellite_manifest = record.tracks.map(track => ({
                index: track.index,
                name: track.name,
                type: track.type
            }));

            node._ssgTrackMismatch = false;
            node._isSpawned = true;
            node.properties.is_pruned = false;
            node.size = [SSG_DEFAULT_WIDTH, Math.max(100, (node.outputs.length * 20) + 70)];
            if (node.graph) node.graph.setDirtyCanvas(true, true);
        }

        function pruneUnwiredTracks() {
            const survivingTracks = [];
            for (let i = node.outputs.length - 1; i >= 0; i--) {
                const links = node.outputs[i].links;
                if (!links || links.length === 0) {
                    node.removeOutput(i);
                } else {
                    links.forEach(linkId => {
                        const graphLink = getGraphLink(app, node, linkId);
                        if (graphLink) {
                            graphLink.origin_slot = i;
                        }
                    });
                }
            }

            node.outputs.forEach((out, idx) => {
                if (out.links) {
                    out.links.forEach(linkId => {
                        const graphLink = getGraphLink(app, node, linkId);
                        if (graphLink) {
                            graphLink.origin_slot = idx;
                        }
                    });
                }
                survivingTracks.push({
                    index: out._trackIdx !== undefined ? out._trackIdx : idx,
                    name: out.name,
                    type: out.type
                });
            });

            node.properties.satellite_manifest = survivingTracks;

            node._ssgTrackMismatch = false;
            node._isSpawned = false;
            node.properties.is_pruned = true;
            node.size = [SSG_DEFAULT_WIDTH, Math.max(80, (node.outputs.length * 20) + 70)];
            if (node.graph) node.graph.setDirtyCanvas(true, true);
        }

        const actionButton = node.addWidget(
            "button",
            node._isSpawned ? "[ Prune Unused ]" : "[ Spawn Tracks ]",
            null,
            () => {
                if (!node._isSpawned) {
                    spawnChannelTracks();
                    actionButton.name = "[ Prune Unused ]";
                } else {
                    pruneUnwiredTracks();
                    actionButton.name = "[ Spawn Tracks ]";
                }
            }
        );

        refreshChannelDropdown(node, app);
    };

    const origOnDrawForeground = nodeType.prototype.onDrawForeground;
    nodeType.prototype.onDrawForeground = function (ctx) {
        if (origOnDrawForeground) origOnDrawForeground.apply(this, arguments);

        const node = this;
        applyDynamicShavePass(node);

        let activeTier = DIAGNOSTIC_TIERS.TIER_0_NOMINAL;
        const channelWidget = node.widgets?.find(w => w.name === "channel");
        const targetChannel = channelWidget?.value;
        const record = getChannelRecord(targetChannel);
        const boundChan = node.properties?.bound_channel || node._ssgBoundChannel || "";
        const isChannelMismatch = targetChannel && targetChannel !== "Available" && targetChannel !== "Unavailable" && targetChannel !== boundChan;

        let hasTypeMismatch = false;
        if (node.outputs) {
            for (const out of node.outputs) {
                if (out.links && out.links.length > 0 && out.type !== "*") {
                    for (const linkId of out.links) {
                        const link = getGraphLink(app, node, linkId);
                        if (link) {
                            const targetGraph = node.graph || app.graph;
                            const targetNode = targetGraph?.getNodeById ? targetGraph.getNodeById(link.target_id) : app.graph?.getNodeById(link.target_id);
                            const targetInput = targetNode?.inputs?.[link.target_slot];
                            if (targetInput && targetInput.type !== "*" && targetInput.type !== out.type) {
                                hasTypeMismatch = true;
                                break;
                            }
                        }
                    }
                }
                if (hasTypeMismatch) break;
            }
        }

        const isUpstreamEditing = record?.is_editing === true;

        if (!targetChannel || targetChannel === "Unavailable" || targetChannel === "Available") {
            activeTier = DIAGNOSTIC_TIERS.TIER_3_RED;
        } else if (!node._ssgStartupGrace && (hasTypeMismatch || node._ssgTrackMismatch)) {
            activeTier = DIAGNOSTIC_TIERS.TIER_2_ORANGE;
        } else if (node._isSpawned || isUpstreamEditing || isChannelMismatch) {
            activeTier = DIAGNOSTIC_TIERS.TIER_1_YELLOW;
        }

        drawSSGWarningOutline(node, ctx, activeTier);

        if (node.flags?.collapsed) {
            const cleanChannel = sanitizeAndTruncateText(targetChannel || "Available", 16);
            const activeOutputs = node.outputs?.filter(o => o.links && o.links.length > 0).length || 0;
            const badgeLabel = `RX: ${cleanChannel} [${activeOutputs} Trk Active]`;
            drawMasterGlobalTooltip(node, ctx, app, badgeLabel);
        }
    };
}