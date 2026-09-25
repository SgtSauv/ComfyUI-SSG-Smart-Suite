// ==========================================================================
// SSG CUSTOM NODE ECOSYSTEM (V4 ARCHITECTURE)
// Module: SSG Smart Socket (Dynamic In-Line Transceiver & Pin Morpher)
// File: /web/js/ssg_smart_socket.js
// Status: Complete Hardware Gating, Universal Subgraph Scope Arbitration,
//         Zero-Race Latch, & Cross-Boundary Module Pairing
// ==========================================================================

import { app } from "../../../scripts/app.js";
import {
    SSG_DEFAULT_WIDTH,
    SSG_COLOR_YELLOW_TOPAZ,
    SSG_COLOR_FIRE_OPAL,
    SSG_COLOR_MUTED,
    syncIncomingProperties,
    forceNetworkUpdate,
    isChannelBypassed,
    getAllGraphNodes,
    updateNodeBounds
} from "./ssg_core_utils.js";
import { createSSGDOMBanner, SSG_COLOR_NOMINAL } from "./ssg_dom_banner.js";

if (!window.SSG_BUS) {
    window.SSG_BUS = {
        channels: { 1: {}, 2: {}, 3: {}, 4: {}, 5: {} }
    };
}

// ── UNIVERSAL RECURSIVE GRAPH RESOLUTION (SUBGRAPH TRANSPARENCY) ──
function getUniversalGraphNodes(appInstance, fallbackNode = null) {
    const rootGraph = appInstance?.graph || fallbackNode?.graph;
    if (!rootGraph) return [];

    const nodes = [];
    const visited = new Set();

    function collect(g) {
        if (!g || !g._nodes || visited.has(g)) return;
        visited.add(g);

        for (const n of g._nodes) {
            if (!n) continue;
            nodes.push(n);

            if (n.subgraph) collect(n.subgraph);
            if (n.innerGraph) collect(n.innerGraph);
        }
    }

    // Always start collection from the top-most root graph ancestor
    let topGraph = rootGraph;
    while (topGraph?._subgraph_node?.graph) {
        topGraph = topGraph._subgraph_node.graph;
    }

    collect(topGraph);
    return nodes;
}

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

function getNextSequentialSocketName(app, currentNode) {
    const basePrefix = "SSG_Socket_";
    let highestIndex = 0;

    const allNodes = getUniversalGraphNodes(app, currentNode);

    for (const n of allNodes) {
        if (n && n.type === "SSGSmartSocket" && n !== currentNode) {
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

export function isTransceiverModule(moduleId) {
    if (!moduleId || moduleId === "Select Module..." || moduleId === "No Modules Found") {
        return false;
    }

    const schema = window.SSG_ModuleRegistry ? window.SSG_ModuleRegistry[moduleId] : null;
    if (schema && schema.is_bus_transceiver !== undefined) {
        return !!schema.is_bus_transceiver;
    }

    const clean = moduleId.toLowerCase().replace(/^ssg_module_/, "").replace(/^ssg_/, "");
    const KNOWN_TRANSCEIVERS = [
        "model_loader", "modelloader",
        "lora_loader", "loraloader",
        "prompt_encoder", "promptencoder",
        "sampler", "smartsampler"
    ];

    return KNOWN_TRANSCEIVERS.some(k => clean.includes(k));
}

export function isNodeInstanceOfModule(node, moduleId) {
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

    const nodeType = (node.type || node.comfyClass || "").toLowerCase();
    const cleanMod = moduleId.toLowerCase().replace(/^ssg_module_/, "").replace(/^ssg_/, "").replace(/_/g, "");
    const cleanNode = nodeType.replace(/^ssg/, "").replace(/_/g, "");

    if (cleanNode === cleanMod || cleanNode.includes(cleanMod) || cleanMod.includes(cleanNode)) {
        return true;
    }

    return false;
}

export function setupSmartSocket(nodeType, nodeData, app) {
    const origClone = nodeType.prototype.clone;
    nodeType.prototype.clone = function () {
        const clonedNode = origClone ? origClone.apply(this, arguments) : null;
        if (clonedNode) {
            clonedNode._isCloning = true;

            if (!clonedNode.properties) clonedNode.properties = {};
            const nextChannelId = getNextSequentialSocketName(app, clonedNode);
            clonedNode.properties.channel_id = nextChannelId;
            clonedNode.properties.module_id = null;
            clonedNode.properties.socket_manifest = "";
            clonedNode.properties.bus_lane = 1;
            clonedNode.properties.bus_role = "ACTIVE";
            clonedNode.properties.router_partner_id = null;
            clonedNode._isInGateLoop = false;
            clonedNode._isMorphingTopology = false;

            while (clonedNode.inputs && clonedNode.inputs.length > 0) {
                clonedNode.removeInput(0);
            }
            clonedNode.inputs = [];

            while (clonedNode.outputs && clonedNode.outputs.length > 0) {
                clonedNode.removeOutput(0);
            }
            clonedNode.outputs = [];

            if (typeof clonedNode.updateSSGBanner === "function") {
                clonedNode.updateSSGBanner(`${nextChannelId} (Unassigned)`, SSG_COLOR_YELLOW_TOPAZ);
            }

            if (typeof clonedNode._ssgRefreshModuleDropdown === "function") {
                clonedNode._ssgRefreshModuleDropdown();
            }

            if (typeof clonedNode.updateSocketBannerState === "function") {
                clonedNode.updateSocketBannerState();
            }

            updateNodeBounds(clonedNode, SSG_DEFAULT_WIDTH, 120);

            if (window.SSG_SocketRegistry) {
                window.SSG_SocketRegistry[nextChannelId] = {
                    node: clonedNode,
                    module_id: null,
                    channel_id: nextChannelId,
                    bus_lane: 1,
                    bus_role: "ACTIVE",
                    router_partner_id: null,
                    is_transceiver: false
                };
            }

            clonedNode._isCloning = false;

            setTimeout(() => {
                forceNetworkUpdate(app);
            }, 80);
        }
        return clonedNode;
    };

    const origOnConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function (info) {
        this._isConfiguring = true;
        syncIncomingProperties(this, info);

        if (origOnConfigure) origOnConfigure.apply(this, arguments);

        const node = this;
        node.properties = node.properties || {};
        node._isInGateLoop = false;

        if (node.properties.bus_lane === undefined) {
            node.properties.bus_lane = 1;
        }
        if (!node.properties.bus_role) {
            node.properties.bus_role = "ACTIVE";
        }

        const manifestVal = node.properties.socket_manifest;
        const moduleId = node.properties.module_id;

        if (moduleId && manifestVal) {
            let schema = null;
            try {
                schema = JSON.parse(manifestVal);
            } catch (e) {
                schema = null;
            }

            if (schema) {
                node.applySchemaTopology(schema);
            }
        }

        if (node.properties.channel_id) {
            window.SSG_SocketRegistry = window.SSG_SocketRegistry || {};
            window.SSG_SocketRegistry[node.properties.channel_id] = {
                node: node,
                module_id: node.properties.module_id || null,
                channel_id: node.properties.channel_id,
                bus_lane: node.properties.bus_lane || 1,
                bus_role: node.properties.bus_role || "ACTIVE",
                router_partner_id: node.properties.router_partner_id || null,
                is_transceiver: isTransceiverModule(node.properties.module_id)
            };
        }

        if (node._ssgRefreshModuleDropdown) {
            node._ssgRefreshModuleDropdown();
        }

        if (typeof node.detectGateLoopContext === "function") {
            node.detectGateLoopContext();
        }

        if (typeof node.detectRouterBusRole === "function") {
            node.detectRouterBusRole();
        }

        node._isConfiguring = false;

        if (typeof node.updateSocketBannerState === "function") {
            node.updateSocketBannerState();
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
        node.properties.module_id = null;
        node.properties.socket_manifest = "";
        node.properties.bus_lane = 1;
        node.properties.bus_role = "ACTIVE";
        node.properties.router_partner_id = null;
        node._isMorphingTopology = false;
        node._isCloning = false;
        node._isInGateLoop = false;
        node._isConfiguring = false;

        if (!node.properties.channel_id) {
            node.properties.channel_id = getNextSequentialSocketName(app, node);
        }

        while (node.inputs && node.inputs.length > 0) {
            node.removeInput(0);
        }
        node.inputs = [];

        while (node.outputs && node.outputs.length > 0) {
            node.removeOutput(0);
        }
        node.outputs = [];

        const domBannerWidget = createSSGDOMBanner(node, {
            widgetName: "channel_display",
            initialText: `${node.properties.channel_id} (Unassigned)`,
            initialColor: SSG_COLOR_YELLOW_TOPAZ
        });

        node.updateSocketBannerState = function () {
            const chanId = node.properties?.channel_id || "UNASSIGNED";
            const modId = node.properties?.module_id;
            const schema = modId && window.SSG_ModuleRegistry ? window.SSG_ModuleRegistry[modId] : null;
            const alias = schema?.display_name || (modId ? modId.replace("ssg_module_", "") : "Unassigned");
            const isBypassed = isChannelBypassed(chanId) || !!node.properties?.bypass;

            let displayText = `${chanId} (${alias})`;
            let bannerColor = SSG_COLOR_NOMINAL;

            const inputs = node.inputs || [];
            let connectedInputCount = 0;
            for (let i = 0; i < inputs.length; i++) {
                if (inputs[i] && inputs[i].link !== null && inputs[i].link !== undefined) {
                    connectedInputCount++;
                }
            }

            const outputs = node.outputs || [];
            let connectedOutputCount = 0;
            for (let i = 0; i < outputs.length; i++) {
                if (outputs[i] && outputs[i].links && outputs[i].links.length > 0) {
                    connectedOutputCount++;
                }
            }

            // Universal traversal finds modules regardless of root canvas or nested subgraphs
            const allGraphNodes = getUniversalGraphNodes(app, node);
            let hasPairedModule = false;

            if (modId && modId !== "Select Module..." && modId !== "No Modules Found") {
                for (const n of allGraphNodes) {
                    if (!n || n === node) continue;
                    const targetSock = n.properties?.target_socket || n.widgets?.find(w => w.name === "target_socket")?.value;
                    if (targetSock === chanId) {
                        hasPairedModule = true;
                        break;
                    }
                }
            }

            const isUnwired = inputs.length > 0
                ? (connectedInputCount === 0)
                : (outputs.length > 0 ? (connectedOutputCount === 0) : true);

            if (isBypassed) {
                displayText = "Injection Bypass Detected";
                bannerColor = SSG_COLOR_MUTED;
            } else if (!modId || alias === "Unassigned") {
                displayText = `${chanId} (Unassigned)`;
                bannerColor = SSG_COLOR_YELLOW_TOPAZ;
            } else if (!hasPairedModule) {
                displayText = `${chanId} (${alias})`;
                bannerColor = SSG_COLOR_FIRE_OPAL;
            } else if (isUnwired) {
                displayText = `${chanId} (${alias})`;
                bannerColor = SSG_COLOR_FIRE_OPAL;
            } else {
                displayText = `${chanId} (${alias})`;
                bannerColor = SSG_COLOR_NOMINAL;
            }

            if (typeof node.updateSSGBanner === "function") {
                node.updateSSGBanner(displayText, bannerColor);
            }
        };

        let moduleCombo = node.widgets?.find(w => w.name === "module_select");
        if (!moduleCombo) {
            moduleCombo = node.addWidget(
                "combo",
                "module_select",
                "Select Module...",
                (val) => {
                    const cleanVal = (val || "").trim();
                    if (cleanVal && cleanVal !== "Select Module..." && cleanVal !== "No Modules Found") {
                        node.morphSchema(cleanVal);
                    }
                },
                { values: ["Select Module..."] }
            );
        }

        node._ssgRefreshModuleDropdown = function () {
            if (!moduleCombo) return;
            const availableModules = Object.keys(window.SSG_ModuleRegistry || {});

            if (availableModules.length === 0) {
                moduleCombo.options.values = ["No Modules Found"];
                moduleCombo.value = "No Modules Found";
                return;
            }

            const menuOptions = ["Select Module...", ...availableModules];
            moduleCombo.options.values = menuOptions;

            if (node.properties.module_id && availableModules.includes(node.properties.module_id)) {
                moduleCombo.value = node.properties.module_id;
            } else {
                moduleCombo.value = "Select Module...";
            }
        };

        node.detectGateLoopContext = function () {
            let fedByRelay = false;
            let feedsReturn = false;

            if (node.inputs) {
                for (const inp of node.inputs) {
                    if (inp.link !== null && inp.link !== undefined) {
                        const link = getGraphLink(app, node, inp.link);
                        if (link) {
                            const upNode = node.graph?.getNodeById ? node.graph.getNodeById(link.origin_id) : app.graph?.getNodeById(link.origin_id);
                            if (upNode && upNode.type === "SSGSmartGateRelay") {
                                fedByRelay = true;
                                break;
                            }
                        }
                    }
                }
            }

            if (node.outputs) {
                for (const out of node.outputs) {
                    if (out.links && out.links.length > 0) {
                        for (const lId of out.links) {
                            const link = getGraphLink(app, node, lId);
                            if (link) {
                                const dsNode = node.graph?.getNodeById ? node.graph.getNodeById(link.target_id) : app.graph?.getNodeById(link.target_id);
                                if (dsNode && dsNode.type === "SSGSmartGateReturn") {
                                    feedsReturn = true;
                                    break;
                                }
                            }
                        }
                    }
                    if (feedsReturn) break;
                }
            }

            node._isInGateLoop = fedByRelay || feedsReturn;
            node.updateSocketBannerState();
        };

        node.detectRouterBusRole = function () {
            if (!node.outputs || node.outputs.length === 0) {
                node.properties.bus_role = "ACTIVE";
                node.properties.router_partner_id = null;
                return;
            }

            let resolvedRole = "ACTIVE";
            let partnerId = null;

            function drillDownstream(linkId, visited = new Set()) {
                const link = getGraphLink(app, node, linkId);
                if (!link || link.target_id == null) return null;

                const targetNode = node.graph?.getNodeById
                    ? node.graph.getNodeById(link.target_id)
                    : app.graph?.getNodeById(link.target_id);

                if (!targetNode || visited.has(targetNode)) return null;
                visited.add(targetNode);

                if (targetNode.type === "Reroute") {
                    if (targetNode.outputs?.[0]?.links) {
                        for (const rLink of targetNode.outputs[0].links) {
                            const res = drillDownstream(rLink, visited);
                            if (res) return res;
                        }
                    }
                    return null;
                }

                if (targetNode.type === "SSGSmartRouter") {
                    return { routerNode: targetNode, slotIdx: link.target_slot };
                }

                return null;
            }

            for (const out of node.outputs) {
                if (out.links && out.links.length > 0) {
                    for (const lId of out.links) {
                        const hit = drillDownstream(lId);
                        if (hit) {
                            const { routerNode, slotIdx } = hit;
                            const targetInput = routerNode.inputs?.[slotIdx];
                            const slotName = targetInput?.name || "";
                            const slotLabel = targetInput?.label || "";

                            const isBankB = slotName.endsWith("_B") || slotLabel.includes("(B)") || (slotIdx % 2 === 1);
                            resolvedRole = isBankB ? "SHADOW" : "ACTIVE";

                            const altSlotIdx = isBankB ? slotIdx - 1 : slotIdx + 1;
                            const altInput = routerNode.inputs?.[altSlotIdx];
                            if (altInput && altInput.link != null) {
                                const altLink = getGraphLink(app, routerNode, altInput.link);
                                if (altLink) {
                                    let altOrigin = routerNode.graph?.getNodeById
                                        ? routerNode.graph.getNodeById(altLink.origin_id)
                                        : app.graph?.getNodeById(altLink.origin_id);

                                    const rVisited = new Set();
                                    while (altOrigin && altOrigin.type === "Reroute" && !rVisited.has(altOrigin)) {
                                        rVisited.add(altOrigin);
                                        const rIn = altOrigin.inputs?.[0]?.link;
                                        if (rIn != null) {
                                            const upL = getGraphLink(app, altOrigin, rIn);
                                            altOrigin = upL ? (routerNode.graph?.getNodeById ? routerNode.graph.getNodeById(upL.origin_id) : app.graph?.getNodeById(upL.origin_id)) : null;
                                        } else {
                                            altOrigin = null;
                                        }
                                    }

                                    if (altOrigin && altOrigin.type === "SSGSmartSocket") {
                                        partnerId = altOrigin.properties?.channel_id || null;
                                    }
                                }
                            }
                            break;
                        }
                    }
                }
                if (partnerId || resolvedRole === "SHADOW") break;
            }

            node.properties.bus_role = resolvedRole;
            node.properties.router_partner_id = partnerId;

            if (partnerId && window.SSG_SocketRegistry && window.SSG_SocketRegistry[partnerId]) {
                const partnerReg = window.SSG_SocketRegistry[partnerId];
                if (partnerReg.node && partnerReg.node.properties) {
                    partnerReg.node.properties.router_partner_id = node.properties.channel_id;
                    if (partnerReg.node.properties.bus_lane !== node.properties.bus_lane) {
                        partnerReg.node.properties.bus_lane = node.properties.bus_lane;
                    }
                }
            }

            if (node.properties.channel_id && window.SSG_SocketRegistry) {
                window.SSG_SocketRegistry[node.properties.channel_id] = {
                    node: node,
                    module_id: node.properties.module_id || null,
                    channel_id: node.properties.channel_id,
                    bus_lane: node.properties.bus_lane || 1,
                    bus_role: node.properties.bus_role,
                    router_partner_id: node.properties.router_partner_id,
                    is_transceiver: isTransceiverModule(node.properties.module_id)
                };
            }
        };

        node.setBusLane = function (laneNum, syncPartner = true) {
            const nextLane = Math.max(1, Math.min(5, laneNum));
            node.properties.bus_lane = nextLane;

            if (syncPartner && node.properties.router_partner_id) {
                const pId = node.properties.router_partner_id;
                const partnerEntry = window.SSG_SocketRegistry?.[pId];
                if (partnerEntry && partnerEntry.node && typeof partnerEntry.node.setBusLane === "function") {
                    partnerEntry.node.setBusLane(nextLane, false);
                }
            }

            if (node.properties.channel_id && window.SSG_SocketRegistry) {
                window.SSG_SocketRegistry[node.properties.channel_id] = {
                    node: node,
                    module_id: node.properties.module_id || null,
                    channel_id: node.properties.channel_id,
                    bus_lane: node.properties.bus_lane,
                    bus_role: node.properties.bus_role || "ACTIVE",
                    router_partner_id: node.properties.router_partner_id || null,
                    is_transceiver: isTransceiverModule(node.properties.module_id)
                };
            }

            forceNetworkUpdate(app);
        };

        node.applySchemaTopology = function (schema) {
            if (!schema || node._isMorphingTopology) return;
            node._isMorphingTopology = true;

            try {
                const desiredInputs = schema.inputs || [];
                const desiredOutputs = schema.outputs || [];

                while (node.inputs && node.inputs.length < desiredInputs.length) {
                    const idx = node.inputs.length;
                    node.addInput(`SSG_${idx}`, "*");
                }
                while (node.inputs && node.inputs.length > desiredInputs.length) {
                    node.removeInput(node.inputs.length - 1);
                }

                if (node.inputs) {
                    node.inputs.forEach((inp, idx) => {
                        const inDef = desiredInputs[idx];
                        if (inDef) {
                            inp.name = `SSG_${idx}`;
                            inp.label = inDef.name || `Input_${idx}`;
                            inp.type = inDef.type || "*";
                        }
                    });
                }

                while (node.outputs && node.outputs.length < desiredOutputs.length) {
                    const idx = node.outputs.length;
                    node.addOutput(`SSG_${idx}`, "*");
                }
                while (node.outputs && node.outputs.length > desiredOutputs.length) {
                    node.removeOutput(node.outputs.length - 1);
                }

                if (node.outputs) {
                    node.outputs.forEach((out, idx) => {
                        const outDef = desiredOutputs[idx];
                        if (outDef) {
                            out.name = `SSG_${idx}`;
                            out.label = outDef.name || `Output_${idx}`;
                            out.type = outDef.type || "*";
                        }
                    });
                }

                const maxPins = Math.max(desiredInputs.length, desiredOutputs.length);
                const targetHeight = Math.max(120, (maxPins * 20) + 95);
                updateNodeBounds(node, SSG_DEFAULT_WIDTH, targetHeight);
            } finally {
                node._isMorphingTopology = false;
            }
        };

        node.morphSchema = function (moduleId) {
            if (!moduleId || !window.SSG_ModuleRegistry || !window.SSG_ModuleRegistry[moduleId]) {
                return;
            }

            const schema = window.SSG_ModuleRegistry[moduleId];
            const chanId = node.properties.channel_id;

            if (!node._isConfiguring) {
                const allGraphNodes = getUniversalGraphNodes(app, node);
                allGraphNodes.forEach(n => {
                    if (!n || n === node) return;
                    const targetSock = n.properties?.target_socket || n.widgets?.find(w => w.name === "target_socket")?.value;
                    if (targetSock === chanId && !isNodeInstanceOfModule(n, moduleId)) {
                        if (n.properties) {
                            n.properties.target_socket = "";
                        }
                        const sockW = n.widgets?.find(w => w.name === "target_socket");
                        if (sockW) {
                            sockW.value = "Available";
                            if (typeof sockW.callback === "function") sockW.callback("Available");
                        }
                        if (typeof n.onSocketUnbound === "function") {
                            n.onSocketUnbound();
                        }
                        if (typeof n.updateSSGBanner === "function") {
                            n.updateSSGBanner();
                        }
                        n.setDirtyCanvas(true, true);
                    }
                });
            }

            node.properties.module_id = moduleId;
            node.properties.socket_manifest = JSON.stringify(schema);

            node.applySchemaTopology(schema);

            if (typeof node._ssgRefreshModuleDropdown === "function") {
                node._ssgRefreshModuleDropdown();
            }

            if (typeof node.detectRouterBusRole === "function") {
                node.detectRouterBusRole();
            }

            if (chanId) {
                window.SSG_SocketRegistry = window.SSG_SocketRegistry || {};
                window.SSG_SocketRegistry[chanId] = {
                    node: node,
                    module_id: moduleId,
                    channel_id: chanId,
                    bus_lane: node.properties.bus_lane || 1,
                    bus_role: node.properties.bus_role || "ACTIVE",
                    router_partner_id: node.properties.router_partner_id || null,
                    is_transceiver: isTransceiverModule(moduleId)
                };
            }

            const genWidget = node.widgets?.find(w => w.name === "schema_generation");
            if (genWidget) {
                genWidget.value = (genWidget.value || 0) + 1;
            }

            node.detectGateLoopContext();
            node.updateSocketBannerState();

            moduleCombo?.triggerDraw?.();
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

            forceNetworkUpdate(app);
        };

        const remainingWidgets = (node.widgets || []).filter(
            w => w !== domBannerWidget && w !== moduleCombo
        );
        node.widgets = [domBannerWidget, moduleCombo, ...remainingWidgets].filter(Boolean);

        node.onConnectionsChange = function () {
            if (node._isCloning || node._isMorphingTopology) return;

            if (typeof node.detectGateLoopContext === "function") {
                node.detectGateLoopContext();
            }
            if (typeof node.detectRouterBusRole === "function") {
                node.detectRouterBusRole();
            }
            node.updateSocketBannerState();
            forceNetworkUpdate(app);
        };

        window.SSG_SocketRegistry = window.SSG_SocketRegistry || {};
        window.SSG_SocketRegistry[node.properties.channel_id] = {
            node: node,
            module_id: null,
            channel_id: node.properties.channel_id,
            bus_lane: node.properties.bus_lane || 1,
            bus_role: "ACTIVE",
            router_partner_id: null,
            is_transceiver: false
        };

        node._ssgRefreshModuleDropdown();
        node.detectRouterBusRole();
        node.updateSocketBannerState();
        updateNodeBounds(node, SSG_DEFAULT_WIDTH, 120);

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

        if (chanId && window.SSG_SocketRegistry && window.SSG_SocketRegistry[chanId]) {
            delete window.SSG_SocketRegistry[chanId];
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

app.registerExtension({
    name: "SSG.SmartSocket.Engine",

    afterConfigureGraph() {
        setTimeout(() => {
            const allNodes = getUniversalGraphNodes(app);
            allNodes.forEach(n => {
                if (n && n.type === "SSGSmartSocket" && typeof n.updateSocketBannerState === "function") {
                    n.updateSocketBannerState();
                }
            });
            if (app.graph) app.graph.setDirtyCanvas(true, true);
        }, 100);
    }
});