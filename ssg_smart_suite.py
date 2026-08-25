# ==========================================================================
# SSG CUSTOM NODE ECOSYSTEM (V2 ARCHITECTURE)
# Designation: SgtSauv & Gemini (Joint Architecture)
# Status: 8-Core Smart Suite Engine ➔ DATA BUS, ROUTING & MEMORY CACHING
# ==========================================================================

import torch

# Persistent global registry allocation for runtime cross-node data passing
if not hasattr(torch, "_ssg_piperegistry"):
    setattr(torch, "_ssg_piperegistry", {})

if not hasattr(torch, "_ssg_vault_registry"):
    setattr(torch, "_ssg_vault_registry", {})


class SSGSmartPipe:
    DESCRIPTION = """
Master multi-track wireless transmitter.
---
Spawns in [ Edit Mode ] with dynamic parking dots. Connect input wires and click [ Lock ] to register an immutable channel schema to the network.
---
🟡 Edit Mode active / open parking dots.
🟠 Channel name collision or unregistered data type.
🔴 Empty channel name or cyclic graph dependency.
"""
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {},
            "hidden": {
                "schema_generation": ("INT", {"default": 0}),
            },
            "optional": {
                **{f"SSG_{i}": ("*",) for i in range(24)}
            }
        }

    @classmethod
    def VALIDATE_INPUTS(cls, **kwargs):
        return True

    RETURN_TYPES = tuple(["*"] * 24)
    RETURN_NAMES = tuple([f"◦" for _ in range(24)])
    FUNCTION = "transmit_pipeline"
    CATEGORY = "SSG Network Logic"

    def transmit_pipeline(self, schema_generation=0, **kwargs):
        channel_name = kwargs.get("channel_id", "SSG_Orphan_Pipe")
        payload = [kwargs.get(f"SSG_{i}", None) for i in range(24)]
        torch._ssg_piperegistry[channel_name] = payload
        return tuple(payload)


class SSGSmartSatellite:
    DESCRIPTION = """
Multi-track static wireless receiver bus.
---
Select a registered channel and click [ Spawn Tracks ]. Wire required outputs downstream, then click [ Prune ] to collapse unused slots.
---
🟡 Unpruned spawned tracks pending cleanup.
🟠 Upstream schema changed (Generation Mismatch) / Channel orphan.
🔴 Channel not found during graph flattening.
"""
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "channel": (["Default"],),
            },
            "hidden": {
                "bound_generation": ("INT", {"default": 0}),
            }
        }

    @classmethod
    def VALIDATE_INPUTS(cls, channel, **kwargs):
        return True

    RETURN_TYPES = tuple(["*"] * 24)
    RETURN_NAMES = tuple([f"◦" for _ in range(24)])
    FUNCTION = "consume_pipeline"
    CATEGORY = "SSG Network Logic"

    def consume_pipeline(self, channel, bound_generation=0, **kwargs):
        if not channel or channel in ["Default", "Unavailable", "Available"]:
            return tuple([None] * 24)

        payload = torch._ssg_piperegistry.get(channel, [None] * 24)
        if len(payload) < 24:
            payload = list(payload) + [None] * (24 - len(payload))

        return tuple(payload[:24])


class SSGSmartGate:
    DESCRIPTION = """
Master inline injection loop valve.
---
Automatically registers {Channel}_TX and {Channel}_RX blueprints.
• Injection ON: Inputs broadcast to _TX; outputs wait for processed signals returning from _RX.
• Injection OFF (Bypass): Inputs pass straight through to outputs.
---
🟡 Edit Mode active.
🟠 Missing return schema or schema generation mismatch.
🔴 Unassigned channel base.
"""
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "injection_loop": ("BOOLEAN", {"default": False}),
            },
            "hidden": {
                "gate_manifest": ("STRING", {"default": ""}),
                "schema_generation": ("INT", {"default": 0}),
            },
            "optional": {
                **{f"SSG_{i}": ("*",) for i in range(24)}
            }
        }

    @classmethod
    def VALIDATE_INPUTS(cls, **kwargs):
        return True

    RETURN_TYPES = tuple(["*"] * 24)
    RETURN_NAMES = tuple([f"◦" for _ in range(24)])
    FUNCTION = "process_gate_pipeline"
    CATEGORY = "SSG Network Logic"

    def process_gate_pipeline(self, injection_loop, gate_manifest="", schema_generation=0, **kwargs):
        channel_name = kwargs.get("channel_id", "SSG_Orphan_Gate")
        local_inputs = [kwargs.get(f"SSG_{i}", None) for i in range(24)]
        
        tx_channel = f"{channel_name}_TX"
        torch._ssg_piperegistry[tx_channel] = local_inputs

        if injection_loop:
            rx_channel = f"{channel_name}_RX"
            raw_rx = torch._ssg_piperegistry.get(rx_channel, None)
            padded_rx = [None] * 24
            if isinstance(raw_rx, (list, tuple)):
                for idx, val in enumerate(raw_rx):
                    if idx < 24:
                        padded_rx[idx] = val
            return tuple(padded_rx)

        return tuple(local_inputs)


class SSGSmartGateRelay:
    DESCRIPTION = """
Dedicated consumer placed at the start of an injection subgraph loop.
---
Target parent Gate channel and click [ Sync ] to lock to exact pin counts and data types registered by the parent Gate inputs.
---
🟡 Pending schema synchronization.
🟠 Target _TX channel missing or renamed.
"""
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "channel": (["Default"],),
            },
            "hidden": {
                "relay_manifest": ("STRING", {"default": ""}),
                "bound_generation": ("INT", {"default": 0}),
            }
        }

    @classmethod
    def VALIDATE_INPUTS(cls, channel, **kwargs):
        return True

    RETURN_TYPES = tuple(["*"] * 24)
    RETURN_NAMES = tuple([f"◦" for _ in range(24)])
    FUNCTION = "receive_gate_tx"
    CATEGORY = "SSG Network Logic"

    def receive_gate_tx(self, channel, relay_manifest="", bound_generation=0, **kwargs):
        if not channel or channel in ["Default", "Unavailable", "Available"]:
            return tuple([None] * 24)

        payload = torch._ssg_piperegistry.get(channel, [None] * 24)
        if len(payload) < 24:
            payload = list(payload) + [None] * (24 - len(payload))
        return tuple(payload[:24])


class SSGSmartGateReturn:
    DESCRIPTION = """
Dedicated transmitter placed at the end of an injection subgraph loop.
---
Target parent Gate channel and click [ Sync ] to pull the expected return schema, then wire processed loop signals back to the master Gate outputs.
---
🟡 Unwired required return tracks.
🟠 Missing parent Gate return blueprint.
"""
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "channel": (["Default"],),
            },
            "hidden": {
                "return_manifest": ("STRING", {"default": ""}),
                "bound_generation": ("INT", {"default": 0}),
            },
            "optional": {
                **{f"SSG_{i}": ("*",) for i in range(24)}
            }
        }

    @classmethod
    def VALIDATE_INPUTS(cls, channel, **kwargs):
        return True

    RETURN_TYPES = ()
    OUTPUT_NODE = True
    FUNCTION = "transmit_gate_rx"
    CATEGORY = "SSG Network Logic"

    def transmit_gate_rx(self, channel, return_manifest="", bound_generation=0, **kwargs):
        if not channel or channel in ["Default", "Unavailable", "Available"]:
            return ()
        payload = [kwargs.get(f"SSG_{i}", None) for i in range(24)]
        torch._ssg_piperegistry[channel] = payload
        return ()


class SSGSmartRouter:
    DESCRIPTION = """
High-speed crossbar selector for A/B model and pipeline comparisons.
---
Toggling between Bank A and Bank B switches internal routing instantly without breaking downstream receiver links or resetting channel structures.
---
🟡 Edit Mode active.
🟠 Data type mismatch between paired A/B slots.
"""
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "router_switch": (["Bank A", "Bank B"], {"default": "Bank A"}),
            },
            "hidden": {
                "router_manifest": ("STRING", {"default": ""}),
                "schema_generation": ("INT", {"default": 0}),
            },
            "optional": {
                **{f"SSG_{i}_A": ("*",) for i in range(12)},
                **{f"SSG_{i}_B": ("*",) for i in range(12)},
            }
        }

    @classmethod
    def VALIDATE_INPUTS(cls, **kwargs):
        return True

    RETURN_TYPES = tuple(["*"] * 12)
    RETURN_NAMES = tuple([f"◦" for _ in range(12)])
    FUNCTION = "route_signal_banks"
    CATEGORY = "SSG Network Logic"

    def route_signal_banks(self, router_switch, router_manifest="", schema_generation=0, **kwargs):
        channel_name = kwargs.get("channel_id", "SSG_Orphan_Router")
        active_suffix = "_A" if router_switch == "Bank A" else "_B"
        payload = [kwargs.get(f"SSG_{i}{active_suffix}", None) for i in range(12)]
        torch._ssg_piperegistry[channel_name] = payload
        return tuple(payload)


class SSGSmartVault:
    DESCRIPTION = """
Inline RAM/VRAM cache vault & upstream execution engine severer.
---
🔴 Flush ON, Cache OFF: Live stream updates tensor buffer in memory.
❄ Flush OFF, Cache OFF: Freezes cache; buffer remains static.
⚡ Cache ON: Severs upstream execution; plays back stored tensors instantly.
---
🟡 Edit Mode active / open parking dots.
🟠 Unpopulated cache in playback state.
🔴 Empty vault identifier.
"""
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "flush_switch": ("BOOLEAN", {"default": True}),
                "cache_switch": ("BOOLEAN", {"default": False}),
            },
            "hidden": {
                "vault_manifest": ("STRING", {"default": ""}),
                "schema_generation": ("INT", {"default": 0}),
                "vault_id": ("STRING", {"default": ""}),
            },
            "optional": {
                **{f"SSG_{i}": ("*",) for i in range(24)}
            }
        }

    @classmethod
    def VALIDATE_INPUTS(cls, **kwargs):
        return True

    RETURN_TYPES = tuple(["*"] * 24)
    RETURN_NAMES = tuple([f"◦" for _ in range(24)])
    FUNCTION = "manage_vault_cache"
    CATEGORY = "SSG Network Logic"

    def manage_vault_cache(self, flush_switch, cache_switch, vault_manifest="", schema_generation=0, vault_id="", **kwargs):
        channel_name = kwargs.get("channel_id", vault_id or "SSG_Vault_1")

        # Mutex enforcement: Cache ON strictly forces Flush OFF
        effective_flush = False if cache_switch else flush_switch

        # Playback Mode: Read from runtime memory vault
        if cache_switch:
            cached_data = torch._ssg_vault_registry.get(channel_name, [None] * 24)
            if len(cached_data) < 24:
                cached_data = list(cached_data) + [None] * (24 - len(cached_data))
            return tuple(cached_data[:24])

        # Live Mode: Gather inputs
        live_inputs = [kwargs.get(f"SSG_{i}", None) for i in range(24)]

        # Live Recording Buffer
        if effective_flush:
            torch._ssg_vault_registry[channel_name] = live_inputs

        return tuple(live_inputs)


class SSGSmartTag:
    DESCRIPTION = """
Inline boundary namer and wildcard dynamic type-caster.
---
Place before a transmitter to force a custom track name. Overrides upstream titles and locks ambiguous types into explicit definitions.
---
🟠 Forced data type collision.
"""
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "input": ("*",),
                "tag_name": ("STRING", {"default": "Tag_1"}),
                "type_override": (
                    ["AUTO", "*", "MODEL", "CLIP", "VAE", "LATENT", "IMAGE", "MASK", "CONDITIONING", "INT", "FLOAT", "STRING", "BOOLEAN"],
                    {"default": "AUTO"}
                ),
            }
        }

    RETURN_TYPES = ("*",)
    RETURN_NAMES = ("◦",)
    FUNCTION = "apply_tag_override"
    CATEGORY = "SSG Network Logic"

    def apply_tag_override(self, input, tag_name, type_override="AUTO"):
        return (input,)


NODE_CLASS_MAPPINGS = {
    "SSGSmartPipe": SSGSmartPipe,
    "SSGSmartSatellite": SSGSmartSatellite,
    "SSGSmartGate": SSGSmartGate,
    "SSGSmartGateRelay": SSGSmartGateRelay,
    "SSGSmartGateReturn": SSGSmartGateReturn,
    "SSGSmartRouter": SSGSmartRouter,
    "SSGSmartVault": SSGSmartVault,
    "SSGSmartTag": SSGSmartTag,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "SSGSmartPipe": "SSG Smart Pipe",
    "SSGSmartSatellite": "SSG Smart Satellite",
    "SSGSmartGate": "SSG Smart Gate",
    "SSGSmartGateRelay": "SSG Smart Gate Relay",
    "SSGSmartGateReturn": "SSG Smart Gate Return",
    "SSGSmartRouter": "SSG Smart Router",
    "SSGSmartVault": "SSG Smart Vault",
    "SSGSmartTag": "SSG Smart Tag",
}