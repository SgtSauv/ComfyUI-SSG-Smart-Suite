# SSG Smart Suite V4.0: Master Specification & System Architecture Manual

**Designation:** SSG Custom Node Ecosystem (V4.0 Nodes 2.0 Architectural Baseline)  
**Target Environments:** ComfyUI Official Frontend (`v1.52.7`) / ComfyUI Nightly (`v1.55.5`+)  
**Execution Foundation:** Python PyTorch Runtime + LiteGraph Canvas Engine

---

## 1. System Architecture & Engineering Principles

### 1.1 Architectural Compliance & Execution Boundaries
The SSG Smart Suite operates as a zero-overhead, wireless signal multiplexer and virtual memory routing layer for ComfyUI. 
* **Nodes 2.0 Native Integration:** Custom canvas DOM wrappers, monkey-patched node rendering loops, and non-standard stroke paths have been eliminated. Node outlines, slot spacing, and typography comply strictly with upstream LiteGraph standards.
* **Zero Runtime Execution Latency:** During graph compilation, wireless links are flattened into direct, point-to-point connections within the execution directed acyclic graph (DAG). With the exception of `SSGSmartVault` (which manages in-memory caching), all SSG transmitter and receiver nodes act as virtual routing logic and are completely bypassed during prompt processing.

### 1.2 Global Memory Model
State synchronization across decoupled nodes operates through isolated in-memory registries:
* **Python Runtime Space (`torch._ssg_*`):**
  * `torch._ssg_piperegistry`: Key-value store mapping channel strings to raw payload lists of up to 24 arbitrary objects.
  * `torch._ssg_vault_registry`: In-memory tensor storage preserving execution outputs across graph runs.
  * `torch._ssg_module_registry`: Internal manifests defining external companion module schemas.
* **JavaScript Canvas Space (`window.SSG_*`):**
  * `window.SSG_PipeRegistry`: Global lookup table storing channel manifests, generation counters, active broadcasting flags, and edit states.
  * `window.SSG_SocketRegistry`: Live registry tracking instantiated `SSGSmartSocket` channel IDs, active module assignments, and node references.
  * `window.SSG_ModuleRegistry`: Schema repository declaring input/output types and slot layouts for external companion modules.

### 1.3 Deterministic 4-Slot Widget Array Structure
To prevent serialization desynchronization between LiteGraph's index-based widget storage and Python's positional parameter mapping, every suite node enforces a fixed widget array hierarchy:
* **Slot 0 [Status Banner]:** `custom` widget (`name: "channel_display"`, `serialize: false`) dedicated to telemetry and diagnostic state rendering.
* **Slot 1 [Primary Action]:** `button` widget (`serialize: false`) for schema locking, bus synchronization, or track pruning.
* **Slot 2 [Channel / Mode Selector]:** `combo` widget (`name: "channel"` or `"module_select"`) for channel binding or schema assignment.
* **Slot 3+ [Hardware Toggles]:** `toggle` widget (`BOOLEAN`) serializing operational modes (`injection_loop`, `router_switch`, `flush_switch`, `cache_switch`).

### 1.4 Universal Geometric Bounding Resolution
In ComfyUI Nodes 2.0 (`v1.55.5`), CSS container padding and widget margins decouple the actual rendered visual bounding box from legacy `[node.size]` arrays.
* The halo beacon engine queries `[node.getBounding()]` on active canvas nodes.
* `[node.getBounding()]` returns true canvas coordinates `[min_x, min_y, total_width, total_height]`, preventing outline clipping on nodes containing complex widget stacks (`SSGSmartPipe`, `SSGSmartTag`, `SSGSmartVault`).
* For legacy LiteGraph environments lacking `[node.getBounding()]`, calculation falls back to `[node.pos[0], node.pos[1] - titleHeight, node.size[0], node.size[1] + titleHeight]`.

---

## 2. Graph Compilation, Flattening & Quarantine Engine

### 2.1 Graph-To-Prompt Flattening Architecture
All wireless connections are resolved prior to execution by intercepting `[app.graphToPrompt]`.
1. The canvas graph is traversed recursively via `[collectNodes]` to build a hierarchical execution map supporting nested subgraphs.
2. For each downstream node connected to an SSG consumer (`SSGSmartSatellite`, `SSGSmartGateRelay`), `[resolvePromptLinkOrigin]` traces upstream through reroutes, bridges, and subgraphs to locate the true origin node ID and slot index.
3. The downstream node's inputs are rewritten to point directly to the resolved upstream producer, eliminating the wireless nodes from the final execution payload.

### 2.2 Pre-Pass Topological Loop Quarantine
When an `SSGSmartGate` has its `[injection_loop]` toggle set to `[false]` (Bypass Mode), all loop processing must be halted to prevent unnecessary compute and VRAM allocation:
1. The bypassed gate channel name is flagged in `[bypassedGateChannels]`.
2. Associated `SSGSmartGateRelay` (`_TX`) and `SSGSmartGateReturn` (`_RX`) nodes are identified and marked for quarantine.
3. A bidirectional contagion sweep evaluates the loop sub-network:
   * **Downstream Sweep:** Traverses all output connections originating from quarantined relays across any `SSG*` nodes.
   * **Upstream Sweep:** Traverses all input connections feeding into quarantined returns across any `SSG*` nodes.
4. Any `SSGSmartSocket` encountered during the contagion sweep adds its channel ID to `[quarantinedSocketChannels]`.
5. Companion appliance modules targeting quarantined sockets (`[target_socket === quarantinedSocketChannel]`) are flagged.
6. All quarantined node IDs are excised from the prompt payload (`[delete output[qId]]`) before execution dispatch, halting dormant model loaders, detailers, and samplers.

---

## 3. Signal Sniffing & Upstream Anchor Crawling Engine

### 3.1 5-Stage Anchor Resolution Traversal
When dynamic inputs are connected in `[Edit Mode]`, `[findTrueUpstreamAnchor]` traverses backward through links to automatically identify the upstream source name and datatype:
1. **SSG Smart Tag Boundary:** If an upstream link connects to an `SSGSmartTag`, traversal terminates immediately, adopting the tag's custom text label and explicit datatype override.
2. **Custom Renamed Node Title:** If an upstream node has a user-defined title (`[node.title !== node.type]`), traversal halts and assigns that custom title as the track name.
3. **Multi-Output Signature Matching:** Standard multi-output loaders are matched against built-in slot signatures:
   * `CheckpointLoaderSimple` / `unCLIPCheckpointLoader`: Slot 0 = `MODEL`, Slot 1 = `CLIP`, Slot 2 = `VAE`.
   * Dual/Triple CLIP Loaders: Maps respective output indices to their discrete `CLIP` names.
4. **Subgraph Bridge Proxies:** When traversing across subgraphs, `GraphInput` and `SubgraphInput` bridge nodes are unpacked recursively until the root source anchor is reached.
5. **Fallback Type Reflection:** Uses the native LiteGraph output slot label; if unavailable, falls back to the declared uppercase datatype string (`MODEL`, `LATENT`, `IMAGE`, `CONDITIONING`, etc.).

### 3.2 Dynamic Pin Naming Latency Workaround
In Nodes 2.0 (`v1.52.7`), asynchronous connection events may cause the visual slot label of the final connected pin to remain an empty wildcard dot (`"◦"`) until a canvas redraw occurs. Clicking the slot once or cycling `[Lock Schema]` forces an immediate geometry sync.

---

## 4. Visual Diagnostics & Multi-Tier Telemetry Pipeline

### 4.1 Calibrated Telemetry Palette
The Slot 0 Status Banner and Command Deck HUD use standardized diagnostic colors:

| Diagnostic Tier | Hex Code | Visual State | Trigger Condition |
| :--- | :--- | :--- | :--- |
| **Tier 0: Nominal** | `#00e5ff` | Electric Cyan | Channel locked, registry synchronized, all links verified active. |
| **Tier 1: Advisory / Setup** | `#ffcc00` | Amber Yellow | Node in `[Edit Mode]`, Satellite unpruned, Socket unassigned, or generation desync. |
| **Tier 2: Critical Fault** | `#ff7700` | Fire Opal Orange | Severed loop wire, unlinked input on locked node, vacant module bay, or datatype collision. |
| **Tier 3: Execution Fault** | `#ff3333` | Crimson Red | Channel unassigned, invalid ID, or target channel `[Unavailable]`. |
| **Live Recording / Buffer** | `#b026ff` | Neon Purple | `SSGSmartVault` live caching pass active (`[flush_switch = True]`, `[cache_switch = False]`). |
| **Locked Pass-through / Frozen** | `#38bdf8` | Deep Ice Blue | `SSGSmartVault` cache retention locked against overwrites (`[flush_switch = False]`, `[cache_switch = False]`). |
| **Active Cache / Playback** | `#00ff88` | Mint Green | `SSGSmartVault` in-memory playback mode with upstream severed (`[cache_switch = True]`). |
| **Loop Bypassed** | `#555b66` | Muted Charcoal | `SSGSmartGate` injection disabled or path deactivated (`[injection_loop = False]`). |

### 4.2 Diagnostic Precedence Architecture
Node banners evaluate faults hierarchically to prevent low-priority advisories from masking critical signal failures:
1. **Bypass State Override:** If `[isBypassed === true]`, render Muted Charcoal.
2. **Tier 2 Hardware Faults (Orange):**
   * Primary input slot unlinked on a locked node.
   * Active injection return track unlinked (`[link === null]`).
   * Missing companion node in paired configurations (`[SSGSmartGateRelay]`, `[SSGSmartGateReturn]`, `[SSGSmartSocket]`).
3. **Tier 1 Schema Advisories (Yellow):**
   * Edit mode active (`[is_editing === true]`).
   * Physical slot count mismatch between transmitter and receiver (`[slots.length !== record.tracks.length]`).
   * Schema generation drift (`[bound_generation < master_generation]`).
4. **Tier 0 Base (Cyan):** Nominal signal state.

### 4.3 Vacant Bay Diagnostic Contract
If an `SSGSmartSocket` has a module schema selected (`[module_id !== null]`), but no active companion appliance targeting that socket exists on the canvas (`[target_socket !== channel_id]`), the socket escalates to **Tier 2 Fire Opal Orange** (`[Vacant Bay]`). Downstream circuits are alerted that the socket cannot produce signal tensors at runtime.

---

## 5. Node Specifications & Internal Topologies

### 5.1 SSG Smart Pipe (`SSGSmartPipe`)
Master multi-track signal broadcaster bundling arbitrary connections into a named wireless bus.
* **Input Topology:** Up to 24 dynamic inputs (`SSG_0` through `SSG_23`). Spawns with one wildcard slot (`"◦"`), automatically expanding as wires connect.
* **Output Topology:** No physical outputs.
* **Widget Allocation:**
  * Slot 0: Custom Status Banner (`CH: SSG_Pipe_N`).
  * Slot 1: `[Lock Schema]` / `[Edit Schema]` toggle button.
* **Lifecycle Mechanics:** Locking prunes unlinked slots, sets `[properties.is_locked = true]`, increments `[schema_generation]`, and registers manifest arrays into `[window.SSG_PipeRegistry]`.

### 5.2 SSG Smart Satellite (`SSGSmartSatellite`)
Multi-track bus receiver consuming arbitrary track subsets from active Pipe, Router, or Gate channels.
* **Input Topology:** No physical inputs.
* **Output Topology:** Up to 24 dynamic outputs mapped to the source channel's manifest.
* **Widget Allocation:**
  * Slot 0: Custom Status Banner (`CH: <channel>`).
  * Slot 1: `[Spawn Tracks]` / `[Prune Unused]` action button.
  * Slot 2: Channel selection combo dropdown.
* **Lifecycle Mechanics:** Clicking `[Spawn Tracks]` populates outputs based on the upstream manifest. Clicking `[Prune Unused]` deletes unconnected outputs while preserving internal track indexes (`[_trackIdx]`), preventing index misalignment during compilation.

### 5.3 SSG Smart Gate Trio (`SSGSmartGate`, `SSGSmartGateRelay`, `SSGSmartGateReturn`)
Three-node transceiver system providing hardware-bypassed injection loops for regional refinement and modular pipelines.
* **SSGSmartGate (Master Gate):**
  * Topologically sits inline on the primary pipeline.
  * Inputs: Up to 24 dynamic primary signals.
  * Outputs: Up to 24 dynamic forward signals.
  * Toggles between `[INJECT]` (routes signal through the external loop) and `[BYPASS]` (routes inputs directly to outputs and quarantines the loop).
  * Manages dual channels: `{channel_id}_TX` (outbound to loop) and `{channel_id}_RX` (inbound from loop).
* **SSGSmartGateRelay (Loop Input):**
  * Placed at the loop entry point.
  * Outputs mirror the Master Gate's input manifest and bind to `{channel_id}_TX`.
* **SSGSmartGateReturn (Loop Output):**
  * Placed at the loop exit point.
  * Inputs mirror the return tracks and bind to `{channel_id}_RX`.
  * Declared with `[OUTPUT_NODE = True]` in Python to ensure loop execution during active injection.

### 5.4 SSG Smart Router (`SSGSmartRouter`)
Dual-bank (A/B) multi-track crossbar switcher for comparing models, conditioning paths, or processing pipelines.
* **Input Topology:** Up to 12 interleaved input pairs (`SSG_0_A`/`SSG_0_B` through `SSG_11_A`/`SSG_11_B`).
* **Output Topology:** No physical outputs (broadcasts wirelessly).
* **Widget Allocation:**
  * Slot 0: Custom Status Banner (`CH: SSG_Router_N [A]` or `[B]`).
  * Slot 1: `[Lock Schema]` / `[Edit Schema]` button.
  * Slot 3: `[router_switch]` toggle (`Bank A` / `Bank B`).
* **Boolean Normalization:** Uses `[isRouterBankB]` to safely handle boolean values, strings (`"Bank B"`, `"B"`), and integer flags (`1`/`0`) during compilation.

### 5.5 SSG Smart Vault (`SSGSmartVault`)
Inline virtual memory buffer and execution severer that caches intermediate tensors in RAM/VRAM to eliminate redundant upstream computation.
* **Input/Output Topology:** Up to 24 dynamic inputs and matching outputs.
* **Widget Allocation:**
  * Slot 0: Custom Status Banner.
  * Slot 1: `[Lock Schema]` / `[Edit Schema]` button.
  * Slot 3: `[flush_switch]` toggle (`Flush On` / `Flush Off`).
  * Slot 4: `[cache_switch]` toggle (`Live Pass` / `Playback`).
* **Operational Tri-State:**
  1. **BUFFER (Live Recording):** `[flush_switch = True]`, `[cache_switch = False]`. Upstream signals execute normally and cache into `[torch._ssg_vault_registry]`.
  2. **FROZEN (Cache Retention):** `[flush_switch = False]`, `[cache_switch = False]`. Live data passes through, but the cache is protected from overwrites.
  3. **PLAYBACK (Severed Execution):** `[cache_switch = True]`. Upstream connections are excised from the prompt payload (`[delete promptNode.inputs[inputKey]]`), and cached tensors output directly from memory with zero upstream computation.

### 5.6 SSG Smart Tag (`SSGSmartTag`)
Single-slot passthrough anchor providing strict naming boundaries and explicit type overrides.
* **Input/Output Topology:** 1 Universal Input (`*`) $\rightarrow$ 1 Universal Output (`*`).
* **Widget Allocation:**
  * Slot 0: Custom Status Banner (`Tag_N : <type>`).
  * Slot 2: `[tag_name]` text string (sanitized to 16 characters).
  * Slot 3: `[type_override]` combo dropdown.
* **Datatype Overrides:** Supports `AUTO`, `*`, `MODEL`, `CLIP`, `VAE`, `LATENT`, `IMAGE`, `MASK`, `CONDITIONING`, `INT`, `FLOAT`, `STRING`, `BOOLEAN`. Flags Tier 2 Orange if the connected wire conflicts with the explicit override type.

### 5.7 SSG Smart Socket (`SSGSmartSocket`)
Universal inline transceiver that morphs its physical I/O layout to match external companion module schemas.
* **Input/Output Topology:** Dynamically configured via `[applySchemaTopology]` based on the active module's manifest.
* **Widget Allocation:**
  * Slot 0: Custom Status Banner (`SSG_Socket_N (<Module>)`).
  * Slot 2: `[module_select]` combo dropdown populated from `[window.SSG_ModuleRegistry]`.
* **Active Tenant Eviction:** When a new schema is selected via `[morphSchema]`, any existing module appliance targeting this socket is evicted: its `[target_socket]` property and widget are cleared to `"Available"`, severing background connections.

---

## 6. SSG Command Deck HUD Specification

### 6.1 HUD Core Architecture & Keybinds
The Command Deck HUD operates as an interactive telemetry and node dispensary layer, toggled via **`Alt + S`** or the floating canvas button.
* **Native ComfyUI Node IDs (`#`):** Toggled via the `#` header button. Renders verified node IDs across channel rows, drawers, and context menus (including subgraph prefixes like `89:12`). Preference persists in `[localStorage.getItem("ssg_hud_show_node_ids")]`.
* **Telemetry Bubbling:** Unresolved warnings and critical faults from Satellites, Relays, Returns, or Sockets bubble up to their parent channel row in the HUD.
* **Pin-Point Halo Beacons:** Clicking a channel row toggles canvas halos around all transmitters, receivers, and modules bound to that channel. Halos pulse at `[0.55 + Math.sin(time) * 0.25]` alpha and render corner markers aligned to `[node.getBounding()]`.

### 6.2 Zero-Plumbing Quick-Palette Dispensary
The bottom dock features instant-spawning chips for all suite node types:
* Clicking a chip instantiates the node attached to the mouse cursor using `[attachNodeToCursor]`.
* Nodes drop onto the canvas on the next mouse click.
* **Single-Pair Guard (Gates):** Master Gates enforce a single-pair rule (`canSpawnRx: !hasPair`). The HUD disables the `[RX]` button if a Relay/Return pair is already active on the canvas for that gate.

---

## 7. Migration, Upgrades & Compatibility Matrix

### 7.1 V3.5 to V4.0 Migration (Widget Desynchronization)
* **Breaking Change:** V4.0 standardizes internal widget indexing into a deterministic 4-slot structure. 
* **Impact:** Workflows saved in V3.5 or earlier will experience widget value desynchronization (e.g., boolean toggles shifted into dropdown indices).
* **Resolution:** Open saved workflows, verify toggle positions (`injection_loop`, `router_switch`, `flush_switch`, `cache_switch`), re-select dropdown channels if unassigned, and re-save the workflow.

### 7.2 Frontend Engine Compatibility Matrix

| Engine Feature | Official Frontend (`v1.52.7`) | Nightly Frontend (`v1.55.5`+) |
| :--- | :--- | :--- |
| **Halo Outlines** | Uses fallback `[node.size]` geometry. | Uses native `[node.getBounding()]` resolution. |
| **Dynamic Pin Latency** | Last connected pin requires single click to refresh name. | Resolved natively in engine core. |
| **Button Label Updates** | Falls back to static labels via `[checkDynamicButtonSupport]`. | Live dynamic label mutating supported natively. |
| **Widget Hierarchy** | Fixed 4-slot array structure enforced. | Fixed 4-slot array structure enforced. |