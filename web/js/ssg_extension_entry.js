// ==========================================================================
// SSG CUSTOM NODE ECOSYSTEM (V4 ARCHITECTURE)
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
import { forceNetworkUpdate, isChannelBypassed } from "./ssg_core_utils.js";
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
    name: "SSG.SmartSuite.V4",

    setup(appInstance) {
        const activeApp = appInstance || app;
        initSmartHUD(activeApp);

        const origOnNodeAdded = activeApp.graph.onNodeAdded;
        activeApp.graph.onNodeAdded = function(node) {
            if (origOnNodeAdded) origOnNodeAdded.apply(this, arguments);

            if (node.type && node.type.startsWith("SSG")) {
                setTimeout(() => {
                    if (typeof window.SSG_forceNetworkUpdate === "function") {
                        window.SSG_forceNetworkUpdate(activeApp);
                    }
                    updateHUDState(activeApp);
                }, 100);
            }
        };

        const origOnNodeRemoved = activeApp.graph.onNodeRemoved;
        activeApp.graph.onNodeRemoved = function(node) {
            if (origOnNodeRemoved) origOnNodeRemoved.apply(this, arguments);

            if (node.type && node.type.startsWith("SSG")) {
                setTimeout(() => {
                    if (typeof window.SSG_forceNetworkUpdate === "function") {
                        window.SSG_forceNetworkUpdate(activeApp);
                    }
                    updateHUDState(activeApp);
                }, 100);
            }
        };

        const origLoadGraphData = activeApp.loadGraphData;
        if (origLoadGraphData) {
            activeApp.loadGraphData = async function() {
                const res = await origLoadGraphData.apply(this, arguments);
                setTimeout(() => {
                    if (typeof window.SSG_forceNetworkUpdate === "function") {
                        window.SSG_forceNetworkUpdate(activeApp);
                    }
                    updateHUDState(activeApp);
                }, 150);
                return res;
            };
        }
    },

    afterConfigureGraph() {
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

    // ----------------------------------------------------------------------
    // PRE-PASS: TOPOLOGICAL LOOP QUARANTINE & COMPANION PURGE
    // ----------------------------------------------------------------------
    const quarantinedNodeIds = new Set();
    const quarantinedSocketChannels = new Set();
    const bypassedGateChannels = new Set();

    for (const graphNode of allGraphNodes) {
        if (graphNode && graphNode.type === "SSGSmartGate") {
            const nodeId = executionIdByNode.get(graphNode) || String(graphNode.id);
            const promptNode = output[nodeId];

            let isInjecting = false;
            if (promptNode && promptNode.inputs && promptNode.inputs.injection_loop !== undefined) {
                isInjecting = !!promptNode.inputs.injection_loop;
            } else if (graphNode.properties && graphNode.properties.injection_loop !== undefined) {
                isInjecting = !!graphNode.properties.injection_loop;
            } else {
                const injectWidget = graphNode.widgets?.find(w => w.name === "injection_loop");
                isInjecting = !!injectWidget?.value;
            }

            if (!isInjecting) {
                const gateChan = extractChannelName(promptNode, graphNode);
                if (gateChan) {
                    bypassedGateChannels.add(gateChan);
                }
            }
        }
    }

    if (bypassedGateChannels.size > 0) {
        const bypassedRelayNodes = [];
        const bypassedReturnNodes = [];

        for (const graphNode of allGraphNodes) {
            if (!graphNode) continue;
            const nodeId = executionIdByNode.get(graphNode) || String(graphNode.id);

            if (graphNode.type === "SSGSmartGateRelay") {
                const chan = extractChannelName(output[nodeId], graphNode);
                const baseChan = chan.replace(/_TX$/, "");
                if (bypassedGateChannels.has(baseChan) || bypassedGateChannels.has(chan)) {
                    bypassedRelayNodes.push({ graphNode, executionId: nodeId });
                    quarantinedNodeIds.add(nodeId);
                    quarantinedNodeIds.add(String(graphNode.id));
                }
            } else if (graphNode.type === "SSGSmartGateReturn") {
                const chan = extractChannelName(output[nodeId], graphNode);
                const baseChan = chan.replace(/_RX$/, "");
                if (bypassedGateChannels.has(baseChan) || bypassedGateChannels.has(chan)) {
                    bypassedReturnNodes.push({ graphNode, executionId: nodeId });
                    quarantinedNodeIds.add(nodeId);
                    quarantinedNodeIds.add(String(graphNode.id));
                }
            }
        }

        // Downstream contagion sweep from bypassed Relays (all SSG* nodes)
        function walkDownstreamContagion(startGraphNode) {
            if (!startGraphNode || !startGraphNode.outputs) return;
            for (const outSlot of startGraphNode.outputs) {
                if (!outSlot.links || outSlot.links.length === 0) continue;
                for (const linkId of outSlot.links) {
                    for (const candNode of allGraphNodes) {
                        if (!candNode || !candNode.inputs) continue;
                        for (const inSlot of candNode.inputs) {
                            if (inSlot.link === linkId) {
                                const candType = String(candNode.type || candNode.comfyClass || "");
                                const candExecId = executionIdByNode.get(candNode) || String(candNode.id);

                                if (candType.startsWith("SSG") && candType !== "SSGSmartGate") {
                                    if (candType === "SSGSmartSocket") {
                                        const sockChan = candNode.properties?.channel_id;
                                        if (sockChan) quarantinedSocketChannels.add(sockChan);
                                    }

                                    if (!quarantinedNodeIds.has(candExecId)) {
                                        quarantinedNodeIds.add(candExecId);
                                        quarantinedNodeIds.add(String(candNode.id));
                                        walkDownstreamContagion(candNode);
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        // Upstream contagion sweep from bypassed Returns (all SSG* nodes)
        function walkUpstreamContagion(startGraphNode) {
            if (!startGraphNode || !startGraphNode.inputs) return;
            for (const inSlot of startGraphNode.inputs) {
                if (inSlot.link === null || inSlot.link === undefined) continue;
                const linkId = inSlot.link;
                for (const candNode of allGraphNodes) {
                    if (!candNode || !candNode.outputs) continue;
                    for (const outSlot of candNode.outputs) {
                        if (outSlot.links && outSlot.links.includes(linkId)) {
                            const candType = String(candNode.type || candNode.comfyClass || "");
                            const candExecId = executionIdByNode.get(candNode) || String(candNode.id);

                            if (candType.startsWith("SSG") && candType !== "SSGSmartGate") {
                                if (candType === "SSGSmartSocket") {
                                    const sockChan = candNode.properties?.channel_id;
                                    if (sockChan) quarantinedSocketChannels.add(sockChan);
                                }

                                if (!quarantinedNodeIds.has(candExecId)) {
                                    quarantinedNodeIds.add(candExecId);
                                    quarantinedNodeIds.add(String(candNode.id));
                                    walkUpstreamContagion(candNode);
                                }
                            }
                        }
                    }
                }
            }
        }

        for (const relay of bypassedRelayNodes) {
            walkDownstreamContagion(relay.graphNode);
        }

        for (const ret of bypassedReturnNodes) {
            walkUpstreamContagion(ret.graphNode);
        }

        // Catch companion module decks bound to any quarantined socket
        for (const candidateId in output) {
            const candidate = output[candidateId];
            if (!candidate) continue;

            const candGraphNode = graphNodeByExecutionId.get(candidateId);
            const targetSock = candGraphNode?.properties?.target_socket || candidate.inputs?.target_socket;

            if (targetSock && quarantinedSocketChannels.has(targetSock)) {
                quarantinedNodeIds.add(candidateId);
                if (candGraphNode) quarantinedNodeIds.add(String(candGraphNode.id));
            }
        }

        // Instant pre-emptive purge from output dictionary before link flattening starts
        for (const qId of quarantinedNodeIds) {
            if (output[qId]) {
                delete output[qId];
            }
        }
    }

    // ----------------------------------------------------------------------
    // PRIMARY FLATTENING LOOP
    // ----------------------------------------------------------------------
    for (const graphNode of allGraphNodes) {
        if (!graphNode) continue;

        const nodeId = executionIdByNode.get(graphNode) || String(graphNode.id);
        if (quarantinedNodeIds.has(nodeId) || quarantinedNodeIds.has(String(graphNode.id))) {
            continue;
        }

        const promptNode = output[nodeId];
        if (!promptNode) continue;

        // ------------------------------------------------------------------
        // 1. VAULT (Cache Severing)
        // ------------------------------------------------------------------
        if (graphNode.type === "SSGSmartVault" && promptNode) {
            let isPlayback = false;

            if (promptNode.inputs && promptNode.inputs.cache_switch !== undefined) {
                isPlayback = !!promptNode.inputs.cache_switch;
            } else {
                const cacheWidget = graphNode.widgets?.find(w => w.name === "cache_switch");
                isPlayback = !!cacheWidget?.value;
            }

            if (isPlayback) {
                for (let i = 0; i < 24; i++) {
                    const inputKey = `SSG_${i}`;
                    if (promptNode.inputs && promptNode.inputs[inputKey] !== undefined) {
                        delete promptNode.inputs[inputKey];
                    }
                }
            }
        }

        // ------------------------------------------------------------------
        // 2. SATELLITE / GATE RELAY (Wireless Consumers)
        // ------------------------------------------------------------------
        if (graphNode.type === "SSGSmartSatellite" || graphNode.type === "SSGSmartGateRelay") {
            const channelWidget = graphNode.widgets?.find(w => w.name === "channel");
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
                    const matchingGraphNode = graphNodeByExecutionId.get(candidateId);
                    const chanName = extractChannelName(candidate, matchingGraphNode);

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

                        if (masterTrackIdx === null && outputSlot?.name && masterEntry.inputs) {
                            const masterGraphNode = graphNodeByExecutionId.get(masterId);
                            const masterManifestStr =
                                masterGraphNode?.properties?.pipe_manifest ||
                                masterGraphNode?.properties?.router_manifest ||
                                masterGraphNode?.properties?.gate_manifest;

                            if (masterManifestStr) {
                                try {
                                    const masterTracks = JSON.parse(masterManifestStr);
                                    const matched = masterTracks.find(t => t.name === outputSlot.name);
                                    if (matched && matched.index !== undefined) {
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
                            let isBankB = false;

                            if (masterEntry.inputs && masterEntry.inputs.router_switch !== undefined) {
                                const swVal = masterEntry.inputs.router_switch;
                                isBankB = (swVal === true || swVal === "Bank B" || swVal === "B");
                            } else {
                                const masterGraphNode = graphNodeByExecutionId.get(masterId);
                                const swW = masterGraphNode?.widgets?.find(w => w.name === "router_switch");
                                const swVal = swW?.value;
                                isBankB = (swVal === true || swVal === "Bank B" || swVal === "B");
                            }

                            pipeInputKey = isBankB ? `SSG_${masterTrackIdx}_B` : `SSG_${masterTrackIdx}_A`;
                        }

                        const resolvedOrigin = resolvePromptLinkOrigin(
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
        // 3. MASTER GATE (Loop Routing & Bypass Forwarding)
        // ------------------------------------------------------------------
        if (graphNode.type === "SSGSmartGate" && promptNode) {
            let isInjecting = false;

            if (promptNode.inputs && promptNode.inputs.injection_loop !== undefined) {
                isInjecting = !!promptNode.inputs.injection_loop;
            } else if (graphNode.properties && graphNode.properties.injection_loop !== undefined) {
                isInjecting = !!graphNode.properties.injection_loop;
            } else {
                const injectWidget = graphNode.widgets?.find(w => w.name === "injection_loop");
                isInjecting = !!injectWidget?.value;
            }

            const gateChannel = extractChannelName(promptNode, graphNode);

            if (!isInjecting) {
                // Bypass: Forward local inputs directly to downstream consumers
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
                // Active Injection: Route downstream consumers to the Return module outputs
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
                    const returnGraphNode = graphNodeByExecutionId.get(returnId);

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

                                // Dual-Index Slot Key Resolution:
                                // Return node input slots are named after manifest tracks ("MODEL", "CLIP"),
                                // not necessarily numerical "SSG_N" prefixes.
                                let returnInputKey = null;

                                if (returnGraphNode?.inputs?.[localSlotIdx]) {
                                    const candidateSlotName = returnGraphNode.inputs[localSlotIdx].name;
                                    if (returnEntry.inputs && returnEntry.inputs[candidateSlotName] !== undefined) {
                                        returnInputKey = candidateSlotName;
                                    }
                                }

                                if (!returnInputKey) {
                                    if (returnEntry.inputs && returnEntry.inputs[`SSG_${localSlotIdx}`] !== undefined) {
                                        returnInputKey = `SSG_${localSlotIdx}`;
                                    } else {
                                        const serializedKeys = Object.keys(returnEntry.inputs || {});
                                        if (serializedKeys[localSlotIdx]) {
                                            returnInputKey = serializedKeys[localSlotIdx];
                                        }
                                    }
                                }

                                let resolvedOrigin = null;
                                if (returnInputKey) {
                                    resolvedOrigin = resolvePromptLinkOrigin(
                                        output,
                                        returnEntry,
                                        returnInputKey
                                    );
                                }

                                // Downstream assignment with fallback protection
                                if (resolvedOrigin !== null) {
                                    dsNode.inputs[inputKey] = resolvedOrigin;
                                } else {
                                    // Graceful unlinked fallback: route through the gate's incoming input
                                    const gateInputKey = `SSG_${localSlotIdx}`;
                                    const fallbackOrigin = resolvePromptLinkOrigin(
                                        output,
                                        promptNode,
                                        gateInputKey
                                    );
                                    if (fallbackOrigin !== null) {
                                        dsNode.inputs[inputKey] = fallbackOrigin;
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        // ------------------------------------------------------------------
        // 4. SMART SOCKET (Module Binding & Pass-Through Execution)
        // ------------------------------------------------------------------
        if (graphNode.type === "SSGSmartSocket" && promptNode) {
            let manifestData = null;
            const manifestStr = graphNode.properties?.socket_manifest;
            if (manifestStr) {
                try {
                    manifestData = JSON.parse(manifestStr);
                } catch (e) {
                    manifestData = null;
                }
            }

            const inputsSpec = manifestData?.inputs || [];
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

    return res;
};