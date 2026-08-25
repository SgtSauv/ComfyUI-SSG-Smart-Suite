# SSG Smart Suite for ComfyUI (V2 Architecture)

**Clean Workflows. Zero Wiring Sprawl. Instant Memory Caching.**

An 8-core custom node ecosystem engineered to eliminate canvas wire clutter, provide reliable multi-lane wireless distribution, enable instant A/B testing, and deliver true in-memory RAM/VRAM tensor caching that severs upstream execution.

> *"We build tools that fix the engine; we do not repaint the chassis."*

---

## ⚡ Key Architecture Features

* **Zero-Latency Prompt Flattening:** Wireless receivers (Satellites, Relays, Returns) resolve directly to upstream physical origins during graph-to-prompt compilation. To ComfyUI's backend execution engine, all connections execute with the zero-overhead latency of native direct wires.
* **Auto-Naming & Type Sniffing:** Connecting any wire to an SSG broadcaster automatically resolves slot labels and detects data types (MODEL, CLIP, VAE, LATENT, IMAGE, CONDITIONING, etc.) recursively across reroutes and nested subgraphs.
* **Passive Warning Telemetry:** Real-time chassis outlines provide visual feedback on synchronization and routing state without UI popup interruptions or unwanted canvas resets.
* **Compact Mini-Bar HUD:** Collapsing nodes into mini-bar form automatically streamlines header titles and enables a high-contrast Alienware Blue status tooltip displaying live channel IDs, track counts, and operating modes.

---

## 📦 Installation

### Method 1: Git Clone (Manual)

1. Open a terminal / command prompt inside your ComfyUI custom nodes directory:
cd ComfyUI/custom_nodes

2. Clone this repository:
git clone https://github.com/sgtsauv-maker/ComfyUI-SSG-Smart-Suite.git

3. Restart ComfyUI.

---

## 🛠 Node Roster & Core Functions

### 1. SSG Smart Pipe (Master Broadcaster)
*The Universal Multi-Track Transmitter*

Bundles up to 24 arbitrary signal lanes (models, prompts, masks, conditionings) into a single named wireless broadcast channel.

**How to Use:**
1. Drop a Smart Pipe onto your canvas. It spawns in [ Edit Mode ] with dynamic parking dot pins (◦).
2. Connect your upstream signals. Pins expand dynamically, auto-naming and typing themselves.
3. Click [ Lock Schema ] to prune trailing empty pins, freeze the layout, and register the channel to the network.

---

### 2. SSG Smart Satellite (Wireless Receiver Bus)
*The Clean Consumer*

Wireless receiver bus that taps into any active Pipe, Gate, Router, or Vault broadcast channel.

**How to Use:**
1. Select an active channel from the channel dropdown.
2. Click [ Spawn Tracks ] to populate all registered output pins.
3. Connect the desired signals to your downstream workflow.
4. Click [ Prune Unused ] to collapse unwired pins into a compact, static footprint.

---

### 3. SSG Smart Gate Trio (Subgraph Injection Loop)
*Inline Processing & Refinement Loops*

Route a main pipeline through a modular subgraph, detailer loop, or refinement pass without back-and-forth canvas sprawl.

* **SSG Smart Gate (Master Valve):**
  * **Injection OFF (Bypass):** Signals pass directly from inputs to outputs with zero loop overhead.
  * **Injection ON:** Routes signals out through {Channel}_TX, awaits refined results from {Channel}_RX, and outputs the processed signals downstream.
* **SSG Smart Gate Relay (Loop Start):** Placed at the entry point of your loop. Select {Channel}_TX and click [ Sync Tracks ] to receive incoming signals.
* **SSG Smart Gate Return (Loop End):** Placed at the exit point of your loop. Select {Channel}_RX, click [ Sync Tracks ], and connect finished loop outputs to feed them back to the master Gate.

---

### 4. SSG Smart Router (Instant A/B Crossbar)
*High-Speed Model & Pipeline Switcher*

Connect two complete sets of models, prompts, or latent stacks (Bank A and Bank B) into a single switcher node.

**How to Use:**
1. Wire your primary setup into the A input slots and your alternative setup into the B input slots.
2. Click [ Lock Schema ] to publish the channel.
3. Bind downstream Satellites to the Router channel.
4. Toggle the router_switch between Bank A and Bank B to swap upstream feeds across your entire workflow without reconnecting wires or breaking downstream links.

---

### 5. SSG Smart Vault (In-Memory Cache & Engine Severer)
*Freeze, Cache, & Skip Upstream Computation*

Saves tensors directly into host RAM/VRAM memory buffers so you don't have to re-compute heavy upstream pipelines during prompt iteration, inpainting, or detail passes.

**Tri-State Caching Engine:**
* 🔴 **Live Recording (Flush ON, Cache OFF):** Passes signals live while continuously updating in-memory tensor buffers on every run.
* ❄ **Frozen Buffer (Flush OFF, Cache OFF):** Holds stored data statically in memory while continuing to pass live upstream signals through.
* ⚡ **Instant Playback (Cache ON):** **Completely severs upstream execution dependencies.** ComfyUI skips heavy upstream loaders and samplers entirely, outputting cached tensors directly from memory.

---

### 6. SSG Smart Tag (Boundary Namer & Type Normalizer)
*Custom Labels & Explicit Type Override*

Inline 1-in / 1-out helper node placed upstream of transmitters or routes.

**How to Use:**
* Enter a custom label into tag_name to override default node titles across downstream auto-namers.
* Set type_override to lock an ambiguous wildcard (*) to an explicit type definition (e.g., MODEL, CLIP, VAE, LATENT, IMAGE, CONDITIONING).

---

## 🚦 Telemetry & Diagnostic Outline Guide

| Border Color | Diagnostic Status | Meaning / Trigger Criteria | Corrective Action |
| :--- | :--- | :--- | :--- |
| **Default Chassis** | **Tier 0: Nominal** | Locked, synchronized, and ready for execution. | None required. |
| **Yellow** (#ffcc00) | **Tier 1: Advisory** | Node in Edit Mode with open parking dots, or Satellite pending pruning. | Click [ Lock Schema ] on transmitters or [ Prune Unused ] on Satellites. |
| **Orange** (#ff7700) | **Tier 2: Desync** | Broken locked wire, data type collision, or upstream channel schema updated. | Reconnect broken wires or click [ Sync Tracks ] on Relays/Returns. |
| **Red** (#ff3333) | **Tier 3: Fault** | Missing channel identifier or target channel offline. | Select a valid broadcast channel from the dropdown. |

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
