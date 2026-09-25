// ==========================================================================
// SSG CUSTOM NODE ECOSYSTEM (V4 ARCHITECTURE)
// Module: SSG Smart Satellite (Multi-Track Bus Consumer)
// File: /web/js/ssg_smart_satellite.js
// ==========================================================================

import {
    SSG_DEFAULT_WIDTH,
    SSG_COLOR_YELLOW_TOPAZ,
    SSG_COLOR_FIRE_OPAL,
    SSG_COLOR_RUBY_RED,
    SSG_COLOR_MUTED,
    sanitizeAndTruncateText,
    getChannelRecord,
    isChannelBypassed,
    scanActiveBroadcasters,
    syncIncomingProperties,
    forceNetworkUpdate,
    updateNodeBounds,
    isFrontendVersionAtLeast
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
        if (boundGenWidget && boundGenWidget.value !== undefined) {
            node._ssgBoundGeneration = boundGenWidget.value;
        }

        const isPruned = node.properties.is_pruned ?? true;
        node._isSpawned = !isPruned;

        const actionButton = node.widgets?.find(
            w => w.name === "[ Spawn Tracks ]" || w.name === "[ Prune Unused ]" || w.name === "[ Spawn / Prune ]"
        );

        if (actionButton) {
            const supportsDynamicButton = isFrontendVersionAtLeast("1.53.6", app);
            if (supportsDynamicButton) {
                const nextLabel = node._isSpawned ? "[ Prune Unused ]" : "[ Spawn Tracks ]";
                actionButton.name = nextLabel;
                actionButton.label = nextLabel;
            } else {
                actionButton.name = "[ Spawn / Prune ]";
                actionButton.label = "[ Spawn / Prune ]";
            }
            actionButton.triggerDraw?.();
        }

        if (node.properties.setup_completed === undefined) {
            node.properties.setup_completed = (node.outputs && node.outputs.length > 0 && node.outputs.some(o => o.links && o.links.length > 0));
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
        } else if (typeof node.updateSatelliteBannerState === "function") {
            node.updateSatelliteBannerState();
        }

        const currentWidth = Math.max(SSG_DEFAULT_WIDTH, node.size ? node.size[0] : SSG_DEFAULT_WIDTH);
        const targetHeight = Math.max(80, (node.outputs ? node.outputs.length * 20 : 0) + 95);
        updateNodeBounds(node, currentWidth, targetHeight);
    };

    const origOnNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
        if (origOnNodeCreated) origOnNodeCreated.apply(this, arguments);

        const node = this;
        const initialWidth = Math.max(SSG_DEFAULT_WIDTH, node.size ? node.size[0] : SSG_DEFAULT_WIDTH);
        node.size = [initialWidth, 100];
        node.properties = node.properties || {};
        node.properties.is_pruned = true;
        node.properties.bound_channel = "";
        node.properties.bound_generation = 0;
        node.properties.setup_completed = false;
        node._ssgBoundGeneration = 0;
        node._ssgBoundChannel = "";
        node._isSpawned = false;
        node._isLoading = false;
        node._isMutatingTracks = false;

        while (node.outputs && node.outputs.length > 0) {
            node.removeOutput(0);
        }
        node.outputs = [];

        let channelWidget = node.widgets?.find(w => w.name === "channel");
        const boundGenWidget = node.widgets?.find(w => w.name === "bound_generation");

        // Slot 0: Native DOM Status Banner Widget
        const domBannerWidget = createSSGDOMBanner(node, {
            widgetName: "channel_display",
            initialText: "CH: Available",
            initialColor: SSG_COLOR_YELLOW_TOPAZ
        });

        node.updateSatelliteBannerState = function () {
            const chW = node.widgets?.find(w => w.name === "channel");
            const targetChan = chW?.value || node.properties?.bound_channel || "Available";
            const record = getChannelRecord(targetChan);
            const isBypassed = isChannelBypassed(targetChan);

            let displayText = `CH: ${targetChan}`;
            let bannerColor = SSG_COLOR_NOMINAL;

            // Priority 0: Fault / Missing / Available
            if (!targetChan || targetChan === "Available" || targetChan === "Default") {
                displayText = "CH: Available";
                bannerColor = SSG_COLOR_YELLOW_TOPAZ;
            } else if (targetChan === "Unavailable" || !record) {
                displayText = targetChan === "Unavailable" ? "CH: Unavailable" : `CH: ${targetChan}`;
                bannerColor = SSG_COLOR_RUBY_RED;
            }
            // Priority 1: Hardware Injection Loop Bypass
            else if (isBypassed) {
                displayText = "Injection Bypass Detected";
                bannerColor = SSG_COLOR_MUTED;
            }
            // Priority 2: Broadcaster Active Edit Mode (Tier 1 Warning)
            else if (record.is_editing) {
                displayText = `CH: ${targetChan} [Edit Mode]`;
                bannerColor = SSG_COLOR_YELLOW_TOPAZ;
            }
            // Priority 3: Satellite Configuration State (Spawn Mode / Fresh Canvas Drop)
            else if (node._isSpawned || !node.properties?.setup_completed) {
                displayText = `CH: ${targetChan} [Setup Active]`;
                bannerColor = SSG_COLOR_YELLOW_TOPAZ;
            }
            // Priority 4: Integrity Fault / Schema Drift / Desync (Tier 2 Warning)
            else {
                let hasMismatch = false;

                // A. Generation Drift between Broadcaster and Consumer
                if (record.generation !== (node.properties?.bound_generation ?? node._ssgBoundGeneration)) {
                    hasMismatch = true;
                }

                // B. Zero Output Fault after Completed Setup
                if (!node.outputs || node.outputs.length === 0) {
                    hasMismatch = true;
                }

                // C. Track Structural Integrity Verification
                if (!hasMismatch && node.outputs) {
                    for (let i = 0; i < node.outputs.length; i++) {
                        const out = node.outputs[i];
                        const masterTrack = record.tracks.find(t => t.index === out._trackIdx);
                        const currentName = out.label || out.name;

                        if (!masterTrack || masterTrack.name !== currentName || (masterTrack.type && masterTrack.type !== "*" && masterTrack.type !== out.type)) {
                            hasMismatch = true;
                            break;
                        }
                    }
                }

                node._ssgTrackMismatch = hasMismatch;

                if (hasMismatch) {
                    displayText = `CH: ${targetChan} [Desync]`;
                    bannerColor = SSG_COLOR_FIRE_OPAL;
                } else {
                    displayText = `CH: ${targetChan}`;
                    bannerColor = SSG_COLOR_NOMINAL;
                }
            }

            if (typeof node.updateSSGBanner === "function") {
                node.updateSSGBanner(displayText, bannerColor);
            }
        };

        node._ssgTrackMismatch = false;

        function spawnChannelTracks() {
            if (node._isMutatingTracks) return false;
            node._isMutatingTracks = true;

            try {
                const chW = node.widgets?.find(w => w.name === "channel");
                const targetChannel = chW?.value;
                if (!targetChannel || targetChannel === "Available" || targetChannel === "Unavailable") {
                    return false;
                }

                const record = getChannelRecord(targetChannel);
                if (!record || !record.tracks || record.tracks.length === 0) {
                    return false;
                }

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
                return true;
            } finally {
                node._isMutatingTracks = false;
            }
        }

        function pruneUnwiredTracks() {
            if (node._isMutatingTracks) return false;
            node._isMutatingTracks = true;

            try {
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

                let hasWiredLink = false;
                node.outputs.forEach((out, idx) => {
                    if (out.links && out.links.length > 0) {
                        hasWiredLink = true;
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
                node.properties.setup_completed = hasWiredLink;

                node._ssgTrackMismatch = false;
                node._isSpawned = false;
                node.properties.is_pruned = true;
                return true;
            } finally {
                node._isMutatingTracks = false;
            }
        }

        const supportsDynamicButton = isFrontendVersionAtLeast("1.53.6", app);
        const dynamicLabel = node._isSpawned ? "[ Prune Unused ]" : "[ Spawn Tracks ]";
        const initialButtonLabel = supportsDynamicButton ? dynamicLabel : "[ Spawn / Prune ]";

        const actionButton = {
            type: "button",
            name: initialButtonLabel,
            label: initialButtonLabel,
            value: null,
            callback: () => {
                let mutated = false;

                if (!node._isSpawned) {
                    mutated = spawnChannelTracks();
                } else {
                    mutated = pruneUnwiredTracks();
                }

                if (supportsDynamicButton) {
                    const nextLabel = node._isSpawned ? "[ Prune Unused ]" : "[ Spawn Tracks ]";
                    actionButton.name = nextLabel;
                    actionButton.label = nextLabel;
                } else {
                    actionButton.name = "[ Spawn / Prune ]";
                    actionButton.label = "[ Spawn / Prune ]";
                }

                if (typeof node.onWidgetChanged === "function") {
                    node.onWidgetChanged(actionButton.name, actionButton.value, null, actionButton);
                }

                if (mutated) {
                    const currentWidth = Math.max(SSG_DEFAULT_WIDTH, node.size ? node.size[0] : SSG_DEFAULT_WIDTH);
                    const targetHeight = Math.max(80, (node.outputs ? node.outputs.length * 20 : 0) + 95);
                    updateNodeBounds(node, currentWidth, targetHeight);

                    actionButton.triggerDraw?.();
                    node.updateSatelliteBannerState();
                    node.setDirtyCanvas(true, true);

                    if (node.graph) {
                        node.graph._version = (node.graph._version || 0) + 1;
                        node.graph.setDirtyCanvas(true, true);
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
            }
        };

        if (!channelWidget) {
            channelWidget = node.addWidget("combo", "channel", "Available", (v) => {
                const clean = (v || "").trim();
                if (clean !== "Available" && clean !== "Unavailable" && clean !== "Default") {
                    node.properties.bound_channel = clean;
                    node._ssgBoundChannel = clean;
                }
                refreshChannelDropdown(node, app);
                if (typeof node.networkSyncCheck === "function") {
                    node.networkSyncCheck();
                }
                node.updateSatelliteBannerState();
                if (node.graph) node.graph.setDirtyCanvas(true, true);
                forceNetworkUpdate(app);
            }, { values: ["Available"] });
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
                node.updateSatelliteBannerState();
                if (origCallback) origCallback.apply(this, arguments);
                if (node.graph) node.graph.setDirtyCanvas(true, true);
                forceNetworkUpdate(app);
            };
        }

        if (channelWidget) {
            const origMouse = channelWidget.mouse;
            channelWidget.mouse = function () {
                refreshChannelDropdown(node, app);
                node.updateSatelliteBannerState();
                if (origMouse) return origMouse.apply(this, arguments);
            };
        }

        node.networkSyncCheck = function () {
            if (node._ssgStartupGrace || node._isMutatingTracks) return;

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
                    for (let i = 0; i < node.outputs.length; i++) {
                        const out = node.outputs[i];
                        const masterTrack = record.tracks.find(t => t.index === out._trackIdx);
                        const currentName = out.label || out.name;
                        if (!masterTrack || masterTrack.name !== currentName || (masterTrack.type && masterTrack.type !== "*" && masterTrack.type !== out.type)) {
                            mismatch = true;
                            break;
                        }
                    }
                }

                node._ssgTrackMismatch = mismatch;

                if (mismatch && !node._isSpawned) {
                    if (supportsDynamicButton) {
                        actionButton.name = "[ Spawn Tracks ]";
                        actionButton.label = "[ Spawn Tracks ]";
                    } else {
                        actionButton.name = "[ Spawn / Prune ]";
                        actionButton.label = "[ Spawn / Prune ]";
                    }
                    actionButton.triggerDraw?.();
                }
            }

            node.updateSatelliteBannerState();
            actionButton.triggerDraw?.();
            if (node.graph) node.graph.setDirtyCanvas(true, true);
        };

        node._ssgRefreshDropdown = () => {
            if (typeof node.networkSyncCheck === "function") {
                node.networkSyncCheck();
            } else {
                node.updateSatelliteBannerState();
            }
            actionButton.triggerDraw?.();
            if (node.graph) node.graph.setDirtyCanvas(true, true);
        };

        const remainingWidgets = (node.widgets || []).filter(
            w => w !== domBannerWidget && w !== actionButton && w !== channelWidget
        );
        node.widgets = [domBannerWidget, actionButton, channelWidget, ...remainingWidgets].filter(Boolean);

        refreshChannelDropdown(node, app);
        node.updateSatelliteBannerState();
        const nodeWidth = Math.max(SSG_DEFAULT_WIDTH, node.size ? node.size[0] : SSG_DEFAULT_WIDTH);
        updateNodeBounds(node, nodeWidth, 100);
    };

    const origOnDrawForeground = nodeType.prototype.onDrawForeground;
    nodeType.prototype.onDrawForeground = function (ctx) {
        if (origOnDrawForeground) origOnDrawForeground.apply(this, arguments);
    };
}