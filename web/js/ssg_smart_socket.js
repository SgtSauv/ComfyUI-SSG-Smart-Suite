// ==========================================================================
// SSG CUSTOM NODE ECOSYSTEM (V2 ARCHITECTURE)
// Module: SSG Smart Socket (Dynamic In-Line Transceiver & Pin Morpher)
// File: /web/js/ssg_smart_socket.js
// ==========================================================================

import {
    SSG_DEFAULT_WIDTH,
    AW_BLUE,
    DIAGNOSTIC_TIERS,
    sanitizeAndTruncateText,
    applyDynamicShavePass,
    drawSSGWarningOutline,
    drawMasterGlobalTooltip,
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

function getNextSequentialSocketName(app, currentNode) {
    const basePrefix = "SSG_Socket_";
    let highestIndex = 0;

    const allNodes = app?.graph ? getAllGraphNodes(app.graph) : [];

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

    const registryKeys = Object.keys(window.SSG_SocketRegistry || {});
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

function createReadOnlySocketBanner(node) {
    const widget = node.addWidget(
        "custom",
        "channel_display",
        null,
        () => {},
        { serialize: false }
    );

    widget.draw = function (ctx, nodeRef, widgetWidth, y, widgetHeight) {
        const chanId = nodeRef.properties?.channel_id || "UNASSIGNED";
        const modId = nodeRef.properties?.module_id;
        const schema = modId && window.SSG_ModuleRegistry ? window.SSG_ModuleRegistry[modId] : null;
        const alias = schema?.display_name || (modId ? modId.replace("ssg_module_", "") : "Unassigned");

        const rawLabel = `${chanId} (${alias})`;
        const displayLabel = sanitizeAndTruncateText(rawLabel, 29);

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
        ctx.fillText(displayLabel, margin + (drawWidth / 2), y + (drawHeight / 2));
        ctx.restore();
    };

    widget.computeSize = function () {
        return [SSG_DEFAULT_WIDTH, 26];
    };

    return widget;
}

export function setupSmartSocket(nodeType, nodeData, app) {
    const origClone = nodeType.prototype.clone;
    nodeType.prototype.clone = function () {
        const clonedNode = origClone ? origClone.apply(this, arguments) : null;
        if (clonedNode) {
            if (!clonedNode.properties) clonedNode.properties = {};
            clonedNode.properties.channel_id = getNextSequentialSocketName(app, clonedNode);
            clonedNode.properties.module_id = null;
            clonedNode.properties.socket_manifest = "";
            clonedNode.properties.bypass = false;

            while (clonedNode.inputs && clonedNode.inputs.length > 0) {
                clonedNode.removeInput(0);
            }
            clonedNode.inputs = [];

            while (clonedNode.outputs && clonedNode.outputs.length > 0) {
                clonedNode.removeOutput(0);
            }
            clonedNode.outputs = [];
        }
        return clonedNode;
    };

    const origOnConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function (info) {
        syncIncomingProperties(this, info);

        if (origOnConfigure) origOnConfigure.apply(this, arguments);

        const node = this;
        node.properties = node.properties || {};

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
                bypass: !!node.properties.bypass
            };
        }

        if (node._ssgRefreshModuleDropdown) {
            node._ssgRefreshModuleDropdown();
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
        node.properties.bypass = false;
        node.properties.module_id = null;
        node.properties.socket_manifest = "";

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

        createReadOnlySocketBanner(node);

        const bypassWidget = node.widgets?.find(w => w.name === "bypass");
        if (bypassWidget) {
            bypassWidget.callback = (val) => {
                node.properties.bypass = !!val;
                if (node.properties.channel_id && window.SSG_SocketRegistry[node.properties.channel_id]) {
                    window.SSG_SocketRegistry[node.properties.channel_id].bypass = !!val;
                }
                forceNetworkUpdate(app);
                if (node.graph) node.graph.setDirtyCanvas(true, true);
            };
        }

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

        node.applySchemaTopology = function (schema) {
            if (!schema) return;

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
            node.size = [SSG_DEFAULT_WIDTH, Math.max(120, (maxPins * 20) + 95)];
        };

        node.morphSchema = function (moduleId) {
            if (!moduleId || !window.SSG_ModuleRegistry || !window.SSG_ModuleRegistry[moduleId]) {
                return;
            }

            const schema = window.SSG_ModuleRegistry[moduleId];
            node.properties.module_id = moduleId;
            node.properties.socket_manifest = JSON.stringify(schema);

            node.applySchemaTopology(schema);

            if (node.properties.channel_id) {
                window.SSG_SocketRegistry = window.SSG_SocketRegistry || {};
                window.SSG_SocketRegistry[node.properties.channel_id] = {
                    node: node,
                    module_id: moduleId,
                    channel_id: node.properties.channel_id,
                    bypass: !!node.properties.bypass
                };
            }

            const genWidget = node.widgets?.find(w => w.name === "schema_generation");
            if (genWidget) {
                genWidget.value = (genWidget.value || 0) + 1;
            }

            forceNetworkUpdate(app);
            if (node.graph) node.graph.setDirtyCanvas(true, true);
        };

        window.SSG_SocketRegistry = window.SSG_SocketRegistry || {};
        window.SSG_SocketRegistry[node.properties.channel_id] = {
            node: node,
            module_id: null,
            channel_id: node.properties.channel_id,
            bypass: false
        };

        node._ssgRefreshModuleDropdown();

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

        const node = this;
        applyDynamicShavePass(node);

        const chanId = node.properties?.channel_id;
        const moduleId = node.properties?.module_id;
        const bypassVal = node.properties?.bypass === true;
        const inputs = node.inputs || [];

        let activeTier = DIAGNOSTIC_TIERS.TIER_0_NOMINAL;
        const hasBrokenInputLink = inputs.length > 0 && inputs.some(i => i.link === null || i.link === undefined);

        if (!chanId) {
            activeTier = DIAGNOSTIC_TIERS.TIER_3_RED;
        } else if (!moduleId || inputs.length === 0) {
            activeTier = DIAGNOSTIC_TIERS.TIER_1_YELLOW;
        } else if (hasBrokenInputLink) {
            activeTier = DIAGNOSTIC_TIERS.TIER_2_ORANGE;
        }

        drawSSGWarningOutline(node, ctx, activeTier);

        if (node.flags?.collapsed) {
            const cleanName = sanitizeAndTruncateText(chanId || "SOCKET", 16);
            const schema = moduleId && window.SSG_ModuleRegistry ? window.SSG_ModuleRegistry[moduleId] : null;
            const alias = schema?.display_name || (moduleId ? moduleId.replace("ssg_module_", "") : "Unassigned");
            const activeCount = inputs.filter(i => i.link !== null && i.link !== undefined).length || 0;
            const bypassState = bypassVal ? "BYPASS" : "ACTIVE";
            const customTitle = node.title !== "Socket" && node.title !== "SSG Smart Socket" ? ` - ${node.title}` : "";
            const badgeLabel = `SOCKET: ${cleanName} [${alias}] [${activeCount} Trk | ${bypassState}]${customTitle}`;

            drawMasterGlobalTooltip(node, ctx, app, badgeLabel);
        }
    };
}