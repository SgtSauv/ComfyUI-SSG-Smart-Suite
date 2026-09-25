// ==========================================================================
// SSG CUSTOM NODE ECOSYSTEM (V4 ARCHITECTURE)
// Module: SSG Smart HUD & Command Deck (Transmitter Directory & Telemetry)
// File: /web/js/ssg_smart_hud.js
// Status: Array-Normalized Multi-Pill Cluster Ingestion & Bus Transceiver Directory
// ==========================================================================

import {
    SSG_DEFAULT_WIDTH,
    getAllGraphNodes,
    focusAndCenterOnNode,
    toggleChannelHighlight,
    isChannelHighlighted,
    getChannelRecord,
    registerChannel,
    sanitizeAndTruncateText,
    forceNetworkUpdate,
    findTrueUpstreamAnchor,
    updateNodeBounds
} from "./ssg_core_utils.js";
import { isTransceiverModule } from "./ssg_smart_socket.js";

// Calibrated HUD Telemetry Tokens
export const HUD_COLOR_CYAN = "#00e5ff";
export const HUD_COLOR_YELLOW = "#ffcc00";
export const HUD_COLOR_ORANGE = "#ff7700";
export const HUD_COLOR_RED = "#ff3333";
export const HUD_COLOR_PLAYBACK = "#00ff88";
export const HUD_COLOR_FROZEN = "#38bdf8";
export const HUD_COLOR_PURPLE = "#b026ff";
export const HUD_COLOR_MUTED = "#555b66";

const STORAGE_KEY_SHOW_NODE_IDS = "ssg_hud_show_node_ids";
const STORAGE_KEY_COLLAPSED_CATEGORIES = "ssg_hud_collapsed_categories";

let hudContainer = null;
let hudToggleBtn = null;
let hudContextMenu = null;
let activeDocsModal = null;
let isHudVisible = false;
let searchQuery = "";

// Dynamic Suite Metadata Cache
let cachedSuiteVersion = null;
let cachedHudGuide = null;
let isFetchingSuiteMetadata = false;

const storedShowNodeIdsPref = localStorage.getItem(STORAGE_KEY_SHOW_NODE_IDS);
let isShowNodeIdsEnabled = storedShowNodeIdsPref === "true";

const expandedChannels = new Set();

// Collapsed-by-default initialization with persistent session latch
const ALL_CATEGORIES = ["pipes", "routers", "gates", "vaults", "sockets", "tags"];
const storedCollapsedCategories = localStorage.getItem(STORAGE_KEY_COLLAPSED_CATEGORIES);
let collapsedCategories;
try {
    collapsedCategories = storedCollapsedCategories
        ? new Set(JSON.parse(storedCollapsedCategories))
        : new Set(ALL_CATEGORIES);
} catch (e) {
    collapsedCategories = new Set(ALL_CATEGORIES);
}

function saveCollapsedCategories() {
    try {
        localStorage.setItem(STORAGE_KEY_COLLAPSED_CATEGORIES, JSON.stringify(Array.from(collapsedCategories)));
    } catch (e) {
        // LocalStorage quota or access exception guard
    }
}

async function fetchSuiteMetadata() {
    if (cachedSuiteVersion && cachedHudGuide) {
        return { version: cachedSuiteVersion, hud_guide: cachedHudGuide };
    }
    if (isFetchingSuiteMetadata) return null;

    isFetchingSuiteMetadata = true;
    try {
        const resp = await fetch("/ssg/suite/docs");
        if (resp.ok) {
            const data = await resp.json();
            if (data.version) cachedSuiteVersion = data.version;
            if (data.hud_guide) cachedHudGuide = data.hud_guide;
            return data;
        }
    } catch (err) {
        console.warn("[SSG HUD] Failed to hydrate suite metadata from backend:", err);
    } finally {
        isFetchingSuiteMetadata = false;
    }
    return null;
}

function updateHUDTitleDisplay() {
    if (!hudContainer) return;
    const titleEl = hudContainer.querySelector(".ssg-hud-title");
    if (!titleEl) return;

    const versionToken = cachedSuiteVersion ? ` v${cachedSuiteVersion}` : "";
    titleEl.textContent = `SSG COMMAND DECK${versionToken}`;
}

function isRouterBankB(val) {
    return val === true || val === "Bank B" || val === "B" || val === 1 || val === "1";
}

function getNodeDisplayId(node) {
    if (!node || node.id === null || node.id === undefined) return null;
    return String(node.id);
}

function formatNodeLabel(baseName, node) {
    if (!isShowNodeIdsEnabled || !node) return baseName;
    const nodeId = getNodeDisplayId(node);
    return nodeId ? `${baseName} [#${nodeId}]` : baseName;
}

function isNodeInstanceOfModule(node, moduleId) {
    if (!node || !moduleId) return false;
    const schema = window.SSG_ModuleRegistry ? window.SSG_ModuleRegistry[moduleId] : null;

    if (schema) {
        if (schema.node_type && (node.type === schema.node_type || node.comfyClass === schema.node_type)) {
            return true;
        }
        if (schema.class_type && (node.type === schema.class_type || node.comfyClass === schema.class_type)) {
            return true;
        }
    }

    if (node.properties?.module_id === moduleId) {
        return true;
    }

    const cleanId = moduleId.replace(/^ssg_module_/, "");
    const pascal = "SSG" + cleanId.split("_").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join("");
    if (node.type === pascal || node.comfyClass === pascal) {
        return true;
    }

    if (schema?.display_name) {
        const cleanDisplay = schema.display_name.toLowerCase().replace(/\s+/g, "");
        const nodeTypeLower = (node.type || "").toLowerCase();
        const comfyLower = (node.comfyClass || "").toLowerCase();
        if (nodeTypeLower.includes(cleanDisplay) || comfyLower.includes(cleanDisplay)) {
            return true;
        }
    }

    return false;
}

function isSameModuleType(modA, modB) {
    if (!modA || !modB) return false;
    if (modA === modB) return true;
    const cleanA = modA.toLowerCase().replace(/^ssg_module_/, "").replace(/^ssg_/, "");
    const cleanB = modB.toLowerCase().replace(/^ssg_module_/, "").replace(/^ssg_/, "");
    return cleanA === cleanB;
}

function findAttachedModuleNode(socketChanId, modId, allGraphNodes) {
    if (!socketChanId || !allGraphNodes || allGraphNodes.length === 0) return null;
    for (const node of allGraphNodes) {
        if (!node) continue;
        const targetSock = node.properties?.target_socket || node.widgets?.find(w => w.name === "target_socket")?.value;
        if (targetSock === socketChanId) {
            if (!modId || isNodeInstanceOfModule(node, modId)) {
                return node;
            }
        }
    }
    return null;
}

function checkSocketHasModule(socketChanId, modId, allGraphNodes) {
    if (!socketChanId || !allGraphNodes || allGraphNodes.length === 0) return false;
    for (const node of allGraphNodes) {
        if (!node) continue;
        const targetSock = node.properties?.target_socket || node.widgets?.find(w => w.name === "target_socket")?.value;
        if (targetSock === socketChanId) {
            return true;
        }
    }
    return false;
}

function getTagDiagnosticTier(node, app) {
    if (!node) return "tier-nominal";

    const inLink = node.inputs?.[0]?.link;
    if (inLink === null || inLink === undefined) {
        return "tier-yellow";
    }

    const typeWidget = node.widgets?.find(w => w.name === "type_override");
    const explicitType = typeWidget?.value;

    if (explicitType && explicitType !== "AUTO" && explicitType !== "*") {
        const link = app?.graph?.links ? (Array.isArray(app.graph.links) ? app.graph.links.find(l => l && String(l.id) === String(inLink)) : app.graph.links[inLink]) : null;
        if (link) {
            const upstream = findTrueUpstreamAnchor(app, node, link.origin_id, link.origin_slot);
            if (upstream && upstream.type && upstream.type !== "*" && upstream.type !== explicitType) {
                return "tier-orange";
            }
        }
    }

    return "tier-nominal";
}

function getNodeDiagnosticTier(node, chanRecord = null) {
    if (!node) return "tier-nominal";
    if (node._isEditMode || node.properties?.is_editing) return "tier-yellow";

    if (node.type === "SSGSmartGate") {
        const injectW = node.widgets?.find(w => w.name === "injection_loop" || w.name === "injection_switch" || w.name === "injection");
        if (injectW?.value === true && node.properties?.channel_id) {
            const txRecord = getChannelRecord(`${node.properties.channel_id}_TX`);
            const rxRecord = getChannelRecord(`${node.properties.channel_id}_RX`);
            if (!txRecord || txRecord.is_editing || !rxRecord || rxRecord.is_editing || (txRecord.tracks.length !== rxRecord.tracks.length)) {
                return "tier-orange";
            }
        }
    }

    const trackInputs = node.inputs?.filter(inp => inp && inp.name && inp.name.startsWith("SSG_")) || [];
    if (!node._isEditMode && trackInputs.length > 0) {
        if (node.type === "SSGSmartRouter") {
            const bankW = node.widgets?.find(w => w.name === "router_switch");
            const isBankB = isRouterBankB(bankW?.value);
            const isBankA = !isBankB;
            const pairCount = Math.floor(trackInputs.length / 2);
            for (let i = 0; i < pairCount; i++) {
                const activeSlot = isBankA ? trackInputs[i * 2] : trackInputs[(i * 2) + 1];
                if (activeSlot && (activeSlot.link === null || activeSlot.link === undefined)) {
                    return "tier-orange";
                }
            }
        } else {
            if (trackInputs.some(i => i.link === null || i.link === undefined)) {
                return "tier-orange";
            }
        }
    }

    if (chanRecord && chanRecord.is_editing) {
        return "tier-yellow";
    }

    return "tier-nominal";
}

function createHUDStyles() {
    if (document.getElementById("ssg-smart-hud-styles")) return;

    const style = document.createElement("style");
    style.id = "ssg-smart-hud-styles";
    style.textContent = `
        .ssg-hud-container {
            position: fixed;
            top: 60px;
            right: 20px;
            width: ${SSG_DEFAULT_WIDTH + 60}px;
            max-height: 80vh;
            background: rgba(15, 18, 22, 0.95);
            border: 1px solid rgba(0, 229, 255, 0.35);
            border-radius: 6px;
            box-shadow: 0 8px 24px rgba(0, 0, 0, 0.6);
            z-index: 1000;
            display: flex;
            flex-direction: column;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, monospace;
            font-size: 11px;
            color: #d1d5db;
            user-select: none;
            overflow: hidden;
            box-sizing: border-box;
        }

        .ssg-hud-header {
            background: rgba(10, 12, 16, 0.98);
            padding: 8px 10px;
            border-bottom: 1px solid rgba(0, 229, 255, 0.2);
            display: flex;
            justify-content: space-between;
            align-items: center;
            cursor: move;
        }

        .ssg-hud-title {
            color: ${HUD_COLOR_CYAN};
            font-weight: bold;
            letter-spacing: 0.5px;
            font-family: 'Courier New', monospace;
        }

        .ssg-hud-header-actions {
            display: flex;
            align-items: center;
            gap: 6px;
        }

        .ssg-hud-icon-btn, .ssg-hud-help-btn, .ssg-hud-close-btn {
            background: transparent;
            border: none;
            color: #64748b;
            cursor: pointer;
            font-size: 13px;
            font-family: 'Courier New', monospace;
            font-weight: bold;
            padding: 0 4px;
            line-height: 1;
            transition: all 0.15s ease;
        }

        .ssg-hud-icon-btn:hover {
            color: #ffffff;
        }

        .ssg-hud-icon-btn.active {
            color: ${HUD_COLOR_CYAN};
            text-shadow: 0 0 6px ${HUD_COLOR_CYAN};
        }

        .ssg-hud-help-btn:hover {
            color: ${HUD_COLOR_CYAN};
        }

        .ssg-hud-close-btn:hover {
            color: #ffffff;
        }

        .ssg-hud-search-container {
            padding: 6px 8px;
            background: rgba(12, 15, 19, 0.9);
            border-bottom: 1px solid rgba(255, 255, 255, 0.05);
        }

        .ssg-hud-search-input {
            width: 100%;
            background: rgba(22, 27, 34, 0.8);
            border: 1px solid rgba(0, 229, 255, 0.25);
            border-radius: 4px;
            color: #e5e7eb;
            font-family: 'Courier New', monospace;
            font-size: 10px;
            padding: 4px 6px;
            outline: none;
            box-sizing: border-box;
        }

        .ssg-hud-search-input:focus {
            border-color: ${HUD_COLOR_CYAN};
            box-shadow: 0 0 4px rgba(0, 229, 255, 0.4);
        }

        .ssg-hud-body {
            overflow-y: auto;
            overflow-x: hidden;
            padding: 8px;
            flex: 1;
            box-sizing: border-box;
        }

        .ssg-hud-body::-webkit-scrollbar {
            width: 4px;
        }

        .ssg-hud-body::-webkit-scrollbar-thumb {
            background: rgba(0, 229, 255, 0.25);
            border-radius: 2px;
        }

        .ssg-hud-category {
            margin-bottom: 8px;
        }

        .ssg-hud-cat-title {
            font-size: 10px;
            font-weight: bold;
            color: #9ca3af;
            text-transform: uppercase;
            letter-spacing: 0.8px;
            padding: 3px 4px;
            border-bottom: 1px solid rgba(255, 255, 255, 0.08);
            margin-bottom: 4px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            cursor: pointer;
            transition: color 0.15s ease;
        }

        .ssg-hud-cat-title:hover {
            color: #ffffff;
        }

        .ssg-hud-cat-arrow {
            font-size: 8px;
            color: #64748b;
            transition: transform 0.2s ease;
        }

        .ssg-hud-cat-arrow.open {
            transform: rotate(90deg);
            color: ${HUD_COLOR_CYAN};
        }

        .ssg-hud-cat-content {
            display: flex;
            flex-direction: column;
            gap: 4px;
        }

        .ssg-hud-channel-row {
            background: rgba(22, 27, 34, 0.7);
            border: 1px solid rgba(255, 255, 255, 0.05);
            border-left: 3px solid rgba(0, 229, 255, 0.3);
            border-radius: 4px;
            overflow: hidden;
            transition: all 0.15s ease;
        }

        .ssg-hud-channel-row.tier-nominal {
            border-left-color: ${HUD_COLOR_CYAN};
        }

        .ssg-hud-channel-row.tier-yellow {
            border-left-color: ${HUD_COLOR_YELLOW};
        }

        .ssg-hud-channel-row.tier-orange {
            border-left-color: ${HUD_COLOR_ORANGE};
        }

        .ssg-hud-channel-row.tier-red {
            border-left-color: ${HUD_COLOR_RED};
        }

        .ssg-hud-channel-row.highlighted {
            box-shadow: inset 0 0 6px rgba(0, 229, 255, 0.4), 0 0 4px rgba(0, 229, 255, 0.3);
            border-color: rgba(0, 229, 255, 0.6);
        }

        .ssg-hud-channel-header {
            padding: 5px 8px;
            cursor: pointer;
            display: flex;
            justify-content: space-between;
            align-items: center;
            font-family: 'Courier New', monospace;
            font-weight: bold;
            color: ${HUD_COLOR_CYAN};
            transition: background 0.15s ease;
            gap: 4px;
        }

        .ssg-hud-channel-header:hover {
            background: rgba(0, 229, 255, 0.1);
        }

        .ssg-hud-header-left {
            display: flex;
            align-items: center;
            gap: 6px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            flex: 1;
        }

        .ssg-hud-row-title {
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        .ssg-hud-header-right {
            display: flex;
            align-items: center;
            gap: 4px;
            flex-shrink: 0;
        }

        .ssg-hud-badge-cluster {
            display: inline-flex;
            align-items: center;
            gap: 4px;
        }

        .ssg-hud-status-badge {
            font-size: 8px;
            padding: 1px 4px;
            border-radius: 3px;
            font-weight: bold;
            cursor: pointer;
            user-select: none;
            letter-spacing: 0.3px;
        }

        .ssg-hud-badge-active {
            background: rgba(0, 229, 255, 0.15);
            color: ${HUD_COLOR_CYAN};
            border: 1px solid rgba(0, 229, 255, 0.4);
        }

        .ssg-hud-badge-bank-b {
            background: rgba(56, 189, 248, 0.15);
            color: ${HUD_COLOR_FROZEN};
            border: 1px solid rgba(56, 189, 248, 0.4);
        }

        .ssg-hud-badge-bypass {
            background: rgba(85, 91, 102, 0.2);
            color: #9ca3af;
            border: 1px solid ${HUD_COLOR_MUTED};
        }

        .ssg-hud-badge-playback {
            background: rgba(0, 255, 136, 0.15);
            color: ${HUD_COLOR_PLAYBACK};
            border: 1px solid rgba(0, 255, 136, 0.4);
        }

        .ssg-hud-badge-buffer {
            background: rgba(176, 38, 255, 0.15);
            color: ${HUD_COLOR_PURPLE};
            border: 1px solid rgba(176, 38, 255, 0.4);
        }

        .ssg-hud-badge-frozen {
            background: rgba(56, 189, 248, 0.15);
            color: ${HUD_COLOR_FROZEN};
            border: 1px solid rgba(56, 189, 248, 0.4);
        }

        .ssg-hud-spawn-btn {
            font-size: 8px;
            padding: 1px 4px;
            border-radius: 3px;
            font-weight: bold;
            cursor: pointer;
            user-select: none;
            letter-spacing: 0.3px;
            background: rgba(0, 229, 255, 0.1);
            color: ${HUD_COLOR_CYAN};
            border: 1px solid rgba(0, 229, 255, 0.3);
            transition: all 0.15s ease;
        }

        .ssg-hud-spawn-btn:hover {
            background: rgba(0, 229, 255, 0.25);
            border-color: ${HUD_COLOR_CYAN};
            box-shadow: 0 0 4px rgba(0, 229, 255, 0.4);
        }

        .ssg-hud-spawn-btn.disabled {
            opacity: 0.35;
            cursor: not-allowed;
            border-color: #4b5563;
            color: #6b7280;
            background: transparent;
            box-shadow: none;
        }

        /* Dedicated 5-Lane Highway Transceiver & Extensible Mode Badges */
        .ssg-hud-bus-btn {
            font-size: 8.5px;
            padding: 1px 5px;
            border-radius: 3px;
            font-weight: bold;
            font-family: 'Courier New', monospace;
            cursor: pointer;
            user-select: none;
            letter-spacing: 0.4px;
            line-height: normal;
            transition: all 0.15s ease;
        }

        .ssg-hud-bus-btn.bus-active {
            background: rgba(0, 229, 255, 0.15);
            color: ${HUD_COLOR_CYAN};
            border: 1px solid rgba(0, 229, 255, 0.45);
        }

        .ssg-hud-bus-btn.bus-active:hover {
            background: rgba(0, 229, 255, 0.28);
            border-color: ${HUD_COLOR_CYAN};
            box-shadow: 0 0 5px rgba(0, 229, 255, 0.45);
        }

        .ssg-hud-bus-btn.bus-shadow {
            background: rgba(56, 189, 248, 0.15);
            color: ${HUD_COLOR_FROZEN};
            border: 1px solid rgba(56, 189, 248, 0.45);
        }

        .ssg-hud-bus-btn.bus-shadow:hover {
            background: rgba(56, 189, 248, 0.28);
            border-color: ${HUD_COLOR_FROZEN};
            box-shadow: 0 0 5px rgba(56, 189, 248, 0.45);
        }

        .ssg-hud-bus-btn.bus-collision {
            background: rgba(255, 119, 0, 0.2);
            color: ${HUD_COLOR_ORANGE};
            border: 1px solid ${HUD_COLOR_ORANGE};
            box-shadow: 0 0 4px rgba(255, 119, 0, 0.4);
        }

        .ssg-hud-bus-btn.bus-collision:hover {
            background: rgba(255, 119, 0, 0.35);
            box-shadow: 0 0 6px rgba(255, 119, 0, 0.6);
        }

        .ssg-hud-channel-arrow {
            font-size: 8px;
            color: #6b7280;
            padding: 2px 4px;
            cursor: pointer;
            transition: transform 0.2s ease, color 0.15s ease;
        }

        .ssg-hud-channel-arrow:hover {
            color: #ffffff;
        }

        .ssg-hud-channel-arrow.open {
            transform: rotate(90deg);
            color: ${HUD_COLOR_CYAN};
        }

        .ssg-hud-track-list {
            padding: 4px 8px 6px 12px;
            background: rgba(10, 12, 15, 0.5);
            border-top: 1px solid rgba(255, 255, 255, 0.03);
            display: flex;
            flex-direction: column;
            gap: 3px;
        }

        .ssg-hud-track-item {
            color: #e5e7eb;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            padding: 1px 0;
        }

        .ssg-hud-track-item.status-warning {
            color: ${HUD_COLOR_YELLOW};
            font-style: italic;
        }

        .ssg-hud-track-item.status-fault {
            color: ${HUD_COLOR_ORANGE};
            font-style: italic;
        }

        .ssg-hud-dock-wrapper {
            background: rgba(10, 12, 16, 0.98);
            border-top: 1px solid rgba(0, 229, 255, 0.2);
            display: flex;
            flex-direction: column;
        }

        .ssg-hud-dock-header {
            font-size: 9px;
            font-weight: bold;
            color: #9ca3af;
            text-transform: uppercase;
            letter-spacing: 0.6px;
            padding: 4px 8px 2px 8px;
            font-family: 'Courier New', monospace;
            text-align: center;
            border-bottom: 1px solid rgba(255, 255, 255, 0.04);
        }

        .ssg-hud-palette {
            padding: 5px 8px 6px 8px;
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 4px;
            box-sizing: border-box;
        }

        .ssg-hud-palette-chip {
            background: rgba(22, 27, 34, 0.85);
            border: 1px solid rgba(0, 229, 255, 0.25);
            border-radius: 3px;
            color: #d1d5db;
            font-family: 'Courier New', monospace;
            font-size: 9px;
            font-weight: bold;
            padding: 4px 2px;
            text-align: center;
            cursor: pointer;
            user-select: none;
            transition: all 0.15s ease;
        }

        .ssg-hud-palette-chip:hover {
            background: rgba(0, 229, 255, 0.2);
            border-color: ${HUD_COLOR_CYAN};
            color: ${HUD_COLOR_CYAN};
            box-shadow: 0 0 5px rgba(0, 229, 255, 0.3);
        }

        .ssg-hud-palette-chip:active {
            transform: scale(0.96);
        }

        .ssg-hud-toggle-btn {
            position: fixed;
            top: 25px;
            right: 40px;
            background: rgba(15, 18, 22, 0.9);
            border: 1px solid rgba(0, 229, 255, 0.35);
            color: ${HUD_COLOR_CYAN};
            padding: 4px 8px;
            border-radius: 4px;
            font-family: 'Courier New', monospace;
            font-size: 11px;
            font-weight: bold;
            cursor: pointer;
            z-index: 999;
            box-shadow: 0 4px 12px rgba(0,0,0,0.5);
            transition: all 0.2s ease;
        }

        .ssg-hud-toggle-btn:hover {
            background: rgba(0, 229, 255, 0.2);
            border-color: ${HUD_COLOR_CYAN};
        }

        .ssg-hud-context-menu {
            position: fixed;
            background: rgba(15, 18, 22, 0.98);
            border: 1px solid rgba(0, 229, 255, 0.35);
            border-radius: 5px;
            box-shadow: 0 8px 24px rgba(0,0,0,0.8);
            padding: 4px 0;
            z-index: 2000;
            font-family: 'Courier New', monospace;
            font-size: 11px;
            color: #d1d5db;
            min-width: 180px;
        }

        .ssg-hud-context-item {
            padding: 6px 12px;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 8px;
            transition: background 0.15s ease;
            position: relative;
        }

        .ssg-hud-context-item:hover {
            background: rgba(0, 229, 255, 0.15);
            color: ${HUD_COLOR_CYAN};
        }

        .ssg-hud-context-separator {
            height: 1px;
            background: rgba(255, 255, 255, 0.08);
            margin: 4px 0;
        }

        .ssg-hud-submenu {
            position: absolute;
            left: 100%;
            top: 0;
            background: rgba(15, 18, 22, 0.98);
            border: 1px solid rgba(0, 229, 255, 0.35);
            border-radius: 5px;
            box-shadow: 0 8px 24px rgba(0,0,0,0.8);
            padding: 4px 0;
            display: none;
            min-width: 140px;
            z-index: 2001;
        }

        .ssg-hud-context-item:hover > .ssg-hud-submenu {
            display: block;
        }

        .ssg-docs-backdrop {
            position: fixed;
            top: 0;
            left: 0;
            width: 100vw;
            height: 100vh;
            background: rgba(0, 0, 0, 0.75);
            backdrop-filter: blur(5px);
            z-index: 100060;
            display: flex;
            align-items: center;
            justify-content: center;
            user-select: text;
        }

        .ssg-docs-window {
            width: min(1400px, 92vw);
            max-width: 94vw;
            height: min(850px, 88vh);
            max-height: 88vh;
            background: #0d1117;
            border: 1px solid #1e293b;
            border-radius: 6px;
            box-shadow: 0 16px 48px rgba(0,0,0,0.85), 0 0 0 1px rgba(0, 229, 255, 0.25);
            display: flex;
            flex-direction: column;
            overflow: hidden;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, monospace;
        }

        .ssg-docs-header {
            height: 44px;
            background: #161b22;
            border-bottom: 1px solid #1e293b;
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 0 16px;
            flex-shrink: 0;
            user-select: none;
        }

        .ssg-docs-title {
            font-size: 13px;
            font-weight: 700;
            color: #ffffff;
            letter-spacing: 0.05em;
            text-transform: uppercase;
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .ssg-docs-close-btn {
            background: transparent;
            border: none;
            color: #94a3b8;
            cursor: pointer;
            font-size: 18px;
            line-height: 1;
            padding: 4px;
            transition: color 0.15s ease;
        }

        .ssg-docs-close-btn:hover {
            color: #ffffff;
        }

        .ssg-docs-body {
            display: flex;
            flex: 1;
            overflow: hidden;
        }

        .ssg-docs-sidebar {
            width: 175px;
            background: #12161f;
            border-right: 1px solid #1e293b;
            overflow-y: auto;
            padding: 10px 8px;
            display: flex;
            flex-direction: column;
            gap: 4px;
            flex-shrink: 0;
            box-sizing: border-box;
        }

        .ssg-docs-sec-header {
            font-size: 10px;
            font-weight: bold;
            color: #64748b;
            text-transform: uppercase;
            letter-spacing: 0.8px;
            padding: 6px 8px 2px 8px;
        }

        .ssg-docs-tab-btn {
            background: transparent;
            border: 1px solid transparent;
            color: #94a3b8;
            font-size: 11px;
            font-family: monospace;
            padding: 6px 10px;
            border-radius: 4px;
            cursor: pointer;
            text-align: left;
            transition: all 0.15s ease;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .ssg-docs-tab-btn:hover {
            background: #161b22;
            color: #ffffff;
        }

        .ssg-docs-tab-btn.active {
            background: rgba(0, 229, 255, 0.12);
            color: ${HUD_COLOR_CYAN};
            border-color: rgba(0, 229, 255, 0.35);
            font-weight: bold;
        }

        .ssg-docs-content {
            flex: 1;
            overflow-y: auto;
            padding: 16px 20px;
            color: #d1d5db;
            font-size: 12px;
            line-height: 1.6;
        }

        .ssg-docs-card {
            background: #161b22;
            border: 1px solid #242c37;
            border-radius: 5px;
            padding: 16px;
            margin-bottom: 16px;
        }

        .ssg-docs-sub-bar {
            display: flex;
            gap: 8px;
            margin-bottom: 14px;
            border-bottom: 1px solid #242c37;
            padding-bottom: 8px;
        }

        .ssg-docs-sub-btn {
            background: transparent;
            border: 1px solid #242c37;
            color: #94a3b8;
            font-size: 10px;
            font-family: monospace;
            padding: 4px 8px;
            border-radius: 3px;
            cursor: pointer;
            transition: all 0.15s ease;
        }

        .ssg-docs-sub-btn:hover {
            color: #ffffff;
            border-color: #475569;
        }

        .ssg-docs-sub-btn.active {
            background: rgba(0, 229, 255, 0.15);
            color: ${HUD_COLOR_CYAN};
            border-color: ${HUD_COLOR_CYAN};
        }

        .ssg-docs-h1 { font-size: 16px; font-weight: bold; color: #ffffff; margin-bottom: 12px; border-bottom: 1px solid #242c37; padding-bottom: 6px; }
        .ssg-docs-h2 { font-size: 14px; font-weight: bold; color: ${HUD_COLOR_CYAN}; margin: 16px 0 8px 0; }
        .ssg-docs-h3 { font-size: 12px; font-weight: bold; color: #38bdf8; margin: 12px 0 6px 0; }
        .ssg-docs-h4 { font-size: 11px; font-weight: bold; color: #94a3b8; margin: 8px 0 4px 0; }

        .ssg-docs-code {
            background: #0d1117;
            border: 1px solid #242c37;
            padding: 1px 5px;
            border-radius: 3px;
            font-family: monospace;
            font-size: 11px;
            color: ${HUD_COLOR_CYAN};
        }

        .ssg-docs-pre {
            background: #0d1117;
            border: 1px solid #242c37;
            padding: 10px;
            border-radius: 4px;
            font-family: monospace;
            font-size: 11px;
            color: #e2e8f0;
            overflow-x: auto;
        }

        .ssg-docs-quote {
            border-left: 3px solid ${HUD_COLOR_CYAN};
            margin: 8px 0;
            padding-left: 10px;
            color: #94a3b8;
            font-style: italic;
        }

        .ssg-docs-table-wrap { overflow-x: auto; margin: 10px 0; }
        .ssg-docs-table { width: 100%; border-collapse: collapse; font-size: 11px; }
        .ssg-docs-table th { background: #12161f; color: ${HUD_COLOR_CYAN}; border: 1px solid #242c37; padding: 6px 8px; text-align: left; }
        .ssg-docs-table td { border: 1px solid #242c37; padding: 6px 8px; }

        .ssg-docs-list { margin: 8px 0 8px 18px; padding: 0; }
        .ssg-docs-list li { margin-bottom: 4px; }
        .ssg-docs-num-list { margin: 8px 0 8px 18px; padding: 0; }
        .ssg-docs-num-list li { margin-bottom: 4px; }

        .ssg-docs-link { color: ${HUD_COLOR_CYAN}; text-decoration: none; }
        .ssg-docs-link:hover { text-decoration: underline; }
        .ssg-docs-hr { border: none; border-top: 1px solid #242c37; margin: 14px 0; }

        .ssg-deck-grid {
            display: flex;
            flex-direction: column;
            gap: 16px;
            margin-top: 12px;
        }
        .ssg-deck-card {
            background: #11151c;
            border: 1px solid #242c37;
            border-radius: 5px;
            padding: 12px 14px;
        }
        .ssg-deck-cat-title {
            font-size: 13px;
            font-weight: bold;
            color: ${HUD_COLOR_CYAN};
            border-bottom: 1px solid rgba(0, 229, 255, 0.25);
            padding-bottom: 6px;
            margin-bottom: 10px;
            font-family: 'Courier New', monospace;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        .ssg-deck-sub-group {
            margin-bottom: 10px;
            padding-left: 6px;
        }
        .ssg-deck-sub-group:last-child {
            margin-bottom: 0;
        }
        .ssg-deck-sub-title {
            font-size: 11px;
            font-weight: bold;
            color: #38bdf8;
            margin-bottom: 6px;
            font-family: monospace;
            display: flex;
            align-items: center;
            gap: 6px;
        }
        .ssg-deck-sub-title::before {
            content: "•";
            color: ${HUD_COLOR_CYAN};
        }
        .ssg-deck-tags-cloud {
            display: flex;
            flex-wrap: wrap;
            gap: 5px;
            padding-left: 12px;
        }
        .ssg-deck-tag {
            background: rgba(22, 27, 34, 0.9);
            border: 1px solid rgba(0, 229, 255, 0.25);
            color: #d1d5db;
            font-family: monospace;
            font-size: 10px;
            padding: 2px 7px;
            border-radius: 3px;
            transition: all 0.15s ease;
            cursor: default;
        }
        .ssg-deck-tag:hover {
            border-color: ${HUD_COLOR_CYAN};
            color: #ffffff;
            background: rgba(0, 229, 255, 0.15);
        }
    `;
    document.head.appendChild(style);
}

function makeDraggable(element, handle) {
    let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
    handle.onmousedown = dragMouseDown;

    function dragMouseDown(e) {
        if (e.target.tagName === "INPUT" || e.target.tagName === "BUTTON") return;
        e.preventDefault();
        pos3 = e.clientX;
        pos4 = e.clientY;
        document.onmouseup = closeDragElement;
        document.onmousemove = elementDrag;
    }

    function elementDrag(e) {
        e.preventDefault();
        pos1 = pos3 - e.clientX;
        pos2 = pos4 - e.clientY;
        pos3 = e.clientX;
        pos4 = e.clientY;
        element.style.top = (element.offsetTop - pos2) + "px";
        element.style.left = (element.offsetLeft - pos1) + "px";
        element.style.right = "auto";
    }

    function closeDragElement() {
        document.onmouseup = null;
        document.onmousemove = null;
    }
}

function closeContextMenu() {
    if (hudContextMenu) {
        hudContextMenu.remove();
        hudContextMenu = null;
    }
}

function promptForNodeRename(itemData, app) {
    if (!itemData.node) return;

    const node = itemData.node;
    const currentName = node.title || "";
    const promptMsg = `Rename Node (Max 16 chars):`;

    const input = prompt(promptMsg, currentName);
    if (input === null) return;

    const trimmed = input.trim().substring(0, 16);
    if (!node.properties) node.properties = {};

    if (trimmed) {
        node.properties.hud_custom_title = trimmed;
        node.title = trimmed;
    } else {
        delete node.properties.hud_custom_title;
        const defaultClass = node.comfyClass || node.type || "SSG Node";
        node.title = defaultClass;
    }

    if (app.graph) {
        app.graph.setDirtyCanvas(true, true);
    }
    renderHUDContent(app);
}

function promptForTagText(tagNode, app) {
    if (!tagNode) return;

    const tagWidget = tagNode.widgets?.find(w => w.name === "tag_name" || w.name === "tag");
    const currentText = tagWidget ? tagWidget.value : (tagNode.properties?.tag_name || tagNode.title || "");

    const input = prompt("Edit Tag Name (Max 16 chars):", currentText);
    if (input === null) return;

    const clean = input.trim().substring(0, 16);
    if (tagWidget) {
        tagWidget.value = clean;
        if (typeof tagWidget.callback === "function") tagWidget.callback(clean);
    }
    if (!tagNode.properties) tagNode.properties = {};
    tagNode.properties.tag_name = clean;

    if (tagNode.outputs?.[0]) {
        tagNode.outputs[0].name = clean || "◦";
    }

    if (app.graph) app.graph.setDirtyCanvas(true, true);
    renderHUDContent(app);
}

function showContextMenu(e, itemData, app) {
    e.preventDefault();
    e.stopPropagation();
    closeContextMenu();

    const menu = document.createElement("div");
    menu.className = "ssg-hud-context-menu";
    menu.style.left = `${e.clientX}px`;
    menu.style.top = `${e.clientY}px`;

    if (itemData.isTag) {
        const focusItem = document.createElement("div");
        focusItem.className = "ssg-hud-context-item";
        const tagLabel = formatNodeLabel("Focus Tag", itemData.node);
        focusItem.innerHTML = `<span><span>🎯</span> ${tagLabel}</span>`;
        focusItem.onclick = () => {
            closeContextMenu();
            focusAndCenterOnNode(app, itemData.node);
        };
        menu.appendChild(focusItem);

        const sep = document.createElement("div");
        sep.className = "ssg-hud-context-separator";
        menu.appendChild(sep);

        const editItem = document.createElement("div");
        editItem.className = "ssg-hud-context-item";
        editItem.innerHTML = `<span><span>✏️</span> Edit Tag Name</span>`;
        editItem.onclick = () => {
            closeContextMenu();
            promptForTagText(itemData.node, app);
        };
        menu.appendChild(editItem);

        const typeWidget = itemData.node?.widgets?.find(w => w.name === "type_override");
        if (typeWidget && typeWidget.options?.values) {
            const typeSubItem = document.createElement("div");
            typeSubItem.className = "ssg-hud-context-item";
            typeSubItem.innerHTML = `<span><span>🏷️</span> Datatype</span><span>▶</span>`;

            const subMenu = document.createElement("div");
            subMenu.className = "ssg-hud-submenu";

            typeWidget.options.values.forEach(val => {
                const subOpt = document.createElement("div");
                subOpt.className = "ssg-hud-context-item";
                const isSelected = typeWidget.value === val;
                subOpt.innerHTML = `<span>${isSelected ? "● " : "○ "}${val}</span>`;
                subOpt.onclick = (ev) => {
                    ev.stopPropagation();
                    closeContextMenu();
                    typeWidget.value = val;
                    if (typeof typeWidget.callback === "function") typeWidget.callback(val);
                    if (itemData.node.updateTagSlotState) itemData.node.updateTagSlotState();
                    if (app.graph) app.graph.setDirtyCanvas(true, true);
                    renderHUDContent(app);
                };
                subMenu.appendChild(subOpt);
            });

            typeSubItem.appendChild(subMenu);
            menu.appendChild(typeSubItem);
        }

        document.body.appendChild(menu);
        hudContextMenu = menu;

        const onOutsideClick = (ev) => {
            if (!menu.contains(ev.target)) {
                closeContextMenu();
                document.removeEventListener("pointerdown", onOutsideClick);
            }
        };
        setTimeout(() => document.addEventListener("pointerdown", onOutsideClick), 10);
        return;
    }

    if (itemData.node && !itemData.isSocket) {
        const renameItem = document.createElement("div");
        renameItem.className = "ssg-hud-context-item";
        renameItem.innerHTML = `<span><span>✏️</span> Rename Node</span>`;
        renameItem.onclick = () => {
            closeContextMenu();
            promptForNodeRename(itemData, app);
        };
        menu.appendChild(renameItem);
    }

    if (itemData.node && (typeof itemData.onToggleSchema === "function" || itemData.node.widgets?.some(w => w.name === "[ Lock Schema ]" || w.name === "[ Edit Schema ]"))) {
        const lockBtn = itemData.node.widgets?.find(w => w.name === "[ Lock Schema ]" || w.name === "[ Edit Schema ]");
        const isEdit = itemData.node._isEditMode === true || itemData.isEditing === true;
        const schemaItem = document.createElement("div");
        schemaItem.className = "ssg-hud-context-item";
        schemaItem.innerHTML = `<span><span>${isEdit ? "🔒" : "🔓"}</span> ${isEdit ? "Lock Schema" : "Edit Schema"}</span>`;
        schemaItem.onclick = () => {
            closeContextMenu();
            if (typeof itemData.onToggleSchema === "function") {
                itemData.onToggleSchema();
            } else if (lockBtn && typeof lockBtn.callback === "function") {
                lockBtn.callback();
            }
            renderHUDContent(app);
        };
        menu.appendChild(schemaItem);
    }

    if (itemData.canSpawnRx && typeof itemData.onSpawnRx === "function") {
        const spawnRxItem = document.createElement("div");
        spawnRxItem.className = "ssg-hud-context-item";
        spawnRxItem.innerHTML = `<span><span>⚡</span> Spawn Receiver (RX)</span>`;
        spawnRxItem.onclick = (ev) => {
            closeContextMenu();
            itemData.onSpawnRx(ev);
        };
        menu.appendChild(spawnRxItem);
    } else if (itemData.isSocket && itemData.moduleId && typeof itemData.onSpawnModule === "function" && itemData.canSpawnModule) {
        const spawnModItem = document.createElement("div");
        spawnModItem.className = "ssg-hud-context-item";
        spawnModItem.innerHTML = `<span><span>⚡</span> Spawn Companion Module</span>`;
        spawnModItem.onclick = (ev) => {
            closeContextMenu();
            itemData.onSpawnModule(ev);
        };
        menu.appendChild(spawnModItem);
    }

    if (itemData.isSocket && itemData.isTransceiver && itemData.isModuleSpawned && typeof itemData.onCycleBus === "function") {
        const busItem = document.createElement("div");
        busItem.className = "ssg-hud-context-item";
        const shadowTag = itemData.busRole === "SHADOW" ? " (Shadow)" : "";
        busItem.innerHTML = `<span><span>🛣️</span> Cycle Bus Lane (B${itemData.busLane}${shadowTag})</span>`;
        busItem.onclick = () => {
            closeContextMenu();
            itemData.onCycleBus();
            renderHUDContent(app);
        };
        menu.appendChild(busItem);
    }

    const sep = document.createElement("div");
    sep.className = "ssg-hud-context-separator";
    menu.appendChild(sep);

    const focusMasterItem = document.createElement("div");
    focusMasterItem.className = "ssg-hud-context-item";
    const masterLabel = formatNodeLabel(itemData.masterFocusLabel || "Focus Transmitter", itemData.node);
    focusMasterItem.innerHTML = `<span><span>🎯</span> ${masterLabel}</span>`;
    focusMasterItem.onclick = () => {
        closeContextMenu();
        if (itemData.node) {
            focusAndCenterOnNode(app, itemData.node);
        }
    };
    menu.appendChild(focusMasterItem);

    if (itemData.extraFocus && Array.isArray(itemData.extraFocus)) {
        itemData.extraFocus.forEach(extra => {
            if (extra.node) {
                const subFocusItem = document.createElement("div");
                subFocusItem.className = "ssg-hud-context-item";
                const satLabel = formatNodeLabel(extra.label, extra.node);
                subFocusItem.innerHTML = `<span><span>🎯</span> ${satLabel}</span>`;
                subFocusItem.onclick = () => {
                    closeContextMenu();
                    focusAndCenterOnNode(app, extra.node);
                };
                menu.appendChild(subFocusItem);
            }
        });
    }

    document.body.appendChild(menu);
    hudContextMenu = menu;

    const onOutsideClick = (ev) => {
        if (!menu.contains(ev.target)) {
            closeContextMenu();
            document.removeEventListener("pointerdown", onOutsideClick);
        }
    };
    setTimeout(() => document.addEventListener("pointerdown", onOutsideClick), 10);
}

const TITLE_BAR_OFFSET_Y = 15;

function getActiveCanvasGraph(app) {
    return app?.canvas?.subgraph || app?.canvas?.graph || app?.graph;
}

function attachNodeToCursor(app, node, onDropCallback = null) {
    if (!app?.canvas || !node) return;

    const canvas = app.canvas;
    const activeGraph = getActiveCanvasGraph(app);

    canvas.selectNode(node);
    if (activeGraph) activeGraph.setDirtyCanvas(true, true);

    const originalMouse = node.onMouseDown;
    node._ssgDragging = true;

    function onPointerMove(ev) {
        const ds = canvas.ds;
        const canvasRect = canvas.canvas.getBoundingClientRect();
        const graphX = (ev.clientX - canvasRect.left) / ds.scale - ds.offset[0];
        const graphY = (ev.clientY - canvasRect.top) / ds.scale - ds.offset[1];

        node.pos = [graphX - (node.size[0] / 2), graphY + TITLE_BAR_OFFSET_Y];
        if (activeGraph) activeGraph.setDirtyCanvas(true, false);
    }

    function onPointerDown(ev) {
        if (hudContainer && hudContainer.contains(ev.target)) return;
        if (activeDocsModal && activeDocsModal.contains(ev.target)) return;

        ev.preventDefault();
        ev.stopPropagation();
        ev.stopImmediatePropagation();

        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerdown", onPointerDown, true);

        delete node._ssgDragging;
        if (originalMouse) node.onMouseDown = originalMouse;

        if (typeof onDropCallback === "function") {
            onDropCallback(node);
        }

        canvas.selectNode(node);
        if (activeGraph) activeGraph.setDirtyCanvas(true, true);
    }

    window.addEventListener("pointermove", onPointerMove);
    setTimeout(() => {
        window.addEventListener("pointerdown", onPointerDown, true);
    }, 60);
}

function spawnPaletteNode(nodeType, app, e) {
    const activeGraph = getActiveCanvasGraph(app);
    if (!activeGraph || typeof LiteGraph === "undefined") return;

    const node = LiteGraph.createNode(nodeType);
    if (!node) return;

    activeGraph.add(node);

    const ds = app.canvas.ds;
    const canvasRect = app.canvas.canvas.getBoundingClientRect();
    const graphX = (e.clientX - canvasRect.left) / ds.scale - ds.offset[0];
    const graphY = (e.clientY - canvasRect.top) / ds.scale - ds.offset[1];
    node.pos = [graphX - (node.size[0] / 2), graphY + TITLE_BAR_OFFSET_Y];

    attachNodeToCursor(app, node);
}

function spawnBoundSatellite(channelId, app, e) {
    const activeGraph = getActiveCanvasGraph(app);
    if (!activeGraph || typeof LiteGraph === "undefined") return;

    const satNode = LiteGraph.createNode("SSGSmartSatellite");
    if (!satNode) return;

    activeGraph.add(satNode);

    const record = getChannelRecord(channelId);
    const gen = record?.generation || 1;

    satNode.properties = satNode.properties || {};
    satNode.properties.bound_channel = channelId;
    satNode.properties.bound_generation = gen;
    satNode._ssgBoundChannel = channelId;
    satNode._ssgBoundGeneration = gen;

    const chW = satNode.widgets?.find(w => w.name === "channel");
    if (chW) {
        if (!chW.options) chW.options = {};
        if (!chW.options.values) chW.options.values = [];
        if (!chW.options.values.includes(channelId)) chW.options.values.push(channelId);
        chW.value = channelId;
    }

    const boundGenW = satNode.widgets?.find(w => w.name === "bound_generation");
    if (boundGenW) {
        boundGenW.value = gen;
    }

    if (record && record.tracks && record.tracks.length > 0) {
        while (satNode.outputs && satNode.outputs.length > 0) {
            satNode.removeOutput(0);
        }
        satNode.outputs = [];

        record.tracks.forEach((track, idx) => {
            const cleanName = sanitizeAndTruncateText(track.name, 16);
            const cleanType = track.type || "*";
            satNode.addOutput(cleanName, cleanType);
            const newSlot = satNode.outputs[idx];
            if (newSlot) {
                newSlot._trackIdx = track.index !== undefined ? track.index : idx;
            }
        });

        satNode.properties.satellite_manifest = record.tracks.map(track => ({
            index: track.index,
            name: track.name,
            type: track.type
        }));

        satNode._ssgTrackMismatch = false;
        satNode._isSpawned = true;
        satNode.properties.is_pruned = false;
        satNode.properties.setup_completed = false;

        const actionBtn = satNode.widgets?.find(w => w.name === "[ Prune Unused ]" || w.name === "[ Spawn Tracks ]");
        if (actionBtn) {
            actionBtn.name = "[ Prune Unused ]";
            actionBtn.label = "[ Prune Unused ]";
            actionBtn.triggerDraw?.();
        }

        const bannerW = satNode.widgets?.find(w => w.name === "channel_display");
        if (bannerW) bannerW.triggerDraw?.();

        const targetHeight = Math.max(80, (satNode.outputs.length * 20) + 95);
        updateNodeBounds(satNode, SSG_DEFAULT_WIDTH, targetHeight);
    }

    const ds = app.canvas.ds;
    const canvasRect = app.canvas.canvas.getBoundingClientRect();
    const graphX = (e.clientX - canvasRect.left) / ds.scale - ds.offset[0];
    const graphY = (e.clientY - canvasRect.top) / ds.scale - ds.offset[1];
    satNode.pos = [graphX - (satNode.size[0] / 2), graphY + TITLE_BAR_OFFSET_Y];

    attachNodeToCursor(app, satNode);
}

function spawnBoundGatePair(channelId, app, e) {
    const activeGraph = getActiveCanvasGraph(app);
    if (!activeGraph || typeof LiteGraph === "undefined") return;

    const cleanBase = channelId.replace(/_(TX|RX)$/, "");
    const relayChan = `${cleanBase}_TX`;
    const returnChan = `${cleanBase}_RX`;

    const relayNode = LiteGraph.createNode("SSGSmartGateRelay");
    const returnNode = LiteGraph.createNode("SSGSmartGateReturn");
    if (!relayNode || !returnNode) return;

    activeGraph.add(relayNode);
    activeGraph.add(returnNode);

    const txRecord = getChannelRecord(relayChan);
    const tracks = txRecord?.tracks || [];
    const gen = txRecord?.generation || 1;

    relayNode.properties = relayNode.properties || {};
    relayNode.properties.channel_id = relayChan;
    relayNode.properties.bound_channel = relayChan;
    relayNode.properties.bound_generation = gen;
    relayNode.properties.relay_manifest = JSON.stringify(tracks);
    relayNode._ssgBoundGeneration = gen;
    relayNode._ssgBoundChannel = relayChan;

    const relayChW = relayNode.widgets?.find(w => w.name === "channel");
    if (relayChW) {
        if (!relayChW.options) relayChW.options = {};
        if (!relayChW.options.values) relayChW.options.values = [];
        if (!relayChW.options.values.includes(relayChan)) relayChW.options.values.push(relayChan);
        relayChW.value = relayChan;
    }

    while (relayNode.outputs && relayNode.outputs.length > 0) relayNode.removeOutput(0);
    tracks.forEach((track, idx) => {
        relayNode.addOutput(track.name || `SSG_${idx}`, track.type || "*");
    });
    const targetRelayHeight = Math.max(80, (tracks.length * 20) + 95);
    updateNodeBounds(relayNode, SSG_DEFAULT_WIDTH, targetRelayHeight);

    returnNode.properties = returnNode.properties || {};
    returnNode.properties.channel_id = returnChan;
    returnNode.properties.bound_channel = returnChan;
    returnNode.properties.bound_generation = gen;
    returnNode.properties.return_manifest = JSON.stringify(tracks);
    returnNode._ssgBoundGeneration = gen;
    returnNode._ssgBoundChannel = returnChan;

    const returnChW = returnNode.widgets?.find(w => w.name === "channel");
    if (returnChW) {
        if (!returnChW.options) returnChW.options = {};
        if (!returnChW.options.values) returnChW.options.values = [];
        if (!returnChW.options.values.includes(returnChan)) returnChW.options.values.push(returnChan);
        returnChW.value = returnChan;
    }

    while (returnNode.inputs && returnNode.inputs.length > 0) returnNode.removeInput(0);
    tracks.forEach((track, idx) => {
        returnNode.addInput(track.name || `SSG_${idx}`, track.type || "*");
    });
    const targetReturnHeight = Math.max(80, (tracks.length * 20) + 95);
    updateNodeBounds(returnNode, SSG_DEFAULT_WIDTH, targetReturnHeight);

    if (tracks.length > 0) {
        registerChannel(returnChan, tracks, gen, false);
    }

    const ds = app.canvas.ds;
    const canvasRect = app.canvas.canvas.getBoundingClientRect();
    const graphX = (e.clientX - canvasRect.left) / ds.scale - ds.offset[0];
    const graphY = (e.clientY - canvasRect.top) / ds.scale - ds.offset[1];
    relayNode.pos = [graphX - (relayNode.size[0] / 2), graphY + TITLE_BAR_OFFSET_Y];
    returnNode.pos = [relayNode.pos[0] + relayNode.size[0] + 40, relayNode.pos[1]];

    attachNodeToCursor(app, relayNode, (droppedRelay) => {
        returnNode.pos = [droppedRelay.pos[0] + droppedRelay.size[0] + 40, droppedRelay.pos[1]];
        activeGraph.setDirtyCanvas(true, true);
    });
}

function resolveModuleNodeType(modId, schema) {
    if (schema?.node_type && LiteGraph.registered_node_types[schema.node_type]) {
        return schema.node_type;
    }
    if (schema?.class_type && LiteGraph.registered_node_types[schema.class_type]) {
        return schema.class_type;
    }

    const cleanId = modId.replace(/^ssg_module_/, "");
    const pascal = cleanId.split("_").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join("");
    const directCandidate = `SSG${pascal}`;

    if (LiteGraph.registered_node_types[directCandidate]) {
        return directCandidate;
    }

    const registeredKeys = Object.keys(LiteGraph.registered_node_types || {});
    for (const k of registeredKeys) {
        const lowerK = k.toLowerCase();
        if (lowerK === directCandidate.toLowerCase() || (schema?.display_name && lowerK.includes(schema.display_name.toLowerCase().replace(/\s+/g, "")))) {
            return k;
        }
    }

    return null;
}

function spawnBoundModule(socketChanId, modId, app, e) {
    const activeGraph = getActiveCanvasGraph(app);
    if (!activeGraph || typeof LiteGraph === "undefined" || !modId) return;

    const schema = window.SSG_ModuleRegistry ? window.SSG_ModuleRegistry[modId] : null;
    const nodeType = resolveModuleNodeType(modId, schema);

    if (!nodeType) {
        console.warn(`[SSG HUD] Could not resolve LiteGraph node type for module '${modId}'.`);
        return;
    }

    const modNode = LiteGraph.createNode(nodeType);
    if (!modNode) return;

    activeGraph.add(modNode);

    modNode.properties = modNode.properties || {};
    modNode.properties.target_socket = socketChanId;

    const sockW = modNode.widgets?.find(w => w.name === "target_socket");
    if (sockW) {
        if (!sockW.options) sockW.options = {};
        if (!sockW.options.values) sockW.options.values = [];
        if (!sockW.options.values.includes(socketChanId)) sockW.options.values.push(socketChanId);
        sockW.value = socketChanId;
        if (typeof sockW.callback === "function") sockW.callback(socketChanId);
    }

    const ds = app.canvas.ds;
    const canvasRect = app.canvas.canvas.getBoundingClientRect();
    const graphX = (e.clientX - canvasRect.left) / ds.scale - ds.offset[0];
    const graphY = (e.clientY - canvasRect.top) / ds.scale - ds.offset[1];
    modNode.pos = [graphX - (modNode.size[0] / 2), graphY + TITLE_BAR_OFFSET_Y];

    attachNodeToCursor(app, modNode);
}

function renderSimpleMarkdown(mdText, extensionFolder = "ComfyUI-SSG-Smart-Suite") {
    if (!mdText) return "<p>No documentation found.</p>";

    let text = mdText.replace(/\r\n/g, "\n");

    text = text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");

    text = text.replace(/\\rightarrow/g, "→").replace(/\$\\rightarrow\$/g, "→");

    text = text.replace(/```([a-z]*)\n([\s\S]*?)```/g, '<pre class="ssg-docs-pre"><code>$2</code></pre>');
    text = text.replace(/`([^`]+)`/g, '<span class="ssg-docs-code">$1</span>');

    text = text.replace(/\[!\[(.*?)\]\((.*?)\)\]\((.*?)\)/g, (match, alt, imgSrc, targetUrl) => {
        let cleanImgSrc = imgSrc.trim();
        if (!cleanImgSrc.startsWith("http://") && !cleanImgSrc.startsWith("https://") && !cleanImgSrc.startsWith("data:")) {
            cleanImgSrc = cleanImgSrc.replace(/^\.?\//, "");
            cleanImgSrc = `/extensions/${extensionFolder}/${cleanImgSrc}`;
        }
        return `<a href="${targetUrl.trim()}" target="_blank" rel="noopener noreferrer"><img src="${cleanImgSrc}" alt="${alt}" class="ssg-docs-img-badge" /></a>`;
    });

    text = text.replace(/!\[(.*?)\]\((.*?)\)/g, (match, alt, src) => {
        let cleanSrc = src.trim();
        if (!cleanSrc.startsWith("http://") && !cleanSrc.startsWith("data:")) {
            cleanSrc = cleanSrc.replace(/^\.?\//, "");
            cleanSrc = `/extensions/${extensionFolder}/${cleanSrc}`;
        }
        return `<img src="${cleanSrc}" alt="${alt}" class="ssg-docs-img" />`;
    });

    text = text.replace(/\[(.*?)\]\((.*?)\)/g, (match, label, url) => {
        return `<a href="${url.trim()}" target="_blank" rel="noopener noreferrer" class="ssg-docs-link">${label}</a>`;
    });

    text = text.replace(/((?:^(?:&gt;|>)[ \t]?[^\n]*(?:\n|$))+)/gm, (bqMatch) => {
        const lines = bqMatch.trim().split("\n").map(l => l.replace(/^(?:&gt;|>)[ \t]?/, "").trim()).filter(Boolean);
        return `<blockquote class="ssg-docs-quote">${lines.map(l => `<p>${l}</p>`).join("")}</blockquote>\n`;
    });

    text = text.replace(/^(?:---|\*\*\*|___)[ \t]*$/gm, '<hr class="ssg-docs-hr" />');

    text = text.replace(/((?:^|\n)\|[^\n]+\|\n\|[-:| ]+\|\n(?:\|[^\n]+\|\n?)+)/g, (tableMatch) => {
        const lines = tableMatch.trim().split("\n").map(l => l.trim()).filter(Boolean);
        if (lines.length < 2) return tableMatch;

        const parseCells = (row) => row.replace(/^\||\|$/g, "").split("|").map(c => c.trim());
        const headerCells = parseCells(lines[0]);

        let ths = headerCells.map(c => `<th>${c}</th>`).join("");
        let trs = "";

        for (let i = 2; i < lines.length; i++) {
            const rowCells = parseCells(lines[i]);
            const tds = rowCells.map(c => `<td>${c}</td>`).join("");
            trs += `<tr>${tds}</tr>`;
        }

        return `<div class="ssg-docs-table-wrap"><table class="ssg-docs-table"><thead><tr>${ths}</tr></thead><tbody>${trs}</tbody></table></div>`;
    });

    text = text.replace(/^#### (.*$)/gim, '<div class="ssg-docs-h4">$1</div>');
    text = text.replace(/^### (.*$)/gim, '<div class="ssg-docs-h3">$1</div>');
    text = text.replace(/^## (.*$)/gim, '<div class="ssg-docs-h2">$1</div>');
    text = text.replace(/^# (.*$)/gim, '<div class="ssg-docs-h1">$1</div>');

    text = text.replace(/\*\*\*(.*?)\*\*\*/g, '<strong><em>$1</em></strong>');
    text = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/\*(.*?)\*/g, '<em>$1</em>');

    text = text.replace(/((?:^[ \t]*[-*][ \t]+.*(?:\n|$))+)/gm, (listBlock) => {
        const items = listBlock.trim().split(/\n/).map(item => {
            return `<li>${item.replace(/^[ \t]*[-*][ \t]+/, "")}</li>`;
        }).join("");
        return `<ul class="ssg-docs-list">${items}</ul>`;
    });

    text = text.replace(/((?:^[ \t]*\d+\.[ \t]+.*(?:\n|$))+)/gm, (listBlock) => {
        const items = listBlock.trim().split(/\n/).map(item => {
            return `<li>${item.replace(/^[ \t]*\d+\.[ \t]+/, "")}</li>`;
        }).join("");
        return `<ol class="ssg-docs-num-list">${items}</ol>`;
    });

    const blocks = text.split(/\n{2,}/);
    text = blocks.map(block => {
        const trimmed = block.trim();
        if (!trimmed) return "";
        if (
            trimmed.startsWith("<div") ||
            trimmed.startsWith("<blockquote") ||
            trimmed.startsWith("<pre") ||
            trimmed.startsWith("<ul") ||
            trimmed.startsWith("<ol") ||
            trimmed.startsWith("<hr") ||
            trimmed.startsWith("<table")
        ) {
            return trimmed;
        }
        return `<p>${trimmed.replace(/\n/g, "<br/>")}</p>`;
    }).join("\n");

    return text;
}

function renderJsonDeckCard(deckData, deckTitle) {
    const card = document.createElement("div");
    card.className = "ssg-docs-card";

    const title = document.createElement("div");
    title.className = "ssg-docs-h1";
    title.textContent = `Library Deck: ${deckTitle}`;
    card.appendChild(title);

    const desc = document.createElement("p");
    desc.style.color = "#94a3b8";
    desc.style.marginBottom = "14px";
    desc.textContent = "Interactive Taxonomy & Wildcard Dictionary. Token hierarchies below are resolved dynamically by prompt appliances.";
    card.appendChild(desc);

    const grid = document.createElement("div");
    grid.className = "ssg-deck-grid";

    function formatTitle(raw) {
        return String(raw).replace(/_/g, " ").trim();
    }

    function resolveChipMetadata(item) {
        if (item === null || item === undefined) return { label: "", tooltip: "" };
        if (typeof item !== "object") return { label: String(item), tooltip: String(item) };

        const label = item.chip_label || item.label || item.name || item.token || item.id || "Tag";
        const tooltip = item.token || item.prompt || item.desc || item.id || label;
        return { label: String(label), tooltip: String(tooltip) };
    }

    function buildRecursiveGroup(parentEl, key, value) {
        if (value === null || value === undefined) return;

        if (Array.isArray(value)) {
            const group = document.createElement("div");
            group.className = "ssg-deck-sub-group";

            if (key) {
                const subTitle = document.createElement("div");
                subTitle.className = "ssg-deck-sub-title";
                subTitle.textContent = formatTitle(key);
                group.appendChild(subTitle);
            }

            const cloud = document.createElement("div");
            cloud.className = "ssg-deck-tags-cloud";

            value.forEach(item => {
                if (typeof item === "object" && item !== null) {
                    const meta = resolveChipMetadata(item);
                    const tagEl = document.createElement("span");
                    tagEl.className = "ssg-deck-tag";
                    tagEl.textContent = meta.label;
                    if (meta.tooltip && meta.tooltip !== meta.label) {
                        tagEl.title = `Prompt: ${meta.tooltip}`;
                    }
                    cloud.appendChild(tagEl);
                } else {
                    const tagEl = document.createElement("span");
                    tagEl.className = "ssg-deck-tag";
                    tagEl.textContent = String(item);
                    cloud.appendChild(tagEl);
                }
            });

            group.appendChild(cloud);
            parentEl.appendChild(group);
        } else if (typeof value === "object") {
            const subGroup = document.createElement("div");
            subGroup.className = "ssg-deck-sub-group";

            if (key) {
                const subTitle = document.createElement("div");
                subTitle.className = "ssg-deck-sub-title";
                subTitle.textContent = formatTitle(key);
                subGroup.appendChild(subTitle);
            }

            for (const [subKey, subVal] of Object.entries(value)) {
                buildRecursiveGroup(subGroup, subKey, subVal);
            }

            parentEl.appendChild(subGroup);
        } else {
            const group = document.createElement("div");
            group.className = "ssg-deck-sub-group";

            const cloud = document.createElement("div");
            cloud.className = "ssg-deck-tags-cloud";

            const tagEl = document.createElement("span");
            tagEl.className = "ssg-deck-tag";
            tagEl.textContent = key ? `${formatTitle(key)}: ${value}` : String(value);

            cloud.appendChild(tagEl);
            group.appendChild(cloud);
            parentEl.appendChild(group);
        }
    }

    for (const [categoryKey, categoryVal] of Object.entries(deckData)) {
        if (categoryKey === "has_r18") continue;

        const catCard = document.createElement("div");
        catCard.className = "ssg-deck-card";

        const catTitle = document.createElement("div");
        catTitle.className = "ssg-deck-cat-title";
        catTitle.textContent = formatTitle(categoryKey);
        catCard.appendChild(catTitle);

        buildRecursiveGroup(catCard, null, categoryVal);
        grid.appendChild(catCard);
    }

    card.appendChild(grid);
    return card;
}

function closeDocsModal() {
    if (activeDocsModal && activeDocsModal.parentNode) {
        activeDocsModal.parentNode.removeChild(activeDocsModal);
    }
    activeDocsModal = null;
}

async function openDocsModal() {
    closeDocsModal();
    createHUDStyles();

    const backdrop = document.createElement("div");
    backdrop.className = "ssg-docs-backdrop";

    backdrop.addEventListener("pointerdown", e => {
        if (e.target === backdrop) closeDocsModal();
        e.stopPropagation();
    });

    const win = document.createElement("div");
    win.className = "ssg-docs-window";
    win.addEventListener("pointerdown", e => e.stopPropagation());

    const header = document.createElement("div");
    header.className = "ssg-docs-header";

    const titleEl = document.createElement("div");
    titleEl.className = "ssg-docs-title";
    const initialVer = cachedSuiteVersion ? `v${cachedSuiteVersion}` : "v4.0";
    titleEl.innerHTML = `<span>SSG Smart Suite Manual & Documentation</span><span class="ssg-docs-code" style="margin-left: 8px;">${initialVer}</span>`;

    const closeBtn = document.createElement("button");
    closeBtn.className = "ssg-docs-close-btn";
    closeBtn.innerHTML = "&times;";
    closeBtn.onclick = closeDocsModal;

    header.appendChild(titleEl);
    header.appendChild(closeBtn);
    win.appendChild(header);

    const body = document.createElement("div");
    body.className = "ssg-docs-body";

    const sidebar = document.createElement("div");
    sidebar.className = "ssg-docs-sidebar";

    const content = document.createElement("div");
    content.className = "ssg-docs-content";

    body.appendChild(sidebar);
    body.appendChild(content);
    win.appendChild(body);
    backdrop.appendChild(win);
    document.body.appendChild(backdrop);
    activeDocsModal = backdrop;

    let suiteDocs = { version: cachedSuiteVersion, readme: null, manual: null, hud_guide: cachedHudGuide };
    try {
        const suiteResp = await fetch("/ssg/suite/docs");
        if (suiteResp.ok) {
            suiteDocs = await suiteResp.json();
            if (suiteDocs.version) {
                cachedSuiteVersion = suiteDocs.version;
                titleEl.innerHTML = `<span>SSG Smart Suite Manual & Documentation</span><span class="ssg-docs-code" style="margin-left: 8px;">v${cachedSuiteVersion}</span>`;
                updateHUDTitleDisplay();
            }
            if (suiteDocs.hud_guide) {
                cachedHudGuide = suiteDocs.hud_guide;
            }
        }
    } catch (e) {
        console.warn("[SSG HUD] /ssg/suite/docs endpoint not available:", e);
    }

    let modulesDocs = { modules_readme: null, modules_manual: null, matrix_doc: null, modules: [], decks: [] };
    try {
        const modResp = await fetch("/ssg/docs");
        if (modResp.ok) {
            modulesDocs = await modResp.json();
        }
    } catch (e) {
        // Smart Modules not installed
    }

    const suiteTabs = [
        {
            id: "hud_guide",
            title: "HUD Command Guide",
            content: cachedHudGuide || suiteDocs.hud_guide || "No HUD documentation found.",
            folder: "ComfyUI-SSG-Smart-Suite"
        },
        {
            id: "suite_docs",
            title: "Smart Suite",
            isDual: true,
            readme: suiteDocs.readme,
            manual: suiteDocs.manual,
            folder: "ComfyUI-SSG-Smart-Suite"
        }
    ];

    if (modulesDocs.modules_readme || modulesDocs.modules_manual) {
        suiteTabs.push({
            id: "modules_docs",
            title: "Smart Modules",
            isDual: true,
            readme: modulesDocs.modules_readme,
            manual: modulesDocs.modules_manual,
            folder: "ComfyUI-SSG-Smart-Modules"
        });
    }

    const moduleApplianceTabs = [];
    if (modulesDocs.modules && Array.isArray(modulesDocs.modules)) {
        modulesDocs.modules.forEach(mod => {
            moduleApplianceTabs.push({
                id: `mod_${mod.id}`,
                title: mod.title || mod.id,
                isModule: true,
                manual: mod.manual,
                folder: "ComfyUI-SSG-Smart-Modules"
            });
        });
    }

    const libraryTabs = [];

    if (modulesDocs.matrix_doc) {
        libraryTabs.push({
            id: "nethub_matrix",
            title: "NetHub Matrix",
            content: modulesDocs.matrix_doc,
            folder: "ComfyUI-SSG-Smart-Modules"
        });
    }

    if (modulesDocs.decks && Array.isArray(modulesDocs.decks)) {
        modulesDocs.decks.forEach(deck => {
            libraryTabs.push({
                id: `deck_${deck.id}`,
                title: deck.title,
                isDeck: true,
                deckData: deck.data,
                folder: "ComfyUI-SSG-Smart-Modules"
            });
        });
    }

    function renderDualDocCard(readmeText, manualText, folder) {
        const card = document.createElement("div");
        card.className = "ssg-docs-card";

        const subBar = document.createElement("div");
        subBar.className = "ssg-docs-sub-bar";

        const readmeBtn = document.createElement("button");
        readmeBtn.className = "ssg-docs-sub-btn active";
        readmeBtn.textContent = "Overview (README)";

        const manualBtn = document.createElement("button");
        manualBtn.className = "ssg-docs-sub-btn";
        manualBtn.textContent = "Full Manual";

        const docViewer = document.createElement("div");
        docViewer.innerHTML = renderSimpleMarkdown(readmeText || "No overview provided.", folder);

        readmeBtn.onclick = () => {
            readmeBtn.classList.add("active");
            manualBtn.classList.remove("active");
            docViewer.innerHTML = renderSimpleMarkdown(readmeText || "No overview provided.", folder);
        };

        manualBtn.onclick = () => {
            manualBtn.classList.add("active");
            readmeBtn.classList.remove("active");
            docViewer.innerHTML = renderSimpleMarkdown(manualText || "No detailed manual provided.", folder);
        };

        subBar.appendChild(readmeBtn);
        subBar.appendChild(manualBtn);
        card.appendChild(subBar);
        card.appendChild(docViewer);
        return card;
    }

    async function loadTabContent(tab) {
        content.scrollTop = 0;
        content.innerHTML = "";

        if (tab.isDeck) {
            content.appendChild(renderJsonDeckCard(tab.deckData, tab.title));
        } else if (tab.content) {
            content.innerHTML = `<div class="ssg-docs-card">${renderSimpleMarkdown(tab.content, tab.folder)}</div>`;
        } else if (tab.isDual) {
            content.appendChild(renderDualDocCard(tab.readme, tab.manual, tab.folder));
        } else if (tab.isModule) {
            const card = document.createElement("div");
            card.className = "ssg-docs-card";
            card.innerHTML = renderSimpleMarkdown(tab.manual || "No manual provided.", tab.folder);
            content.appendChild(card);
        }
    }

    const secPacksHeader = document.createElement("div");
    secPacksHeader.className = "ssg-docs-sec-header";
    secPacksHeader.textContent = "SSG Smart Packs";
    sidebar.appendChild(secPacksHeader);

    const allButtons = [];

    suiteTabs.forEach((tab, index) => {
        const btn = document.createElement("button");
        btn.className = `ssg-docs-tab-btn ${index === 0 ? "active" : ""}`;
        btn.textContent = tab.title;
        btn.onclick = () => {
            allButtons.forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            loadTabContent(tab);
        };
        allButtons.push(btn);
        sidebar.appendChild(btn);
    });

    if (moduleApplianceTabs.length > 0) {
        const secModulesHeader = document.createElement("div");
        secModulesHeader.className = "ssg-docs-sec-header";
        secModulesHeader.textContent = "SSG Smart Modules";
        sidebar.appendChild(secModulesHeader);

        moduleApplianceTabs.forEach(tab => {
            const btn = document.createElement("button");
            btn.className = "ssg-docs-tab-btn";
            btn.textContent = tab.title;
            btn.onclick = () => {
                allButtons.forEach(b => b.classList.remove("active"));
                btn.classList.add("active");
                loadTabContent(tab);
            };
            allButtons.push(btn);
            sidebar.appendChild(btn);
        });
    }

    if (libraryTabs.length > 0) {
        const secLibrariesHeader = document.createElement("div");
        secLibrariesHeader.className = "ssg-docs-sec-header";
        secLibrariesHeader.textContent = "SSG Core Libraries";
        sidebar.appendChild(secLibrariesHeader);

        libraryTabs.forEach(tab => {
            const btn = document.createElement("button");
            btn.className = "ssg-docs-tab-btn";
            btn.textContent = tab.title;
            btn.onclick = () => {
                allButtons.forEach(b => b.classList.remove("active"));
                btn.classList.add("active");
                loadTabContent(tab);
            };
            allButtons.push(btn);
            sidebar.appendChild(btn);
        });
    }

    loadTabContent(suiteTabs[0]);
}

export function renderHUDContent(app) {
    if (!hudContainer) return;

    const body = hudContainer.querySelector(".ssg-hud-body");
    if (!body) return;

    body.innerHTML = "";

    const pipes = [];
    const routers = [];
    const gates = [];
    const vaults = [];
    const sockets = [];
    const tags = [];

    const registry = window.SSG_PipeRegistry || {};
    const socketRegistry = window.SSG_SocketRegistry || {};
    const allGraphNodes = app?.graph ? getAllGraphNodes(app.graph) : [];

    function findBoundSatellites(channelId) {
        const sats = [];
        allGraphNodes.forEach(n => {
            if (n && n.type === "SSGSmartSatellite") {
                const bChan = n.properties?.bound_channel || n.widgets?.find(w => w.name === "channel")?.value;
                if (bChan === channelId) {
                    sats.push({
                        label: `Focus Satellite`,
                        node: n
                    });
                }
            }
        });
        return sats;
    }

    function resolveCustomDisplay(sourceNode, fallbackChanId) {
        if (!sourceNode) return fallbackChanId;
        if (sourceNode.title && sourceNode.title !== sourceNode.type && sourceNode.title !== sourceNode.comfyClass) {
            return sanitizeAndTruncateText(sourceNode.title, 16);
        }
        if (sourceNode.properties?.hud_custom_title) {
            return sanitizeAndTruncateText(sourceNode.properties.hud_custom_title, 16);
        }
        return fallbackChanId;
    }

    for (const [chanId, record] of Object.entries(registry)) {
        if (!record) continue;

        const isHigh = isChannelHighlighted(chanId);
        const isEditing = record.is_editing === true;

        if (chanId.startsWith("SSG_Pipe_")) {
            let sourceNode = null;
            for (const n of allGraphNodes) {
                if (n && n.type === "SSGSmartPipe" && n.properties?.channel_id === chanId) {
                    sourceNode = n;
                    break;
                }
            }

            const boundSats = findBoundSatellites(chanId);
            let tier = isEditing ? "tier-yellow" : getNodeDiagnosticTier(sourceNode, record);

            let satTelemetryItem = null;
            if (tier !== "tier-orange") {
                const masterGen = record.generation || 1;
                for (const satItem of boundSats) {
                    const sat = satItem.node;
                    const isSatActiveSetup = sat._isSpawned || sat.properties?.is_pruned === false || sat.properties?.setup_completed === false;
                    if (isSatActiveSetup) {
                        tier = "tier-yellow";
                        satTelemetryItem = `⚠ SAT [#${getNodeDisplayId(sat)}] Setup Active (Unpruned)`;
                        break;
                    }
                    const satGen = sat.properties?.bound_generation ?? sat._ssgBoundGeneration;
                    if (satGen !== undefined && satGen < masterGen) {
                        tier = "tier-yellow";
                        satTelemetryItem = `⚠ SAT [#${getNodeDisplayId(sat)}] Desync (v${satGen} < v${masterGen})`;
                        break;
                    }
                    if (sat._ssgTrackMismatch) {
                        tier = "tier-yellow";
                        satTelemetryItem = `⚠ SAT [#${getNodeDisplayId(sat)}] Schema Mismatch`;
                        break;
                    }
                }
            }

            pipes.push({
                id: chanId,
                display: resolveCustomDisplay(sourceNode, chanId),
                node: sourceNode,
                masterFocusLabel: "Focus Pipe",
                extraFocus: boundSats,
                isEditing: isEditing,
                tracks: record.tracks || [],
                badgeText: null,
                tierClass: tier,
                isHighlighted: isHigh,
                satelliteAlert: satTelemetryItem,
                canSpawnRx: true,
                onSpawnRx: (e) => spawnBoundSatellite(chanId, app, e),
                onToggleSchema: () => {
                    if (sourceNode) {
                        const lockBtn = sourceNode.widgets?.find(w => w.name === "[ Lock Schema ]" || w.name === "[ Edit Schema ]");
                        if (lockBtn && typeof lockBtn.callback === "function") lockBtn.callback();
                    }
                }
            });
        } else if (chanId.startsWith("SSG_Router_")) {
            let sourceNode = null;
            for (const n of allGraphNodes) {
                if (n && n.type === "SSGSmartRouter" && n.properties?.channel_id === chanId) {
                    sourceNode = n;
                    break;
                }
            }

            const switchW = sourceNode?.widgets?.find(w => w.name === "router_switch");
            const isBankB = isRouterBankB(switchW?.value);
            const boundSats = findBoundSatellites(chanId);
            let tier = isEditing ? "tier-yellow" : getNodeDiagnosticTier(sourceNode, record);

            let satTelemetryItem = null;
            if (tier !== "tier-orange") {
                const masterGen = record.generation || 1;
                for (const satItem of boundSats) {
                    const sat = satItem.node;
                    const isSatActiveSetup = sat._isSpawned || sat.properties?.is_pruned === false || sat.properties?.setup_completed === false;
                    if (isSatActiveSetup) {
                        tier = "tier-yellow";
                        satTelemetryItem = `⚠ SAT [#${getNodeDisplayId(sat)}] Setup Active (Unpruned)`;
                        break;
                    }
                    const satGen = sat.properties?.bound_generation ?? sat._ssgBoundGeneration;
                    if (satGen !== undefined && satGen < masterGen) {
                        tier = "tier-yellow";
                        satTelemetryItem = `⚠ SAT [#${getNodeDisplayId(sat)}] Desync (v${satGen} < v${masterGen})`;
                        break;
                    }
                    if (sat._ssgTrackMismatch) {
                        tier = "tier-yellow";
                        satTelemetryItem = `⚠ SAT [#${getNodeDisplayId(sat)}] Schema Mismatch`;
                        break;
                    }
                }
            }

            routers.push({
                id: chanId,
                display: resolveCustomDisplay(sourceNode, chanId),
                node: sourceNode,
                masterFocusLabel: "Focus Router",
                extraFocus: boundSats,
                isEditing: isEditing,
                tracks: record.tracks || [],
                badgeText: isBankB ? "BANK B" : "BANK A",
                badgeClass: isBankB ? "ssg-hud-badge-bank-b" : "ssg-hud-badge-active",
                tierClass: tier,
                isHighlighted: isHigh,
                satelliteAlert: satTelemetryItem,
                canSpawnRx: true,
                onSpawnRx: (e) => spawnBoundSatellite(chanId, app, e),
                onToggleState: () => {
                    if (sourceNode) {
                        const bankW = sourceNode.widgets?.find(w => w.name === "router_switch");
                        if (bankW) {
                            const nextVal = !isRouterBankB(bankW.value);
                            bankW.value = nextVal;
                            if (typeof bankW.callback === "function") bankW.callback(nextVal);
                            forceNetworkUpdate(app);
                        }
                    }
                },
                onToggleSchema: () => {
                    if (sourceNode) {
                        const lockBtn = sourceNode.widgets?.find(w => w.name === "[ Lock Schema ]" || w.name === "[ Edit Schema ]");
                        if (lockBtn && typeof lockBtn.callback === "function") lockBtn.callback();
                    }
                }
            });
        } else if (chanId.endsWith("_TX")) {
            const cleanBase = chanId.replace(/_(TX|RX)$/, "");
            let masterGateNode = null;
            let relayNode = null;
            let returnNode = null;

            for (const n of allGraphNodes) {
                if (!n) continue;
                if (n.type === "SSGSmartGate" && (n.properties?.channel_id === cleanBase || n.widgets?.find(w => w.name === "channel_name")?.value?.trim() === cleanBase)) {
                    masterGateNode = n;
                } else if (n.type === "SSGSmartGateRelay" && (n.properties?.bound_channel === chanId || n.widgets?.find(w => w.name === "channel")?.value === chanId)) {
                    relayNode = n;
                } else if (n.type === "SSGSmartGateReturn" && (n.properties?.bound_channel === `${cleanBase}_RX` || n.widgets?.find(w => w.name === "channel")?.value === `${cleanBase}_RX`)) {
                    returnNode = n;
                }
            }

            const injectW = masterGateNode?.widgets?.find(w => w.name === "injection_loop" || w.name === "injection_switch" || w.name === "injection");
            const isInjecting = injectW ? injectW.value === true : (masterGateNode?.properties?.injection_loop !== undefined ? !!masterGateNode.properties.injection_loop : true);
            let tier = isEditing ? "tier-yellow" : getNodeDiagnosticTier(masterGateNode, record);

            let affiliateAlert = null;
            const masterGen = record.generation || 1;
            const trackCount = record.tracks ? record.tracks.length : 0;

            const relayOutputs = relayNode?.outputs?.filter(o => o && o.type !== -1 && o.widget === undefined) || [];
            const returnInputs = returnNode?.inputs?.filter(i => i && i.type !== -1 && i.widget === undefined) || [];

            if (isInjecting) {
                if (!relayNode || !returnNode) {
                    tier = "tier-orange";
                    affiliateAlert = `✖ Gate Pair Missing on Canvas`;
                } else {
                    if (returnInputs.length > 0 && returnInputs.some(i => i.link === null || i.link === undefined)) {
                        tier = "tier-orange";
                        affiliateAlert = `✖ Return [#${getNodeDisplayId(returnNode)}] Loop Missing Wire`;
                    } else if (relayOutputs.length !== trackCount || returnInputs.length !== trackCount) {
                        if (tier !== "tier-orange") {
                            tier = "tier-yellow";
                            affiliateAlert = `⚠ Affiliates Sync Required`;
                        }
                    } else {
                        const rGen = relayNode.properties?.bound_generation ?? relayNode._ssgBoundGeneration;
                        const retGen = returnNode.properties?.bound_generation ?? returnNode._ssgBoundGeneration;
                        if ((rGen !== undefined && rGen < masterGen) || (retGen !== undefined && retGen < masterGen)) {
                            if (tier !== "tier-orange") {
                                tier = "tier-yellow";
                                affiliateAlert = `⚠ Affiliates Desync (Pending Sync)`;
                            }
                        }
                    }
                }
            } else {
                if (relayNode && relayOutputs.length !== trackCount) {
                    if (tier !== "tier-orange") {
                        tier = "tier-yellow";
                        affiliateAlert = `⚠ Relay [#${getNodeDisplayId(relayNode)}] Sync Required`;
                    }
                }
                if (returnNode && returnInputs.length !== trackCount) {
                    if (tier !== "tier-orange") {
                        tier = "tier-yellow";
                        affiliateAlert = `⚠ Return [#${getNodeDisplayId(returnNode)}] Sync Required`;
                    }
                }
            }

            const extraFocus = [];
            if (relayNode) extraFocus.push({ label: "Focus Relay", node: relayNode });
            if (returnNode) extraFocus.push({ label: "Focus Return", node: returnNode });

            const hasPair = !!(relayNode || returnNode);

            gates.push({
                id: chanId,
                display: resolveCustomDisplay(masterGateNode, cleanBase),
                node: masterGateNode,
                masterFocusLabel: "Focus Gate",
                extraFocus: extraFocus,
                isEditing: isEditing,
                tracks: record.tracks || [],
                badgeText: isInjecting ? "INJECT" : "BYPASS",
                badgeClass: isInjecting ? "ssg-hud-badge-active" : "ssg-hud-badge-bypass",
                tierClass: tier,
                isHighlighted: isHigh,
                affiliateAlert: affiliateAlert,
                canSpawnRx: !hasPair,
                isPairSpawned: hasPair,
                onSpawnRx: (e) => spawnBoundGatePair(cleanBase, app, e),
                onToggleState: () => {
                    if (masterGateNode) {
                        if (injectW) {
                            injectW.value = !injectW.value;
                            masterGateNode.properties.injection_loop = injectW.value;
                            if (typeof injectW.callback === "function") injectW.callback(injectW.value);
                        } else {
                            masterGateNode.properties.injection_loop = !masterGateNode.properties.injection_loop;
                        }
                        forceNetworkUpdate(app);
                    }
                },
                onToggleSchema: () => {
                    if (masterGateNode) {
                        const lockBtn = masterGateNode.widgets?.find(w => w.name === "[ Lock Schema ]" || w.name === "[ Edit Schema ]");
                        if (lockBtn && typeof lockBtn.callback === "function") lockBtn.callback();
                    }
                }
            });
        }
    }

    for (const n of allGraphNodes) {
        if (!n || n.type !== "SSGSmartVault") continue;

        const chanId = n.properties?.channel_id || n.properties?.vault_id || "SSG_Vault";
        const flushW = n.widgets?.find(w => w.name === "flush_switch");
        const cacheW = n.widgets?.find(w => w.name === "cache_switch");

        const isPlayback = cacheW ? cacheW.value === true : false;
        const isFlush = flushW ? flushW.value === true : true;
        const isHigh = isChannelHighlighted(chanId);

        let badgeText = "BUFFER 🟣";
        let badgeClass = "ssg-hud-badge-buffer";

        if (isPlayback) {
            badgeText = "PLAYBACK ⚡";
            badgeClass = "ssg-hud-badge-playback";
        } else if (!isFlush) {
            badgeText = "FROZEN ❄";
            badgeClass = "ssg-hud-badge-frozen";
        }

        const tierClass = getNodeDiagnosticTier(n);

        vaults.push({
            id: chanId,
            display: resolveCustomDisplay(n, chanId),
            node: n,
            masterFocusLabel: "Focus Vault",
            extraFocus: [],
            isEditing: false,
            badgeText: badgeText,
            badgeClass: badgeClass,
            tierClass: tierClass,
            isHighlighted: isHigh,
            canSpawnRx: false,
            onToggleState: () => {
                if (cacheW && flushW) {
                    if (isPlayback) {
                        cacheW.value = false;
                        flushW.value = true;
                    } else if (isFlush) {
                        cacheW.value = false;
                        flushW.value = false;
                    } else {
                        cacheW.value = true;
                        flushW.value = false;
                    }
                    if (typeof cacheW.callback === "function") cacheW.callback(cacheW.value);
                    if (typeof flushW.callback === "function") flushW.callback(flushW.value);
                    forceNetworkUpdate(app);
                }
            },
            onToggleSchema: () => {
                const lockBtn = n.widgets?.find(w => w.name === "[ Lock Schema ]" || w.name === "[ Edit Schema ]");
                if (lockBtn && typeof lockBtn.callback === "function") lockBtn.callback();
            }
        });
    }

    for (const [socketChanId, record] of Object.entries(socketRegistry)) {
        if (!record || !record.node) continue;
        const sNode = record.node;
        const modId = record.module_id || sNode.properties?.module_id;
        const schema = modId && window.SSG_ModuleRegistry ? window.SSG_ModuleRegistry[modId] : null;

        let displayTitle = socketChanId;
        if (schema?.display_name) {
            displayTitle = sanitizeAndTruncateText(schema.display_name, 16);
        } else if (modId && modId !== "Select Module..." && modId !== "No Modules Found") {
            displayTitle = sanitizeAndTruncateText(modId.replace(/^ssg_module_/, ""), 16);
        }

        const isHigh = isChannelHighlighted(socketChanId);
        const attachedModNode = findAttachedModuleNode(socketChanId, modId, allGraphNodes);
        const hasModuleActive = Boolean(attachedModNode) || checkSocketHasModule(socketChanId, modId, allGraphNodes);

        // Inherit the physical socket's true diagnostic tier
        let tierClass = (sNode._isEditMode || sNode.properties?.is_editing) ? "tier-yellow" : "tier-nominal";
        let alertText = null;

        if (!modId || modId === "Select Module..." || modId === "No Modules Found") {
            tierClass = "tier-yellow";
        } else if (!hasModuleActive) {
            tierClass = "tier-orange";
            alertText = "✖ Vacant Bay (Companion Module Missing)";
        } else if (sNode._isEditMode || sNode.properties?.is_editing) {
            tierClass = "tier-yellow";
            alertText = "⚠ Schema Unlocked";
        }

        const isTransceiver = isTransceiverModule(modId);
        const busLane = sNode.properties?.bus_lane || record.bus_lane || 1;
        const busRole = sNode.properties?.bus_role || record.bus_role || "ACTIVE";
        const partnerId = sNode.properties?.router_partner_id || record.router_partner_id || null;

        // Collision Sniffer: Verify no duplicate active module on this lane without router arbitration
        let hasBusCollision = false;
        if (hasModuleActive && isTransceiver) {
            for (const [otherChanId, otherRec] of Object.entries(socketRegistry)) {
                if (otherChanId === socketChanId || !otherRec?.node) continue;
                const otherNode = otherRec.node;
                const otherModId = otherRec.module_id || otherNode.properties?.module_id;
                if (!otherModId) continue;

                const sameModule = isSameModuleType(modId, otherModId);
                const otherLane = otherNode.properties?.bus_lane || otherRec.bus_lane || 1;
                const otherRole = otherNode.properties?.bus_role || otherRec.bus_role || "ACTIVE";

                if (sameModule && otherLane === busLane) {
                    const isCoupledPair = (partnerId === otherChanId) ||
                                          (otherNode.properties?.router_partner_id === socketChanId);
                    const isArbitrated = isCoupledPair && (
                        (busRole === "ACTIVE" && otherRole === "SHADOW") ||
                        (busRole === "SHADOW" && otherRole === "ACTIVE")
                    );

                    if (!isArbitrated) {
                        hasBusCollision = true;
                        break;
                    }
                }
            }
        }

        if (hasBusCollision) {
            tierClass = "tier-orange";
            alertText = `⚠ Bus Collision: Duplicate ${displayTitle} on Lane ${busLane}`;
        }

        sockets.push({
            id: socketChanId,
            display: displayTitle,
            moduleId: modId,
            node: sNode,
            attachedNode: attachedModNode,
            masterFocusLabel: "Focus Socket",
            extraFocus: attachedModNode ? [{ label: `Focus ${displayTitle}`, node: attachedModNode }] : [],
            isEditing: false,
            badgeText: null,
            tierClass: tierClass,
            isHighlighted: isHigh,
            affiliateAlert: alertText,
            isSocket: true,
            isTransceiver: isTransceiver,
            busLane: busLane,
            busRole: busRole,
            partnerId: partnerId,
            hasBusCollision: hasBusCollision,
            canSpawnRx: false,
            canSpawnModule: !hasModuleActive && !!modId && modId !== "Select Module..." && modId !== "No Modules Found",
            isModuleSpawned: hasModuleActive,
            onSpawnModule: (e) => spawnBoundModule(socketChanId, modId, app, e),
            onCycleBus: () => {
                const nextLane = (busLane % 5) + 1;
                if (typeof sNode.setBusLane === "function") {
                    sNode.setBusLane(nextLane, true);
                } else {
                    sNode.properties.bus_lane = nextLane;
                }
                forceNetworkUpdate(app);
            }
        });
    }

    for (const n of allGraphNodes) {
        if (!n || (n.type !== "SSGSmartTag" && n.comfyClass !== "SSGSmartTag")) continue;

        const tagW = n.widgets?.find(w => w.name === "tag_name" || w.name === "tag");
        const typeW = n.widgets?.find(w => w.name === "type_override");

        const rawText = tagW ? tagW.value : (n.properties?.tag_name || n.title || "Tag");
        const tagTitle = sanitizeAndTruncateText(rawText || "Tag", 16);
        const tagId = `SSG_Tag_${n.id}`;

        const isHigh = isChannelHighlighted(tagId);
        const typeVal = typeW?.value || "*";
        const tier = getTagDiagnosticTier(n, app);

        tags.push({
            id: tagId,
            display: tagTitle,
            node: n,
            isTag: true,
            badgeText: typeVal !== "AUTO" && typeVal !== "*" ? typeVal : null,
            badgeClass: "ssg-hud-badge-active",
            tierClass: tier,
            isHighlighted: isHigh,
            canSpawnRx: false
        });
    }

    const sortFn = (a, b) => a.display.localeCompare(b.display, undefined, { numeric: true, sensitivity: 'base' });
    pipes.sort(sortFn);
    routers.sort(sortFn);
    gates.sort(sortFn);
    vaults.sort(sortFn);
    sockets.sort(sortFn);
    tags.sort(sortFn);

    function filterList(items) {
        if (!searchQuery) return items;
        const q = searchQuery.toLowerCase();
        return items.filter(item =>
            item.display.toLowerCase().includes(q) ||
            item.id.toLowerCase().includes(q) ||
            (item.moduleId && item.moduleId.toLowerCase().includes(q))
        );
    }

    function buildCategory(title, items, catKey) {
        const filtered = filterList(items);
        if (filtered.length === 0) return;

        const isCollapsed = !searchQuery && collapsedCategories.has(catKey);

        const catDiv = document.createElement("div");
        catDiv.className = "ssg-hud-category";

        const catTitle = document.createElement("div");
        catTitle.className = "ssg-hud-cat-title";
        catTitle.innerHTML = `<span>${title} (${filtered.length})</span><span class="ssg-hud-cat-arrow ${isCollapsed ? "" : "open"}">▶</span>`;

        const catContent = document.createElement("div");
        catContent.className = "ssg-hud-cat-content";
        catContent.style.display = isCollapsed ? "none" : "flex";

        catTitle.onclick = () => {
            if (collapsedCategories.has(catKey)) {
                collapsedCategories.delete(catKey);
            } else {
                collapsedCategories.add(catKey);
            }
            saveCollapsedCategories();
            renderHUDContent(app);
        };

        catDiv.appendChild(catTitle);

        filtered.forEach(item => {
            const row = document.createElement("div");
            row.className = `ssg-hud-channel-row ${item.tierClass || "tier-nominal"} ${item.isHighlighted ? "highlighted" : ""}`;

            const header = document.createElement("div");
            header.className = "ssg-hud-channel-header";

            const leftSec = document.createElement("div");
            leftSec.className = "ssg-hud-header-left";

            const nameSpan = document.createElement("span");
            nameSpan.className = "ssg-hud-row-title";
            nameSpan.textContent = formatNodeLabel(item.display, item.node);
            nameSpan.title = `ID: ${item.id}`;
            leftSec.appendChild(nameSpan);

            const rightSec = document.createElement("div");
            rightSec.className = "ssg-hud-header-right";

            if (item.badgeText) {
                const badge = document.createElement("span");
                badge.className = `ssg-hud-status-badge ${item.badgeClass}`;
                badge.textContent = item.badgeText;
                if (typeof item.onToggleState === "function") {
                    badge.title = "Click to toggle state";
                    badge.onclick = (e) => {
                        e.stopPropagation();
                        item.onToggleState();
                        renderHUDContent(app);
                    };
                }
                rightSec.appendChild(badge);
            }

            if (item.canSpawnRx && typeof item.onSpawnRx === "function") {
                const spawnBtn = document.createElement("span");
                spawnBtn.className = "ssg-hud-spawn-btn";
                spawnBtn.textContent = "RX";
                spawnBtn.title = "Spawn receiver node bound to this channel under cursor";
                spawnBtn.onclick = (e) => {
                    e.stopPropagation();
                    item.onSpawnRx(e);
                };
                rightSec.appendChild(spawnBtn);
            } else if (item.isPairSpawned) {
                const lockedBtn = document.createElement("span");
                lockedBtn.className = "ssg-hud-spawn-btn disabled";
                lockedBtn.textContent = "RX";
                lockedBtn.title = "Relay & Return pair already active on canvas (Limit 1 pair per Gate)";
                rightSec.appendChild(lockedBtn);
            } else if (item.isSocket) {
                if (item.canSpawnModule && item.moduleId && typeof item.onSpawnModule === "function") {
                    const spawnModBtn = document.createElement("span");
                    spawnModBtn.className = "ssg-hud-spawn-btn";
                    spawnModBtn.textContent = "MOD";
                    spawnModBtn.title = "Spawn companion module appliance under cursor";
                    spawnModBtn.onclick = (e) => {
                        e.stopPropagation();
                        item.onSpawnModule(e);
                    };
                    rightSec.appendChild(spawnModBtn);
                } else if (item.isModuleSpawned) {
                    // Universal Extensible Mode Badge Cluster Ingestion (Renders for ALL modules)
                    const activeNode = item.attachedNode || allGraphNodes.find(n => 
                        n && (n.properties?.target_socket === item.id || n.widgets?.find(w => w.name === "target_socket")?.value === item.id)
                    );

                    const rawModeData = activeNode?.getHUDModeBadge?.() || item.node?.getHUDModeBadge?.();
                    const badgeList = Array.isArray(rawModeData) ? rawModeData : (rawModeData ? [rawModeData] : []);

                    if (badgeList.length > 0) {
                        const clusterWrap = document.createElement("div");
                        clusterWrap.className = "ssg-hud-badge-cluster";

                        badgeList.forEach(modeBadgeData => {
                            if (!modeBadgeData || !modeBadgeData.text) return;

                            const mBadge = document.createElement("span");
                            mBadge.className = "ssg-hud-bus-btn";
                            mBadge.textContent = `[${modeBadgeData.text}]`;
                            if (modeBadgeData.color) {
                                mBadge.style.color = modeBadgeData.color;
                                mBadge.style.borderColor = modeBadgeData.color;
                            }
                            if (modeBadgeData.bgColor) {
                                mBadge.style.backgroundColor = modeBadgeData.bgColor;
                            }
                            if (modeBadgeData.title) {
                                mBadge.title = modeBadgeData.title;
                            }

                            mBadge.onclick = (e) => {
                                e.stopPropagation();
                                if (modeBadgeData.type === "toggle" && typeof modeBadgeData.onToggle === "function") {
                                    modeBadgeData.onToggle();
                                } else if (modeBadgeData.type === "cycle" && typeof modeBadgeData.onCycle === "function") {
                                    modeBadgeData.onCycle();
                                } else if (typeof modeBadgeData.onClick === "function") {
                                    modeBadgeData.onClick();
                                }
                                if (window.SSG_updateHUDState) {
                                    window.SSG_updateHUDState(app);
                                }
                            };
                            clusterWrap.appendChild(mBadge);
                        });

                        rightSec.appendChild(clusterWrap);
                    }

                    // Bus Lane Transceiver Button (Only for Transceiver modules)
                    if (item.isTransceiver) {
                        const busBtn = document.createElement("span");
                        const isShadow = item.busRole === "SHADOW";
                        const busLabel = `[B${item.busLane}${isShadow ? "*" : ""}]`;
                        busBtn.textContent = busLabel;

                        let badgeClass = "ssg-hud-bus-btn";
                        if (item.hasBusCollision) {
                            badgeClass += " bus-collision";
                            busBtn.title = `Lane ${item.busLane} (COLLISION: Duplicate module on lane). Click to cycle.`;
                        } else if (isShadow) {
                            badgeClass += " bus-shadow";
                            busBtn.title = `Lane ${item.busLane} (Hot-Standby Router Bank B / Read-Only). Click to cycle ganged lane.`;
                        } else {
                            badgeClass += " bus-active";
                            busBtn.title = `Lane ${item.busLane} (Active Transceiver / Read-Write). Click to cycle lane.`;
                        }

                        busBtn.className = badgeClass;
                        busBtn.onclick = (e) => {
                            e.stopPropagation();
                            if (typeof item.onCycleBus === "function") {
                                item.onCycleBus();
                                renderHUDContent(app);
                            }
                        };
                        rightSec.appendChild(busBtn);
                    }
                }
            }

            let arrow = null;
            if (!item.isSocket && !item.isTag && !title.includes("Vault")) {
                arrow = document.createElement("span");
                arrow.className = "ssg-hud-channel-arrow" + (expandedChannels.has(item.id) ? " open" : "");
                arrow.textContent = "▶";
                rightSec.appendChild(arrow);
            } else if (item.isSocket && item.affiliateAlert) {
                arrow = document.createElement("span");
                arrow.className = "ssg-hud-channel-arrow" + (expandedChannels.has(item.id) ? " open" : "");
                arrow.textContent = "▶";
                rightSec.appendChild(arrow);
            }

            header.appendChild(leftSec);
            header.appendChild(rightSec);

            header.onclick = (e) => {
                if (
                    e.target.tagName === "BUTTON" ||
                    e.target.classList.contains("ssg-hud-status-badge") ||
                    e.target.classList.contains("ssg-hud-spawn-btn") ||
                    e.target.classList.contains("ssg-hud-bus-btn") ||
                    e.target.classList.contains("ssg-hud-channel-arrow")
                ) return;

                toggleChannelHighlight(item.id);
                renderHUDContent(app);
                if (app.graph) {
                    app.graph._version = (app.graph._version || 0) + 1;
                    if (typeof app.graph.setDirtyCanvas === "function") app.graph.setDirtyCanvas(true, true);
                }
                if (app.canvas) {
                    app.canvas.setDirty(true, true);
                    if (typeof app.canvas.draw === "function") app.canvas.draw(true, true);
                }
            };

            header.ondblclick = (e) => {
                e.stopPropagation();
                if (item.isTag && item.node) {
                    promptForTagText(item.node, app);
                } else if (!item.isSocket) {
                    promptForNodeRename(item, app);
                }
            };

            header.oncontextmenu = (e) => {
                showContextMenu(e, item, app);
            };

            row.appendChild(header);

            if ((!item.isSocket && !item.isTag && !title.includes("Vault")) || (item.isSocket && item.affiliateAlert)) {
                const trackList = document.createElement("div");
                trackList.className = "ssg-hud-track-list";
                trackList.style.display = expandedChannels.has(item.id) ? "flex" : "none";

                if (item.affiliateAlert) {
                    const alertItem = document.createElement("div");
                    alertItem.className = `ssg-hud-track-item ${item.affiliateAlert.startsWith("✖") ? "status-fault" : "status-warning"}`;
                    alertItem.textContent = item.affiliateAlert;
                    trackList.appendChild(alertItem);
                }

                if (item.satelliteAlert) {
                    const satAlertItem = document.createElement("div");
                    satAlertItem.className = "ssg-hud-track-item status-warning";
                    satAlertItem.textContent = item.satelliteAlert;
                    trackList.appendChild(satAlertItem);
                }

                if (item.isEditing) {
                    const warningItem = document.createElement("div");
                    warningItem.className = "ssg-hud-track-item status-warning";
                    warningItem.textContent = "⚠ Schema Unlocked";
                    trackList.appendChild(warningItem);
                } else if (item.tracks && item.tracks.length > 0) {
                    item.tracks.forEach(t => {
                        const trackItem = document.createElement("div");
                        trackItem.className = "ssg-hud-track-item";
                        const cleanName = (t.name || "◦").trim();
                        trackItem.textContent = cleanName.length > 24 ? cleanName.substring(0, 24) : cleanName;
                        trackList.appendChild(trackItem);
                    });
                } else if (!item.isSocket) {
                    const emptyItem = document.createElement("div");
                    emptyItem.className = "ssg-hud-track-item";
                    emptyItem.style.color = "#6b7280";
                    emptyItem.textContent = "No pins assigned";
                    trackList.appendChild(emptyItem);
                }

                if (arrow) {
                    arrow.onclick = (e) => {
                        e.stopPropagation();
                        if (expandedChannels.has(item.id)) {
                            expandedChannels.delete(item.id);
                            arrow.classList.remove("open");
                            trackList.style.display = "none";
                        } else {
                            expandedChannels.add(item.id);
                            arrow.classList.add("open");
                            trackList.style.display = "flex";
                        }
                    };
                }

                row.appendChild(trackList);
            }

            catContent.appendChild(row);
        });

        catDiv.appendChild(catContent);
        body.appendChild(catDiv);
    }

    buildCategory("Pipes", pipes, "pipes");
    buildCategory("Routers", routers, "routers");
    buildCategory("Gates", gates, "gates");
    buildCategory("Vaults", vaults, "vaults");
    buildCategory("Sockets", sockets, "sockets");
    buildCategory("Tags", tags, "tags");

    if (pipes.length === 0 && routers.length === 0 && gates.length === 0 && vaults.length === 0 && sockets.length === 0 && tags.length === 0) {
        const emptyMsg = document.createElement("div");
        emptyMsg.style.color = "#6b7280";
        emptyMsg.style.textAlign = "center";
        emptyMsg.style.padding = "12px 0";
        emptyMsg.textContent = searchQuery ? "No matching channels" : "No active broadcasts";
        body.appendChild(emptyMsg);
    }
}

export function toggleHUD(app, forceState = null) {
    if (!hudContainer) return;

    isHudVisible = forceState !== null ? forceState : !isHudVisible;
    hudContainer.style.display = isHudVisible ? "flex" : "none";

    if (isHudVisible) {
        renderHUDContent(app);
    } else {
        closeContextMenu();
    }
}

export function updateHUDState(app) {
    createHUDStyles();

    const allNodes = app?.graph ? getAllGraphNodes(app.graph) : [];
    const hasSSGNodes = allNodes.some(n => n && n.type && (n.type.startsWith("SSGSmart") || n.type.startsWith("SSG")));

    if (!hasSSGNodes) {
        if (hudToggleBtn) {
            hudToggleBtn.remove();
            hudToggleBtn = null;
        }
        if (hudContainer) {
            hudContainer.remove();
            hudContainer = null;
        }
        closeContextMenu();
        closeDocsModal();
        isHudVisible = false;
        return;
    }

    if (!hudToggleBtn) {
        hudToggleBtn = document.createElement("button");
        hudToggleBtn.className = "ssg-hud-toggle-btn";
        hudToggleBtn.textContent = "SSG HUD";
        hudToggleBtn.title = "Toggle SSG Command Deck (Alt + S)";
        hudToggleBtn.onclick = () => toggleHUD(app);
        document.body.appendChild(hudToggleBtn);
    }

    if (!hudContainer) {
        hudContainer = document.createElement("div");
        hudContainer.className = "ssg-hud-container";
        hudContainer.style.display = "none";

        const header = document.createElement("div");
        header.className = "ssg-hud-header";

        const title = document.createElement("span");
        title.className = "ssg-hud-title";
        title.textContent = cachedSuiteVersion ? `SSG COMMAND DECK v${cachedSuiteVersion}` : "SSG COMMAND DECK";

        const headerActions = document.createElement("div");
        headerActions.className = "ssg-hud-header-actions";

        const showIdsBtn = document.createElement("button");
        showIdsBtn.className = `ssg-hud-icon-btn ${isShowNodeIdsEnabled ? "active" : ""}`;
        showIdsBtn.innerHTML = "#";
        showIdsBtn.title = "Toggle Native Node IDs (#ID): Displays IDs across channels, receivers, and telemetry";
        showIdsBtn.onclick = (e) => {
            e.stopPropagation();
            isShowNodeIdsEnabled = !isShowNodeIdsEnabled;
            localStorage.setItem(STORAGE_KEY_SHOW_NODE_IDS, String(isShowNodeIdsEnabled));
            showIdsBtn.className = `ssg-hud-icon-btn ${isShowNodeIdsEnabled ? "active" : ""}`;
            renderHUDContent(app);
        };

        const helpBtn = document.createElement("button");
        helpBtn.className = "ssg-hud-help-btn";
        helpBtn.innerHTML = "?";
        helpBtn.title = "Open Documentation & Manual Deck";
        helpBtn.onclick = (e) => {
            e.stopPropagation();
            openDocsModal();
        };

        const closeBtn = document.createElement("button");
        closeBtn.className = "ssg-hud-close-btn";
        closeBtn.innerHTML = "&times;";
        closeBtn.title = "Close HUD";
        closeBtn.onclick = () => toggleHUD(app, false);

        headerActions.appendChild(showIdsBtn);
        headerActions.appendChild(helpBtn);
        headerActions.appendChild(closeBtn);

        header.appendChild(title);
        header.appendChild(headerActions);

        const searchBox = document.createElement("div");
        searchBox.className = "ssg-hud-search-container";

        const searchInput = document.createElement("input");
        searchInput.className = "ssg-hud-search-input";
        searchInput.type = "text";
        searchInput.placeholder = "Filter channels or nodes...";
        searchInput.value = searchQuery;
        searchInput.oninput = (e) => {
            searchQuery = (e.target.value || "").trim();
            renderHUDContent(app);
        };
        searchBox.appendChild(searchInput);

        const body = document.createElement("div");
        body.className = "ssg-hud-body";

        const dockWrapper = document.createElement("div");
        dockWrapper.className = "ssg-hud-dock-wrapper";

        const dockHeader = document.createElement("div");
        dockHeader.className = "ssg-hud-dock-header";
        dockHeader.textContent = "NODE DISPENSARY • CLICK TO DROP";
        dockWrapper.appendChild(dockHeader);

        const palette = document.createElement("div");
        palette.className = "ssg-hud-palette";

        const PALETTE_NODES = [
            { label: "Pipe", type: "SSGSmartPipe" },
            { label: "Satellite", type: "SSGSmartSatellite" },
            { label: "Router", type: "SSGSmartRouter" },
            { label: "Gate", type: "SSGSmartGate" },
            { label: "Relay", type: "SSGSmartGateRelay" },
            { label: "Return", type: "SSGSmartGateReturn" },
            { label: "Socket", type: "SSGSmartSocket" },
            { label: "Vault", type: "SSGSmartVault" },
            { label: "Tag", type: "SSGSmartTag" }
        ];

        PALETTE_NODES.forEach(item => {
            const chip = document.createElement("div");
            chip.className = "ssg-hud-palette-chip";
            chip.textContent = item.label;
            chip.title = `Spawn ${item.label} to cursor`;
            chip.onclick = (e) => {
                e.stopPropagation();
                spawnPaletteNode(item.type, app, e);
            };
            palette.appendChild(chip);
        });

        dockWrapper.appendChild(palette);

        hudContainer.appendChild(header);
        hudContainer.appendChild(searchBox);
        hudContainer.appendChild(body);
        hudContainer.appendChild(dockWrapper);

        document.body.appendChild(hudContainer);
        makeDraggable(hudContainer, header);

        if (!cachedSuiteVersion) {
            fetchSuiteMetadata().then(data => {
                if (data?.version) updateHUDTitleDisplay();
            });
        }
    }

    if (isHudVisible) {
        renderHUDContent(app);
    }
}

window.SSG_updateHUDState = updateHUDState;

function checkNodeMatchesHighlight(node) {
    if (!node) return false;

    if (node.type === "SSGSmartTag" || node.comfyClass === "SSGSmartTag") {
        return isChannelHighlighted(`SSG_Tag_${node.id}`);
    }

    const chProp = node.properties?.channel_id || node.properties?.vault_id;
    if (chProp && isChannelHighlighted(chProp)) {
        return true;
    }

    if (node.type === "SSGSmartGate") {
        const gChan = node.properties?.channel_id || node.widgets?.find(w => w.name === "channel_name")?.value?.trim();
        if (gChan) {
            const cleanBase = gChan.replace(/_(TX|RX)$/, "");
            if (isChannelHighlighted(cleanBase) || isChannelHighlighted(`${cleanBase}_TX`) || isChannelHighlighted(`${cleanBase}_RX`)) {
                return true;
            }
        }
    }

    if (node.type === "SSGSmartGateRelay" || node.type === "SSGSmartGateReturn") {
        const bChan = node.properties?.bound_channel || node.widgets?.find(w => w.name === "channel")?.value;
        if (bChan) {
            const cleanBase = bChan.replace(/_(TX|RX)$/, "");
            if (isChannelHighlighted(cleanBase) || isChannelHighlighted(`${cleanBase}_TX`) || isChannelHighlighted(`${cleanBase}_RX`)) {
                return true;
            }
        }
    }

    if (node.type === "SSGSmartSatellite") {
        const bChan = node.properties?.bound_channel || node.widgets?.find(w => w.name === "channel")?.value;
        if (bChan && isChannelHighlighted(bChan)) {
            return true;
        }
    }

    const targetSockProp = node.properties?.target_socket || (node.type === "SSGSmartSocket" ? node.properties?.channel_id : null);
    if (targetSockProp && isChannelHighlighted(targetSockProp)) {
        return true;
    }

    return false;
}

function renderNetworkHalos(ctx, app) {
    if (!app?.canvas) return;

    const activeGraph = getActiveCanvasGraph(app);
    if (!activeGraph) return;

    const allNodes = activeGraph._nodes || [];
    if (allNodes.length === 0) return;

    const matchedNodes = [];

    for (const node of allNodes) {
        if (!node) continue;

        try {
            if (checkNodeMatchesHighlight(node)) {
                matchedNodes.push({ node, isSubgraphContainer: false });
                continue;
            }

            const sub = node.subgraph || node.inner_graph;
            if (node.isSubgraph || sub) {
                const innerNodes = sub ? (sub._nodes || sub.nodes || []) : [];
                const hasInternalMatch = innerNodes.some(inNode => inNode && checkNodeMatchesHighlight(inNode));
                if (hasInternalMatch) {
                    matchedNodes.push({ node, isSubgraphContainer: true });
                }
            }
        } catch (err) {
            continue;
        }
    }

    if (matchedNodes.length === 0) return;

    ctx.save();
    const time = performance.now() * 0.003;
    const pulseAlpha = 0.55 + (Math.sin(time) * 0.25);

    ctx.strokeStyle = HUD_COLOR_CYAN;
    ctx.shadowColor = HUD_COLOR_CYAN;
    ctx.shadowBlur = 14;
    ctx.lineWidth = 3;

    matchedNodes.forEach(({ node, isSubgraphContainer }) => {
        let x, y, w, h;

        if (typeof node.getBounding === "function") {
            const b = node.getBounding();
            x = b[0];
            y = b[1];
            w = b[2];
            h = b[3];
        } else {
            const titleHeight = (node.flags?.collapsed || !node.title_mode || node.title_mode === LiteGraph.NORMAL_TITLE)
                ? (LiteGraph.NODE_TITLE_HEIGHT || 30)
                : 0;
            x = node.pos[0];
            y = node.pos[1] - titleHeight;
            w = node.size[0];
            h = node.flags?.collapsed ? titleHeight : (node.size[1] + titleHeight);
        }

        ctx.globalAlpha = pulseAlpha;

        if (isSubgraphContainer) {
            ctx.setLineDash([6, 4]);
        } else {
            ctx.setLineDash([]);
        }

        ctx.beginPath();
        ctx.roundRect(x - 4, y - 4, w + 8, h + 8, [8]);
        ctx.stroke();

        ctx.setLineDash([]);

        ctx.globalAlpha = 0.95;
        const cornerLen = Math.min(18, w * 0.2);

        // Top-Left
        ctx.beginPath();
        ctx.moveTo(x - 4, y - 4 + cornerLen);
        ctx.lineTo(x - 4, y - 4);
        ctx.lineTo(x - 4 + cornerLen, y - 4);
        ctx.stroke();

        // Top-Right
        ctx.beginPath();
        ctx.moveTo(x + w + 4 - cornerLen, y - 4);
        ctx.lineTo(x + w + 4, y - 4);
        ctx.lineTo(x + w + 4, y - 4 + cornerLen);
        ctx.stroke();

        // Bottom-Left
        ctx.beginPath();
        ctx.moveTo(x - 4, y + h + 4 - cornerLen);
        ctx.lineTo(x - 4, y + h + 4);
        ctx.lineTo(x - 4 + cornerLen, y + h + 4);
        ctx.stroke();

        // Bottom-Right
        ctx.beginPath();
        ctx.moveTo(x + w + 4 - cornerLen, y + h + 4);
        ctx.lineTo(x + w + 4, y + h + 4);
        ctx.lineTo(x + w + 4, y + h + 4 - cornerLen);
        ctx.stroke();

        if (isSubgraphContainer) {
            ctx.font = "bold 9px monospace";
            ctx.fillStyle = HUD_COLOR_CYAN;
            ctx.textAlign = "right";
            ctx.textBaseline = "bottom";
            ctx.fillText("⚡ [SUBGRAPH LINK]", x + w - 2, y - 8);
        }
    });

    ctx.restore();
}

function installCanvasHaloRenderer(app) {
    if (typeof LiteGraph !== "undefined" && LiteGraph.LGraphCanvas) {
        const origProtoDraw = LiteGraph.LGraphCanvas.prototype.onDrawForeground;
        LiteGraph.LGraphCanvas.prototype.onDrawForeground = function (ctx, visibleNodes) {
            if (origProtoDraw) origProtoDraw.apply(this, arguments);
            renderNetworkHalos(ctx, app);
        };
    }

    if (app?.canvas) {
        const origCanvasDraw = app.canvas.onDrawForeground;
        app.canvas.onDrawForeground = function (ctx, visibleNodes) {
            if (origCanvasDraw) origCanvasDraw.apply(this, arguments);
            renderNetworkHalos(ctx, app);
        };
    }
}

export function initSmartHUD(app) {
    window.addEventListener("keydown", (e) => {
        if (e.altKey && (e.key === "s" || e.key === "S")) {
            e.preventDefault();
            const allNodes = app?.graph ? getAllGraphNodes(app.graph) : [];
            const hasSSGNodes = allNodes.some(n => n && n.type && (n.type.startsWith("SSGSmart") || n.type.startsWith("SSG")));
            if (hasSSGNodes) {
                toggleHUD(app);
            }
        }
    });

    installCanvasHaloRenderer(app);
    fetchSuiteMetadata();
}