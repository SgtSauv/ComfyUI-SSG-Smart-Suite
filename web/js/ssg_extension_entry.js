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

const NODE_CONSTRUCTORS = {
    "SSGSmartTag": setupSmartTag,
    "SSGSmartPipe": setupSmartPipe,
    "SSGSmartSatellite": setupSmartSatellite,
    "SSGSmartGate": setupSmartGate,
    "SSGSmartGateRelay": setupSmartGateRelay,
    "SSGSmartGateReturn": setupSmartGateReturn,
    "SSGSmartRouter": setupSmartRouter,
    "SSGSmartVault": setupSmartVault
};

/**
 * Recursively resolves a prompt input wire back through any subgraph / proxy
 * walls to the true physical origin node and slot index.
 */
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

/**
 * Extracts a normalized string value from a node's serialized inputs or widget values.
 */
function extractChannelName(candidateNode, graphNode) {
    if (!candidateNode) return "";

    // NATIVE FIX: Prioritize the hardware MAC address property
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

app.registerExtension({
    name: "SSG.SmartSuite.V2",

    setup(appInstance) {
        const origOnNodeAdded = appInstance.graph.onNodeAdded;

        appInstance.graph.onNodeAdded = function(node) {
            if (origOnNodeAdded) origOnNodeAdded.apply(this, arguments);

            if (node.type && node.type.startsWith("SSGSmart")) {
                setTimeout(
                    () =>
                        typeof window.SSG_forceNetworkUpdate === "function"
                            ? window.SSG_forceNetworkUpdate(appInstance)
                            : null,
                    100
                );
            }
        };

        const origOnNodeRemoved = appInstance.graph.onNodeRemoved;

        appInstance.graph.onNodeRemoved = function(node) {
            if (origOnNodeRemoved) origOnNodeRemoved.apply(this, arguments);

            if (node.type && node.type.startsWith("SSGSmart")) {
                setTimeout(
                    () =>
                        typeof window.SSG_forceNetworkUpdate === "function"
                            ? window.SSG_forceNetworkUpdate(appInstance)
                            : null,
                    100
                );
            }
        };
    },

    async beforeRegisterNodeDef(nodeType, nodeData, appInstance) {
        const setupFn = NODE_CONSTRUCTORS[nodeData.name];

        if (setupFn) {
            setupFn(nodeType, nodeData, appInstance || app);
        }
    }
});

import { forceNetworkUpdate } from "./ssg_core_utils.js";

window.SSG_forceNetworkUpdate = forceNetworkUpdate;

// ==========================================================================
// GRAPH-TO-PROMPT INTERCEPT & FLATTENING ENGINE
// ==========================================================================

const original_graphToPrompt = app.graphToPrompt;

app.graphToPrompt = async function() {
    const res = await original_graphToPrompt.apply(this, arguments);

    if (!res || !res.output) return res;

    const output = res.output;

    // ----------------------------------------------------------------------
    // Build a complete live-node map AND preserve Comfy's execution ID.
    // ----------------------------------------------------------------------

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

            if (n?.subgraph) {
                collectNodes(n.subgraph, executionPath);
            }
        }
    }

    if (app.graph) {
        collectNodes(app.graph);
    }

    // ----------------------------------------------------------------------
    // Process every live graph node.
    // ----------------------------------------------------------------------

    for (const graphNode of allGraphNodes) {
        if (!graphNode) continue;

        const nodeId =
            executionIdByNode.get(graphNode) || String(graphNode.id);

        const promptNode = output[nodeId];

        // ------------------------------------------------------------------
        // 1. VAULT (Cache Severing)
        // ------------------------------------------------------------------

        if (graphNode.type === "SSGSmartVault" && promptNode) {
            const cacheWidget = graphNode.widgets?.find(
                w => w.name === "cache_switch"
            );

            const isPlayback = !!cacheWidget?.value;

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

            let targetChannel = channelWidget?.value;

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
                    candidate.class_type === "SSGSmartRouter" ||
                    candidate.class_type === "SSGSmartVault"
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
                        String(inputVal[0]) === nodeId
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
                                masterGraphNode?.properties?.gate_manifest ||
                                masterGraphNode?.properties?.vault_manifest;

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
                            const masterGraphNode =
                                graphNodeByExecutionId.get(masterId);

                            const activeBank =
                                masterGraphNode?.widgets?.find(
                                    w => w.name === "router_switch"
                                )?.value || "Bank A";

                            const suffix =
                                activeBank === "Bank A" ? "_A" : "_B";

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
            const injectWidget = graphNode.widgets?.find(
                w => w.name === "injection_loop" || w.name === "injection_switch" || w.name === "injection"
            );
            const isInjecting = !!injectWidget?.value;
            const gateChannel = extractChannelName(promptNode, graphNode);

            if (!isInjecting) {
                // BYPASS MODE: Connect upstream of Gate directly to downstream of Gate
                for (const dsId in output) {
                    const dsNode = output[dsId];
                    if (!dsNode || !dsNode.inputs) continue;

                    for (const inputKey of Object.keys(dsNode.inputs)) {
                        const inputVal = dsNode.inputs[inputKey];

                        if (
                            Array.isArray(inputVal) &&
                            String(inputVal[0]) === nodeId
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
                // ACTIVE INSERT MODE: Find bound SSGSmartGateReturn and bridge to downstream of Gate
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
                                String(inputVal[0]) === nodeId
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
    }

    return res;
};