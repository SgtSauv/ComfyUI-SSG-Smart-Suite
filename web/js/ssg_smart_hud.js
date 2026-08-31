// ==========================================================================
// SSG CUSTOM NODE ECOSYSTEM (V2 ARCHITECTURE)
// Module: SSG Smart HUD & Command Deck (Transmitter Directory & Telemetry)
// File: /web/js/ssg_smart_hud.js
// ==========================================================================

import {
    SSG_DEFAULT_WIDTH,
    AW_BLUE,
    DIAGNOSTIC_TIERS,
    getAllGraphNodes,
    focusAndCenterOnNode,
    toggleChannelHighlight,
    isChannelHighlighted,
    forceNetworkUpdate
} from "./ssg_core_utils.js";

let hudContainer = null;
let hudToggleBtn = null;
let hudContextMenu = null;
let isHudVisible = false;
let searchQuery = "";
const expandedChannels = new Set();

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
            color: ${AW_BLUE};
            font-weight: bold;
            letter-spacing: 0.5px;
            font-family: 'Courier New', monospace;
        }

        .ssg-hud-close-btn {
            background: transparent;
            border: none;
            color: #9ca3af;
            cursor: pointer;
            font-size: 14px;
            padding: 0 4px;
            line-height: 1;
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
            border-color: ${AW_BLUE};
            box-shadow: 0 0 4px rgba(0, 229, 255, 0.4);
        }

        .ssg-hud-body {
            overflow-y: auto;
            overflow-x: hidden;
            padding: 8px;
            max-height: calc(80vh - 75px);
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
            padding: 2px 4px;
            border-bottom: 1px solid rgba(255, 255, 255, 0.08);
            margin-bottom: 4px;
        }

        .ssg-hud-channel-row {
            background: rgba(22, 27, 34, 0.7);
            border: 1px solid rgba(255, 255, 255, 0.05);
            border-left: 3px solid rgba(0, 229, 255, 0.3);
            border-radius: 4px;
            margin-bottom: 4px;
            overflow: hidden;
            transition: all 0.15s ease;
        }

        .ssg-hud-channel-row.tier-nominal {
            border-left-color: ${AW_BLUE};
        }

        .ssg-hud-channel-row.tier-yellow {
            border-left-color: #ffcc00;
        }

        .ssg-hud-channel-row.tier-orange {
            border-left-color: #ff7700;
        }

        .ssg-hud-channel-row.tier-red {
            border-left-color: #ff3333;
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
            color: ${AW_BLUE};
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

        .ssg-hud-header-right {
            display: flex;
            align-items: center;
            gap: 6px;
            flex-shrink: 0;
        }

        .ssg-hud-status-badge {
            font-size: 9px;
            padding: 1px 4px;
            border-radius: 3px;
            font-weight: bold;
            cursor: pointer;
            user-select: none;
            letter-spacing: 0.3px;
        }

        .ssg-hud-badge-active {
            background: rgba(0, 229, 255, 0.15);
            color: ${AW_BLUE};
            border: 1px solid rgba(0, 229, 255, 0.4);
        }

        .ssg-hud-badge-bypass {
            background: rgba(107, 114, 128, 0.15);
            color: #9ca3af;
            border: 1px solid rgba(107, 114, 128, 0.4);
        }

        .ssg-hud-badge-playback {
            background: rgba(0, 229, 255, 0.2);
            color: ${AW_BLUE};
            border: 1px solid ${AW_BLUE};
        }

        .ssg-hud-badge-live {
            background: rgba(255, 119, 0, 0.15);
            color: #ff7700;
            border: 1px solid rgba(255, 119, 0, 0.4);
        }

        .ssg-hud-badge-frozen {
            background: rgba(56, 189, 248, 0.15);
            color: #38bdf8;
            border: 1px solid rgba(56, 189, 248, 0.4);
        }

        .ssg-hud-beacon-btn {
            cursor: pointer;
            color: #6b7280;
            font-size: 11px;
            padding: 0 2px;
            transition: color 0.15s ease;
        }

        .ssg-hud-beacon-btn:hover {
            color: #ffffff;
        }

        .ssg-hud-beacon-btn.active {
            color: ${AW_BLUE};
            text-shadow: 0 0 6px ${AW_BLUE};
        }

        .ssg-hud-channel-arrow {
            font-size: 8px;
            color: #6b7280;
            transition: transform 0.2s ease;
        }

        .ssg-hud-channel-arrow.open {
            transform: rotate(90deg);
            color: ${AW_BLUE};
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
            color: #ffcc00;
            font-style: italic;
        }

        .ssg-hud-toggle-btn {
            position: fixed;
            top: 15px;
            right: 15px;
            background: rgba(15, 18, 22, 0.9);
            border: 1px solid rgba(0, 229, 255, 0.35);
            color: ${AW_BLUE};
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
            border-color: ${AW_BLUE};
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
            min-width: 170px;
        }

        .ssg-hud-context-item {
            padding: 6px 12px;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 8px;
            transition: background 0.15s ease;
        }

        .ssg-hud-context-item:hover {
            background: rgba(0, 229, 255, 0.15);
            color: ${AW_BLUE};
        }

        .ssg-hud-context-separator {
            height: 1px;
            background: rgba(255, 255, 255, 0.08);
            margin: 4px 0;
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

function showContextMenu(e, itemData, app) {
    e.preventDefault();
    e.stopPropagation();
    closeContextMenu();

    const menu = document.createElement("div");
    menu.className = "ssg-hud-context-menu";
    menu.style.left = `${e.clientX}px`;
    menu.style.top = `${e.clientY}px`;

    // 1. Primary Focus Action
    const focusItem = document.createElement("div");
    focusItem.className = "ssg-hud-context-item";
    focusItem.innerHTML = `<span>🎯</span> Focus Node`;
    focusItem.onclick = () => {
        closeContextMenu();
        if (itemData.node) {
            focusAndCenterOnNode(app, itemData.node);
        }
    };
    menu.appendChild(focusItem);

    // 2. Extra Sub-Focus Actions (For Gate Relay & Return)
    if (itemData.extraFocus && Array.isArray(itemData.extraFocus)) {
        itemData.extraFocus.forEach(extra => {
            if (extra.node) {
                const subFocusItem = document.createElement("div");
                subFocusItem.className = "ssg-hud-context-item";
                subFocusItem.innerHTML = `<span>🎯</span> ${extra.label}`;
                subFocusItem.onclick = () => {
                    closeContextMenu();
                    focusAndCenterOnNode(app, extra.node);
                };
                menu.appendChild(subFocusItem);
            }
        });
    }

    // 3. Highlight Push-Pin Action
    const highlightItem = document.createElement("div");
    highlightItem.className = "ssg-hud-context-item";
    const isHigh = isChannelHighlighted(itemData.id);
    highlightItem.innerHTML = `<span>📌</span> ${isHigh ? "Disable Highlight" : "Highlight Channel"}`;
    highlightItem.onclick = () => {
        closeContextMenu();
        toggleChannelHighlight(itemData.id);
        renderHUDContent(app);
        app.graph?.setDirtyCanvas(true, true);
    };
    menu.appendChild(highlightItem);

    // 4. Copy Channel
    const copyItem = document.createElement("div");
    copyItem.className = "ssg-hud-context-item";
    copyItem.innerHTML = `<span>📋</span> Copy Channel Name`;
    copyItem.onclick = () => {
        closeContextMenu();
        navigator.clipboard.writeText(itemData.id);
    };
    menu.appendChild(copyItem);

    // 5. Contextual Edit / Lock Schema Option
    if (itemData.node && (typeof itemData.onToggleSchema === "function" || itemData.node.widgets?.some(w => w.name === "[ Lock Schema ]" || w.name === "[ Edit Schema ]"))) {
        const sep = document.createElement("div");
        sep.className = "ssg-hud-context-separator";
        menu.appendChild(sep);

        const lockBtn = itemData.node.widgets?.find(w => w.name === "[ Lock Schema ]" || w.name === "[ Edit Schema ]");
        const isEdit = itemData.node._isEditMode === true || itemData.isEditing === true;
        const schemaItem = document.createElement("div");
        schemaItem.className = "ssg-hud-context-item";
        schemaItem.innerHTML = `<span>${isEdit ? "🔒" : "🔓"}</span> ${isEdit ? "Lock Schema" : "Edit Schema"}`;
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

function getNodeDiagnosticTier(node) {
    if (!node) return "tier-nominal";
    if (node._isEditMode) return "tier-yellow";

    const trackInputs = node.inputs?.filter(inp => inp.name && inp.name.startsWith("SSG_")) || [];
    if (!node._isEditMode && trackInputs.length > 0 && trackInputs.some(i => i.link === null || i.link === undefined)) {
        return "tier-orange";
    }

    return "tier-nominal";
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

    const registry = window.SSG_PipeRegistry || {};
    const socketRegistry = window.SSG_SocketRegistry || {};
    const allGraphNodes = app?.graph ? getAllGraphNodes(app.graph) : [];

    // 1. PIPES, ROUTERS & GATES
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

            const tierClass = isHigh ? "highlighted" : (isEditing ? "tier-yellow" : getNodeDiagnosticTier(sourceNode));

            pipes.push({
                id: chanId,
                display: chanId,
                node: sourceNode,
                isEditing: isEditing,
                tracks: record.tracks || [],
                badgeText: null,
                tierClass: tierClass,
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

            const currentBank = sourceNode?.widgets?.find(w => w.name === "router_switch")?.value || "Bank A";
            const tierClass = isHigh ? "highlighted" : (isEditing ? "tier-yellow" : getNodeDiagnosticTier(sourceNode));

            routers.push({
                id: chanId,
                display: chanId,
                node: sourceNode,
                isEditing: isEditing,
                tracks: record.tracks || [],
                badgeText: currentBank.toUpperCase(),
                badgeClass: "ssg-hud-badge-active",
                tierClass: tierClass,
                onToggleState: () => {
                    if (sourceNode) {
                        const bankW = sourceNode.widgets?.find(w => w.name === "router_switch");
                        if (bankW) {
                            bankW.value = bankW.value === "Bank A" ? "Bank B" : "Bank A";
                            if (typeof bankW.callback === "function") bankW.callback(bankW.value);
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
            const cleanBase = chanId.replace(/_TX$/, "");
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
            const isInjecting = injectW ? injectW.value === true : !!masterGateNode?.properties?.injection_loop;
            const tierClass = isHigh ? "highlighted" : (isEditing ? "tier-yellow" : getNodeDiagnosticTier(masterGateNode));

            const extraFocus = [];
            if (relayNode) extraFocus.push({ label: "Focus Relay (TX)", node: relayNode });
            if (returnNode) extraFocus.push({ label: "Focus Return (RX)", node: returnNode });

            gates.push({
                id: chanId,
                display: cleanBase,
                node: masterGateNode,
                extraFocus: extraFocus,
                isEditing: isEditing,
                tracks: record.tracks || [],
                badgeText: isInjecting ? "INJECTING" : "BYPASS",
                badgeClass: isInjecting ? "ssg-hud-badge-active" : "ssg-hud-badge-bypass",
                tierClass: tierClass,
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

    // 2. VAULTS (3-State Mutex: Playback -> Live Buffer -> Frozen)
    for (const n of allGraphNodes) {
        if (!n || n.type !== "SSGSmartVault") continue;

        const chanId = n.properties?.channel_id || n.properties?.vault_id || "SSG_Vault";
        const flushW = n.widgets?.find(w => w.name === "flush_switch");
        const cacheW = n.widgets?.find(w => w.name === "cache_switch");

        const isPlayback = cacheW ? cacheW.value === true : false;
        const isFlush = flushW ? flushW.value === true : true;
        const isHigh = isChannelHighlighted(chanId);

        let badgeText = "BUFFER 🔴";
        let badgeClass = "ssg-hud-badge-live";

        if (isPlayback) {
            badgeText = "PLAYBACK ⚡";
            badgeClass = "ssg-hud-badge-playback";
        } else if (!isFlush) {
            badgeText = "FROZEN ❄";
            badgeClass = "ssg-hud-badge-frozen";
        }

        const tierClass = isHigh ? "highlighted" : getNodeDiagnosticTier(n);

        vaults.push({
            id: chanId,
            display: chanId,
            node: n,
            isEditing: false,
            badgeText: badgeText,
            badgeClass: badgeClass,
            tierClass: tierClass,
            onToggleState: () => {
                if (cacheW && flushW) {
                    if (isPlayback) {
                        // Switch from Playback -> Live Buffer
                        cacheW.value = false;
                        flushW.value = true;
                    } else if (isFlush) {
                        // Switch from Live Buffer -> Frozen
                        cacheW.value = false;
                        flushW.value = false;
                    } else {
                        // Switch from Frozen -> Playback
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

    // 3. SOCKETS (Compact 2-Line Sub-Track Layout)
    for (const [socketChanId, record] of Object.entries(socketRegistry)) {
        if (!record || !record.node) continue;
        const sNode = record.node;
        const modId = record.module_id || sNode.properties?.module_id;
        const schema = modId && window.SSG_ModuleRegistry ? window.SSG_ModuleRegistry[modId] : null;
        const modName = schema?.display_name || (modId ? modId.replace("ssg_module_", "") : "Unassigned");
        const isBypassed = record.bypass || sNode.properties?.bypass === true;
        const isHigh = isChannelHighlighted(socketChanId);

        const tierClass = isHigh ? "highlighted" : (modId ? "tier-nominal" : "tier-yellow");

        sockets.push({
            id: socketChanId,
            display: socketChanId,
            moduleName: modName,
            node: sNode,
            isEditing: false,
            badgeText: isBypassed ? "BYPASS" : "ACTIVE",
            badgeClass: isBypassed ? "ssg-hud-badge-bypass" : "ssg-hud-badge-active",
            tierClass: tierClass,
            isSocket: true,
            onToggleState: () => {
                const bypassW = sNode.widgets?.find(w => w.name === "bypass");
                if (bypassW) {
                    bypassW.value = !bypassW.value;
                    sNode.properties.bypass = bypassW.value;
                    if (typeof bypassW.callback === "function") bypassW.callback(bypassW.value);
                    forceNetworkUpdate(app);
                }
            }
        });
    }

    const sortFn = (a, b) => a.display.localeCompare(b.display, undefined, { numeric: true, sensitivity: 'base' });
    pipes.sort(sortFn);
    routers.sort(sortFn);
    gates.sort(sortFn);
    vaults.sort(sortFn);
    sockets.sort(sortFn);

    function filterList(items) {
        if (!searchQuery) return items;
        const q = searchQuery.toLowerCase();
        return items.filter(item =>
            item.display.toLowerCase().includes(q) ||
            item.id.toLowerCase().includes(q) ||
            (item.moduleName && item.moduleName.toLowerCase().includes(q))
        );
    }

    function buildCategory(title, items) {
        const filtered = filterList(items);
        if (filtered.length === 0) return;

        const catDiv = document.createElement("div");
        catDiv.className = "ssg-hud-category";

        const catTitle = document.createElement("div");
        catTitle.className = "ssg-hud-cat-title";
        catTitle.textContent = `${title} (${filtered.length})`;
        catDiv.appendChild(catTitle);

        filtered.forEach(item => {
            const row = document.createElement("div");
            row.className = `ssg-hud-channel-row ${item.tierClass || "tier-nominal"}`;

            const header = document.createElement("div");
            header.className = "ssg-hud-channel-header";

            // Left Section (Title)
            const leftSec = document.createElement("div");
            leftSec.className = "ssg-hud-header-left";

            const nameSpan = document.createElement("span");
            nameSpan.textContent = item.display;
            leftSec.appendChild(nameSpan);

            // Right Section (Badge + Push-Pin + Arrow)
            const rightSec = document.createElement("div");
            rightSec.className = "ssg-hud-header-right";

            if (item.badgeText) {
                const badge = document.createElement("span");
                badge.className = `ssg-hud-status-badge ${item.badgeClass}`;
                badge.textContent = item.badgeText;
                badge.title = "Click to toggle state";
                badge.onclick = (e) => {
                    e.stopPropagation();
                    if (typeof item.onToggleState === "function") {
                        item.onToggleState();
                        renderHUDContent(app);
                    }
                };
                rightSec.appendChild(badge);
            }

            const beacon = document.createElement("span");
            const isHigh = isChannelHighlighted(item.id);
            beacon.className = `ssg-hud-beacon-btn ${isHigh ? "active" : ""}`;
            beacon.textContent = "📌";
            beacon.title = "Toggle Channel Canvas Glow";
            beacon.onclick = (e) => {
                e.stopPropagation();
                toggleChannelHighlight(item.id);
                renderHUDContent(app);
                app.graph?.setDirtyCanvas(true, true);
            };
            rightSec.appendChild(beacon);

            if (!item.isSocket && !title.includes("Vault")) {
                const arrow = document.createElement("span");
                arrow.className = "ssg-hud-channel-arrow" + (expandedChannels.has(item.id) ? " open" : "");
                arrow.textContent = "▶";
                rightSec.appendChild(arrow);
            }

            header.appendChild(leftSec);
            header.appendChild(rightSec);

            // Double Click -> Focus & Center
            header.ondblclick = (e) => {
                e.stopPropagation();
                if (item.node) {
                    focusAndCenterOnNode(app, item.node);
                }
            };

            // Right Click -> Custom Alienware Context Menu
            header.oncontextmenu = (e) => {
                showContextMenu(e, item, app);
            };

            row.appendChild(header);

            // Expandable Track Section (Pipes/Routers/Gates)
            if (!item.isSocket && !title.includes("Vault")) {
                const trackList = document.createElement("div");
                trackList.className = "ssg-hud-track-list";
                trackList.style.display = expandedChannels.has(item.id) ? "flex" : "none";

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
                } else {
                    const emptyItem = document.createElement("div");
                    emptyItem.className = "ssg-hud-track-item";
                    emptyItem.style.color = "#6b7280";
                    emptyItem.textContent = "No pins assigned";
                    trackList.appendChild(emptyItem);
                }

                header.onclick = (e) => {
                    if (e.target.tagName === "BUTTON" || e.target.classList.contains("ssg-hud-status-badge") || e.target.classList.contains("ssg-hud-beacon-btn")) return;
                    const arrow = rightSec.querySelector(".ssg-hud-channel-arrow");
                    if (expandedChannels.has(item.id)) {
                        expandedChannels.delete(item.id);
                        if (arrow) arrow.classList.remove("open");
                        trackList.style.display = "none";
                    } else {
                        expandedChannels.add(item.id);
                        if (arrow) arrow.classList.add("open");
                        trackList.style.display = "flex";
                    }
                };

                row.appendChild(trackList);
            } else if (item.isSocket) {
                // Socket Compact Module Sub-Line
                const socketSub = document.createElement("div");
                socketSub.className = "ssg-hud-track-list";
                socketSub.style.padding = "3px 8px 5px 14px";
                socketSub.style.display = "flex";

                const modItem = document.createElement("div");
                modItem.className = "ssg-hud-track-item";
                modItem.style.color = AW_BLUE;
                modItem.style.fontFamily = "'Courier New', monospace";
                modItem.style.fontSize = "10px";
                modItem.textContent = `↳ ${item.moduleName || "Unassigned"}`;
                socketSub.appendChild(modItem);

                row.appendChild(socketSub);
            }

            catDiv.appendChild(row);
        });

        body.appendChild(catDiv);
    }

    buildCategory("Pipes", pipes);
    buildCategory("Routers", routers);
    buildCategory("Gates", gates);
    buildCategory("Vaults", vaults);
    buildCategory("Sockets", sockets);

    if (pipes.length === 0 && routers.length === 0 && gates.length === 0 && vaults.length === 0 && sockets.length === 0) {
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
        title.textContent = "SSG COMMAND DECK";

        const closeBtn = document.createElement("button");
        closeBtn.className = "ssg-hud-close-btn";
        closeBtn.innerHTML = "&times;";
        closeBtn.onclick = () => toggleHUD(app, false);

        header.appendChild(title);
        header.appendChild(closeBtn);

        // Filter / Search Input
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

        hudContainer.appendChild(header);
        hudContainer.appendChild(searchBox);
        hudContainer.appendChild(body);

        document.body.appendChild(hudContainer);
        makeDraggable(hudContainer, header);
    }

    if (isHudVisible) {
        renderHUDContent(app);
    }
}

window.SSG_updateHUDState = updateHUDState;

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
}