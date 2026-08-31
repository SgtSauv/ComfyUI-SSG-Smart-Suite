// ==========================================================================
// SSG CUSTOM NODE ECOSYSTEM (V2 ARCHITECTURE)
// Module: Extension Entry Point, Prototype Hooks & graphToPrompt Flattener
// File: /web/js/ssg_extension_entry.js
// ==========================================================================

import { app } from "../../../scripts/app.js";
import { setupSmartTag } from "./ssg_smart_tag.js";
import { setupSmartPipe } from "./ssg_smart_pipe.js";
import { setupSmartSatellite } from "./ssg_smart_satellite.js";
import { setupSmartGate, setupSmartGateRelay, setupSmartGateReturn } from "./ssg_smart_gate.js";
import { setupSmartRouter } from "./ssg_smart_router.js";
import { setupSmartVault } from "./ssg_smart_vault.js";
import { setupSmartSocket } from "./ssg_smart_socket.js";
import { forceNetworkUpdate } from "./ssg_core_utils.js";
import { initSmartHUD, updateHUDState } from "./ssg_smart_hud.js";

const NODE_CONSTRUCTORS = {
    "SSGSmartTag": setupSmartTag,
    "SSGSmartPipe": setupSmartPipe,
    "SSGSmartSatellite": setupSmartSatellite,
    "SSGSmartGate": setupSmartGate,
    "SSGSmartGateRelay": setupSmartGateRelay,
    "SSGSmartGateReturn": setupSmartGateReturn,
    "SSGSmartRouter": setupSmartRouter,
    "SSGSmartVault": setupSmartVault,
    "SSGSmartSocket": setupSmartSocket
};

function resolvePromptLinkOrigin(output, matchingNodeEntry, inputKey) {
    if (!matchingNodeEntry || !matchingNodeEntry.inputs) return null;

    const upstreamLink = matchingNodeEntry.inputs[inputKey];

    if (upstreamLink === undefined) return null;

    if (!Array.isArray(upstreamLink)) {
        return upstreamLink;
    }

    const originNodeId = String(upstreamLink[0]);
    const originSlot = Number(upstreamLink[1]);

    const originEntry = output[originNodeId];

    if (originEntry && originEntry.inputs) {
        const classLower = (originEntry.class_type || "").toLowerCase();

        if (classLower.includes("subgraphinput") || classLower.includes("graphinput")) {
            for (const inpKey in originEntry.inputs) {
                const bridgeLink = originEntry.inputs[inpKey];

                if (Array.isArray(bridgeLink)) {
                    return resolvePromptLinkOrigin(
                        output,
                        { inputs: { target: bridgeLink } },
                        "target"
                    );
                }
            }
        }
    }

    return [originNodeId, originSlot];
}

function extractChannelName(candidateNode, graphNode) {
    if (!candidateNode) return "";

    if (graphNode && graphNode.properties && graphNode.properties.channel_id) {
        return graphNode.properties.channel_id.trim();
    }

    if (candidateNode.inputs) {
        const nameVal =
            candidateNode.inputs.channel_name ||
            candidateNode.inputs.name ||
            candidateNode.inputs.channel;

        if (typeof nameVal === "string" && nameVal.trim() !== "") {
            return nameVal.trim();
        }
    }

    if (graphNode && graphNode.widgets) {
        const nameW = graphNode.widgets.find(
            w =>
                w.name === "channel_name" ||
                w.name === "name" ||
                w.name === "channel"
        );

        if (nameW && typeof nameW.value === "string" && nameW.value.trim() !== "") {
            return nameW.value.trim();
        }
    }

    return "";
}

window.SSG_forceNetworkUpdate = forceNetworkUpdate;

app.registerExtension({
    name: "SSG.SmartSuite.V2",

    setup(appInstance) {
        initSmartHUD(appInstance || app);

        const origOnNodeAdded = appInstance.graph.onNodeAdded;

        appInstance.graph.onNodeAdded = function(node) {
            if (origOnNodeAdded) origOnNodeAdded.apply(this, arguments);

            if (node.type && node.type.startsWith("SSGSmart")) {
                setTimeout(() => {
                    if (typeof window.SSG_forceNetworkUpdate === "function") {
                        window.SSG_forceNetworkUpdate(appInstance);
                    }
                    updateHUDState(appInstance);
                }, 100);
            }
        };

        const origOnNodeRemoved = appInstance.graph.onNodeRemoved;

        appInstance.graph.onNodeRemoved = function(node) {
            if (origOnNodeRemoved) origOnNodeRemoved.apply(this, arguments);

            if (node.type && node.type.startsWith("SSGSmart")) {
                setTimeout(() => {
                    if (typeof window.SSG_forceNetworkUpdate === "function") {
                        window.SSG_forceNetworkUpdate(appInstance);
                    }
                    updateHUDState(appInstance);
                }, 100);
            }
        };

        const origLoadGraphData = appInstance.loadGraphData;
        if (origLoadGraphData) {
            appInstance.loadGraphData = async function() {
                const res = await origLoadGraphData.apply(this, arguments);
                setTimeout(() => {
                    if (typeof window.SSG_forceNetworkUpdate === "function") {
                        window.SSG_forceNetworkUpdate(appInstance);
                    }
                    updateHUDState(appInstance);
                }, 150);
                return res;
            };
        }
    },

    afterConfigureGraph(missingNodeTypes) {
        setTimeout(() => {
            if (typeof window.SSG_forceNetworkUpdate === "function") {
                window.SSG_forceNetworkUpdate(app);
            }
            updateHUDState(app);
        }, 100);
    },

    async beforeRegisterNodeDef(nodeType, nodeData, appInstance) {
        const setupFn = NODE_CONSTRUCTORS[nodeData.name];

        if (setupFn) {
            setupFn(nodeType, nodeData, appInstance || app);
        }
    }
});

// ==========================================================================
// GRAPH-TO-PROMPT INTERCEPT & FLATTENING ENGINE
// ==========================================================================

const original_graphToPrompt = app.graphToPrompt;

app.graphToPrompt = async function() {
    const res = await original_graphToPrompt.apply(this, arguments);

    if (!res || !res.output) return res;

    const output = res.output;

    const allGraphNodes = [];
    const executionIdByNode = new Map();
    const graphNodeByExecutionId = new Map();

    function collectNodes(targetGraph, parentExecutionPath = []) {
        if (!targetGraph) return;

        const nodes = targetGraph._nodes || targetGraph.nodes || [];

        for (const n of nodes) {
            if (!n) continue;

            const localId = String(n.id);
            const executionPath = [...parentExecutionPath, localId];
            const executionId = executionPath.join(":");

            allGraphNodes.push(n);

            executionIdByNode.set(n, executionId);
            graphNodeByExecutionId.set(executionId, n);
            graphNodeByExecutionId.set(localId, n);

            const sub = n?.subgraph || n?.inner_graph;
            if (sub) {
                collectNodes(sub, executionPath);
            }
        }
    }

    if (app.graph) {
        collectNodes(app.graph);
    }

    for (const graphNode of allGraphNodes) {
        if (!graphNode) continue;

        const nodeId =
            executionIdByNode.get(graphNode) || String(graphNode.id);

        const promptNode = output[nodeId];

        // ------------------------------------------------------------------
        // 1. VAULT (Cache Severing)
        // ------------------------------------------------------------------
        if (graphNode.type === "SSGSmartVault" && promptNode) {
            let isPlayback = false;

            if (promptNode.inputs && promptNode.inputs.cache_switch !== undefined) {
                isPlayback = !!promptNode.inputs.cache_switch;
            } else {
                const cacheWidget = graphNode.widgets?.find(
                    w => w.name === "cache_switch"
                );
                isPlayback = !!cacheWidget?.value;
            }

            if (isPlayback) {
                for (let i = 0; i < 24; i++) {
                    const inputKey = `SSG_${i}`;

                    if (
                        promptNode.inputs &&
                        promptNode.inputs[inputKey] !== undefined
                    ) {
                        delete promptNode.inputs[inputKey];
                    }
                }
            }
        }

        // ------------------------------------------------------------------
        // 2. SATELLITE / GATE RELAY (Wireless Consumers)
        // ------------------------------------------------------------------
        if (
            graphNode.type === "SSGSmartSatellite" ||
            graphNode.type === "SSGSmartGateRelay"
        ) {
            const channelWidget = graphNode.widgets?.find(
                w => w.name === "channel"
            );

            let targetChannel = channelWidget?.value || graphNode.properties?.bound_channel;

            if (!targetChannel && promptNode?.inputs) {
                targetChannel = promptNode.inputs.channel;
            }

            if (
                !targetChannel ||
                targetChannel === "Available" ||
                targetChannel === "Unavailable" ||
                targetChannel === "Default"
            ) {
                continue;
            }

            const cleanTarget = String(targetChannel).trim();

            let masterId = null;
            let masterEntry = null;

            for (const candidateId in output) {
                const candidate = output[candidateId];
                if (!candidate) continue;

                if (
                    candidate.class_type === "SSGSmartPipe" ||
                    candidate.class_type === "SSGSmartGate" ||
                    candidate.class_type === "SSGSmartRouter"
                ) {
                    const matchingGraphNode =
                        graphNodeByExecutionId.get(candidateId);

                    const chanName = extractChannelName(
                        candidate,
                        matchingGraphNode
                    );

                    if (
                        chanName === cleanTarget ||
                        `${chanName}_TX` === cleanTarget
                    ) {
                        masterId = candidateId;
                        masterEntry = candidate;
                        break;
                    }
                }
            }

            if (!masterId || !masterEntry) continue;

            let manifestTracks = [];
            const rawManifest =
                graphNode.properties?.satellite_manifest ||
                graphNode.properties?.relay_manifest;

            if (rawManifest) {
                try {
                    manifestTracks =
                        typeof rawManifest === "string"
                            ? JSON.parse(rawManifest)
                            : rawManifest;
                } catch (e) {
                    manifestTracks = [];
                }
            }

            for (const dsId in output) {
                const dsNode = output[dsId];
                if (!dsNode || !dsNode.inputs) continue;

                for (const inputKey of Object.keys(dsNode.inputs)) {
                    const inputVal = dsNode.inputs[inputKey];

                    if (
                        Array.isArray(inputVal) &&
                        (String(inputVal[0]) === nodeId || String(inputVal[0]) === String(graphNode.id))
                    ) {
                        const localSlotIdx = Number(inputVal[1]);
                        const outputSlot = graphNode.outputs?.[localSlotIdx];

                        let masterTrackIdx = null;

                        if (outputSlot?._trackIdx !== undefined) {
                            masterTrackIdx = outputSlot._trackIdx;
                        }

                        if (
                            masterTrackIdx === null &&
                            Array.isArray(manifestTracks) &&
                            manifestTracks[localSlotIdx]
                        ) {
                            const entry = manifestTracks[localSlotIdx];
                            if (entry.index !== undefined) {
                                masterTrackIdx = entry.index;
                            }
                        }

                        if (
                            masterTrackIdx === null &&
                            outputSlot?.name &&
                            masterEntry.inputs
                        ) {
                            const masterGraphNode =
                                graphNodeByExecutionId.get(masterId);

                            const masterManifestStr =
                                masterGraphNode?.properties?.pipe_manifest ||
                                masterGraphNode?.properties?.router_manifest ||
                                masterGraphNode?.properties?.gate_manifest;

                            if (masterManifestStr) {
                                try {
                                    const masterTracks =
                                        JSON.parse(masterManifestStr);

                                    const matched = masterTracks.find(
                                        t => t.name === outputSlot.name
                                    );

                                    if (
                                        matched &&
                                        matched.index !== undefined
                                    ) {
                                        masterTrackIdx = matched.index;
                                    }
                                } catch (e) {}
                            }
                        }

                        if (masterTrackIdx === null) {
                            masterTrackIdx = localSlotIdx;
                        }

                        let pipeInputKey = `SSG_${masterTrackIdx}`;

                        if (masterEntry.class_type === "SSGSmartRouter") {
                            let activeBank = "Bank A";

                            if (masterEntry.inputs && masterEntry.inputs.router_switch !== undefined) {
                                activeBank = masterEntry.inputs.router_switch;
                            } else {
                                const masterGraphNode =
                                    graphNodeByExecutionId.get(masterId);

                                activeBank =
                                    masterGraphNode?.widgets?.find(
                                        w => w.name === "router_switch"
                                    )?.value || "Bank A";
                            }

                            const suffix =
                                (activeBank === "Bank A" || activeBank === "A") ? "_A" : "_B";

                            pipeInputKey =
                                `SSG_${masterTrackIdx}${suffix}`;
                        }

                        const resolvedOrigin =
                            resolvePromptLinkOrigin(
                                output,
                                masterEntry,
                                pipeInputKey
                            );

                        if (resolvedOrigin !== null) {
                            dsNode.inputs[inputKey] = resolvedOrigin;
                        }
                    }
                }
            }
        }

        // ------------------------------------------------------------------
        // 3. MASTER GATE (Bypass & RX Return Splice)
        // ------------------------------------------------------------------
        if (graphNode.type === "SSGSmartGate" && promptNode) {
            let isInjecting = false;

            if (promptNode.inputs) {
                if (promptNode.inputs.injection_loop !== undefined) {
                    isInjecting = !!promptNode.inputs.injection_loop;
                } else if (promptNode.inputs.injection_switch !== undefined) {
                    isInjecting = !!promptNode.inputs.injection_switch;
                } else if (promptNode.inputs.injection !== undefined) {
                    isInjecting = !!promptNode.inputs.injection;
                }
            }

            if (!isInjecting && (!promptNode.inputs || (promptNode.inputs.injection_loop === undefined && promptNode.inputs.injection_switch === undefined && promptNode.inputs.injection === undefined))) {
                const injectWidget = graphNode.widgets?.find(
                    w => w.name === "injection_loop" || w.name === "injection_switch" || w.name === "injection"
                );
                isInjecting = !!injectWidget?.value;
            }

            const gateChannel = extractChannelName(promptNode, graphNode);

            if (!isInjecting) {
                for (const dsId in output) {
                    const dsNode = output[dsId];
                    if (!dsNode || !dsNode.inputs) continue;

                    for (const inputKey of Object.keys(dsNode.inputs)) {
                        const inputVal = dsNode.inputs[inputKey];

                        if (
                            Array.isArray(inputVal) &&
                            (String(inputVal[0]) === nodeId || String(inputVal[0]) === String(graphNode.id))
                        ) {
                            const localSlotIdx = Number(inputVal[1]);
                            const gateInputKey = `SSG_${localSlotIdx}`;

                            const resolvedOrigin = resolvePromptLinkOrigin(
                                output,
                                promptNode,
                                gateInputKey
                            );

                            if (resolvedOrigin !== null) {
                                dsNode.inputs[inputKey] = resolvedOrigin;
                            }
                        }
                    }
                }
            } else {
                const rxTargetChannel = `${gateChannel}_RX`;
                let returnId = null;
                let returnEntry = null;

                for (const candidateId in output) {
                    const candidate = output[candidateId];
                    if (!candidate || candidate.class_type !== "SSGSmartGateReturn") continue;

                    const matchingGraphNode = graphNodeByExecutionId.get(candidateId);
                    const returnChan = extractChannelName(candidate, matchingGraphNode);

                    if (returnChan === rxTargetChannel || returnChan === gateChannel) {
                        returnId = candidateId;
                        returnEntry = candidate;
                        break;
                    }
                }

                if (returnId && returnEntry) {
                    for (const dsId in output) {
                        const dsNode = output[dsId];
                        if (!dsNode || !dsNode.inputs) continue;

                        for (const inputKey of Object.keys(dsNode.inputs)) {
                            const inputVal = dsNode.inputs[inputKey];

                            if (
                                Array.isArray(inputVal) &&
                                (String(inputVal[0]) === nodeId || String(inputVal[0]) === String(graphNode.id))
                            ) {
                                const localSlotIdx = Number(inputVal[1]);
                                const returnInputKey = `SSG_${localSlotIdx}`;

                                const resolvedOrigin = resolvePromptLinkOrigin(
                                    output,
                                    returnEntry,
                                    returnInputKey
                                );

                                if (resolvedOrigin !== null) {
                                    dsNode.inputs[inputKey] = resolvedOrigin;
                                }
                            }
                        }
                    }
                }
            }
        }

        // ------------------------------------------------------------------
        // 4. SMART SOCKET (Dynamic Dispatch & Fallback Flattener)
        // ------------------------------------------------------------------
        if (graphNode.type === "SSGSmartSocket" && promptNode) {
            let isBypassed = false;

            if (promptNode.inputs && promptNode.inputs.bypass !== undefined) {
                isBypassed = !!promptNode.inputs.bypass;
            } else {
                const bypassWidget = graphNode.widgets?.find(w => w.name === "bypass");
                isBypassed = !!bypassWidget?.value || !!graphNode.properties?.bypass;
            }

            let manifestData = null;
            const manifestStr = graphNode.properties?.socket_manifest;
            if (manifestStr) {
                try {
                    manifestData = JSON.parse(manifestStr);
                } catch (e) {
                    manifestData = null;
                }
            }

            const outputsSpec = manifestData?.outputs || [];
            const inputsSpec = manifestData?.inputs || [];
            const inputNameToIdx = {};
            inputsSpec.forEach((spec, idx) => {
                inputNameToIdx[spec.name || `SSG_${idx}`] = idx;
            });

            if (isBypassed) {
                // BYPASS PATH: Rewire downstream nodes to upstream fallback inputs or neutral literals
                for (const dsId in output) {
                    const dsNode = output[dsId];
                    if (!dsNode || !dsNode.inputs) continue;

                    for (const inputKey of Object.keys(dsNode.inputs)) {
                        const inputVal = dsNode.inputs[inputKey];

                        if (
                            Array.isArray(inputVal) &&
                            (String(inputVal[0]) === nodeId || String(inputVal[0]) === String(graphNode.id))
                        ) {
                            const localOutIdx = Number(inputVal[1]);
                            const outDef = outputsSpec[localOutIdx];
                            const fallbackKey = outDef?.fallback;

                            if (fallbackKey && inputNameToIdx[fallbackKey] !== undefined) {
                                const fallbackInIdx = inputNameToIdx[fallbackKey];
                                const socketInputKey = `SSG_${fallbackInIdx}`;

                                const resolvedOrigin = resolvePromptLinkOrigin(
                                    output,
                                    promptNode,
                                    socketInputKey
                                );

                                if (resolvedOrigin !== null) {
                                    dsNode.inputs[inputKey] = resolvedOrigin;
                                }
                            } else {
                                // Diagnostic Test: Provide safe neutral literal instead of deleting input key
                                const outTypeStr = String(outDef?.type || "").toUpperCase();
                                if (outTypeStr.includes("STRING") || outTypeStr.includes("TEXT")) {
                                    dsNode.inputs[inputKey] = "";
                                } else if (outTypeStr.includes("INT") || outTypeStr.includes("FLOAT")) {
                                    dsNode.inputs[inputKey] = 0;
                                } else if (outTypeStr.includes("BOOL")) {
                                    dsNode.inputs[inputKey] = false;
                                } else {
                                    dsNode.inputs[inputKey] = null;
                                }
                            }
                        }
                    }
                }
            } else {
                // ACTIVE DISPATCH PATH: Splice socket input tensors into module & route module outputs downstream
                const socketChanId = graphNode.properties?.channel_id;

                let boundModuleId = null;
                let boundModuleEntry = null;

                for (const candidateId in output) {
                    const candidate = output[candidateId];
                    if (!candidate) continue;

                    const candidateGraphNode = graphNodeByExecutionId.get(candidateId);
                    const targetSock = candidateGraphNode?.properties?.target_socket || candidate.inputs?.target_socket;

                    if (targetSock === socketChanId) {
                        boundModuleId = candidateId;
                        boundModuleEntry = candidate;
                        break;
                    }
                }

                if (boundModuleId && boundModuleEntry) {
                    boundModuleEntry.inputs = boundModuleEntry.inputs || {};

                    // 1. Route Socket physical inputs directly into Module inputs
                    inputsSpec.forEach((spec, idx) => {
                        const socketInputKey = `SSG_${idx}`;
                        const moduleInputKey = spec.name;

                        const resolvedOrigin = resolvePromptLinkOrigin(
                            output,
                            promptNode,
                            socketInputKey
                        );

                        if (resolvedOrigin !== null) {
                            boundModuleEntry.inputs[moduleInputKey] = resolvedOrigin;
                        }
                    });

                    // 2. Rewire downstream nodes to receive from Module outputs directly
                    for (const dsId in output) {
                        const dsNode = output[dsId];
                        if (!dsNode || !dsNode.inputs) continue;

                        for (const inputKey of Object.keys(dsNode.inputs)) {
                            const inputVal = dsNode.inputs[inputKey];

                            if (
                                Array.isArray(inputVal) &&
                                (String(inputVal[0]) === nodeId || String(inputVal[0]) === String(graphNode.id))
                            ) {
                                const localOutIdx = Number(inputVal[1]);
                                dsNode.inputs[inputKey] = [boundModuleId, localOutIdx];
                            }
                        }
                    }
                }
            }
        }
    }

    return res;
};