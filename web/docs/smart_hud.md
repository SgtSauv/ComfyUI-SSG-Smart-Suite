# SSG Command Deck & Smart HUD Manual

The **SSG Command Deck & Smart HUD** is the centralized operations terminal for the SSG Custom Node Ecosystem. It provides real-time canvas telemetry, wireless channel inspection, dynamic diagnostics, instant node dispensaries, and viewport navigation across both the root canvas and nested subgraphs.

> For execution models, topological loop quarantine, or PyTorch tensor buffer details, consult the **[SSG Smart Suite README](docs/README.md)** and the **[SSG Master System Architecture Manual](docs/manual.md)**.

---

## 1. Access & Deck Activation

* **Hot-Key Toggle:** Press **Alt + S** anywhere on the canvas to open or close the Command Deck HUD.
* **Canvas Button:** Click the floating **SSG HUD** button anchored at the top-right of the viewport.
* **Smart Visibility Guard:** The HUD interface and its toggle button automatically mount only when at least one active `SSG*` node exists on the canvas. If all SSG nodes are removed, the HUD quietly unmounts to keep your workspace clean.
* **Draggable Frame:** Click and drag the header title bar (**SSG COMMAND DECK**) to relocate the HUD anywhere across your workspace.

---

## 2. Header Controls & Telemetry Toggles

The top control tray exposes global deck utilities:

* **# (Toggle Native Node IDs):** Toggles ComfyUI native graph node IDs across all HUD titles, receiver drawers, and context teleport menus (supports scoped subgraph syntax like `#89:12`). Persists across browser restarts via local storage.
* **? (Documentation Deck):** Opens the offline modal containing this HUD guide, the complete suite README, the master architecture manual, and any installed Smart Module appliance documentation.
* **× (Close Deck):** Collapses the HUD frame.
* **Filter & Search Bar:** Real-time search input filtering channels, custom node titles, assigned module types, and raw channel IDs.

---

## 3. Node Roster & Functional Reference

The HUD continuously tracks and dispenses these 9 foundational suite nodes:

| Node Designation | Functional Summary | Primary HUD Interaction |
| :--- | :--- | :--- |
| **SSG Smart Pipe** (`SSGSmartPipe`) | Master broadcaster multiplexing up to 24 arbitrary lanes (`MODEL`, `LATENT`, `VAE`, etc.) into a named wireless bus. | Rename channel, lock/unlock schema, monitor receiver health, spawn bound Satellites. |
| **SSG Smart Satellite** (`SSGSmartSatellite`) | Downstream receiver extracting signal subsets from Pipes, Routers, or Gates with unlinked slot pruning. | Teleport camera to receiver; setup and schema warnings bubble up to parent rows. |
| **SSG Smart Router** (`SSGSmartRouter`) | A/B crossbar switcher comparing models or conditioning stacks across paired inputs (`A0/B0` to `A11/B11`). | Instant state toggle (`BANK A` ↔ `BANK B`), schema locking, spawn bound Satellites. |
| **SSG Smart Gate** (`SSGSmartGate`) | Inline valve managing loop injection (`_TX`/`_RX`) with pre-pass execution quarantine. | Instant state toggle (`INJECT` ↔ `BYPASS`), schema locking, spawn Relay/Return pair. |
| **SSG Smart Gate Relay** (`SSGSmartGateRelay`) | Dedicated loop entry receiver capturing `{Channel}_TX` signals directly from the master gate. | Teleport focus, slot-mismatch alerts, single-pair spawn enforcement. |
| **SSG Smart Gate Return** (`SSGSmartGateReturn`) | Dedicated loop terminal capturing `{Channel}_RX` signals and piping them back to the master pipeline. | Teleport focus, broken return wire alerts, single-pair spawn enforcement. |
| **SSG Smart Vault** (`SSGSmartVault`) | Inline tensor buffer and execution severer eliminating redundant upstream re-computation. | Tri-state operational cycling (`BUFFER` ➔ `FROZEN` ➔ `PLAYBACK`), schema locking. |
| **SSG Smart Socket** (`SSGSmartSocket`) | Universal inline transceiver morphing its I/O layout to host zero-wire Smart Module appliances. | Vacant bay escalation, active tenant eviction, spawn companion module appliance. |
| **SSG Smart Tag** (`SSGSmartTag`) | Single-slot passthrough anchor establishing hard naming boundaries and explicit type overrides. | Label editing, datatype override configuration, collision warning telemetry. |

---

## 4. Interaction Contracts & Operating Procedures

### Single-Click: Canvas Halo Beacons
Clicking anywhere on a channel row toggles an active, pulsating canvas beacon around every transmitter, receiver, and companion module assigned to that channel:
* Resolves true visual coordinates via `node.getBounding()` on modern engines, eliminating clipped outlines on dense widget stacks.
* Highlights container nodes with dashed halo boundaries if the targeted receiver is nested inside a collapsed Subgraph (`⚡ [SUBGRAPH LINK]`).
* Clicking the row a second time extinguishes the halo.

### Double-Click: Inline Node Renaming
Double-clicking a channel row opens an instant rename prompt:
* Accepts up to 16 characters for clean HUD rendering.
* Updates the node's canvas title and internal custom title property in real time.
* For **SSG Smart Tag** nodes, double-clicking edits the broadcast tag name directly.

### Right-Click: Unified Context Command Deck
Right-clicking any channel row opens a contextual command deck:
* **Rename Node:** Opens the 16-character renaming interface.
* **Lock / Edit Schema:** Toggles schema editing states without needing to locate the node on the canvas.
* **Spawn Receiver / Module:** Direct spawner command matching the channel state.
* **Focus Master Node:** Teleports and centers the canvas camera directly onto the primary transmitter.
* **Focus Receiver [#ID]:** Direct camera jump to any downstream Satellite, Relay, or Return tied to the channel.
* **Datatype (Tags Only):** Inline dropdown menu to change datatype overrides (`AUTO`, `WILDCARD`, `MODEL`, `CLIP`, `VAE`, `LATENT`, `IMAGE`, `CONDITIONING`, etc.) on the fly.

### Drawer Expansion (▶ Chevron)
Clicking the chevron arrow on the right side of a row expands the track manifest drawer:
* Lists every active pin name registered to the bus (truncated to 24 characters).
* Displays live warnings (such as `⚠ Schema Unlocked`, `⚠ Affiliates Desync`, or `✖ Return Loop Missing Wire`).

---

## 5. Visual Diagnostics & Multi-Tier Telemetry

The Command Deck acts as an onboard flight recorder. Channel rows continuously audit downstream receivers, unlinked wires, and missing pair components, bubbling alerts up to the HUD using standardized diagnostic tiers:

| Visual State | Hex Code | Meaning & Underlying Trigger Condition | Recommended Resolution |
| :--- | :--- | :--- | :--- |
| **Tier 0: Nominal** | `#00e5ff` | **Nominal.** Channel is locked, synchronized, and active. | No action required. Workflow ready for queue. |
| **Tier 1: Advisory** | `#ffcc00` | **Setup / Edit State.** Node has an unlocked schema, an unpruned Satellite, or generation drift (`v_sat < v_master`). | Prune unused slots on Satellite, or click `[Lock Schema]` on transmitter. |
| **Tier 2: Fault** | `#ff7700` | **Signal Failure.** Active injection loop wire missing, vacant socket bay, unlinked router input, or tag type mismatch. | Check drawer warning; wire missing inputs, attach missing companion module, or fix datatype collision. |
| **Tier 3: Blocker** | `#ff3333` | **Critical Error.** Transmitter has no channel assigned or an invalid channel identifier. | Assign a valid channel string in Slot 2. |
| **Mint Green** | `#00ff88` | **Playback Mode.** `SSGSmartVault` is outputting cached tensors from memory with upstream execution completely severed. | Normal cache state. Set `cache_switch = False` to return to live passthrough. |
| **Deep Ice Blue** | `#38bdf8` | **Frozen Buffer.** `SSGSmartVault` buffer memory is locked against upstream overwrites. | Normal cache state. Set `flush_switch = True` to resume live buffer recording. |
| **Neon Purple** | `#b026ff` | **Buffer Active.** `SSGSmartVault` is actively passing live signals while updating in-memory tensor cache. | Normal caching state. |
| **Muted Charcoal** | `#555b66` | **Bypass Mode.** `SSGSmartGate` is bypassing loop signals internally. Downstream loop nodes are quarantined from execution. | Click state badge to toggle back to `INJECT` when loop processing is desired. |

---

## 6. Zero-Plumbing Quick-Palette Dispensary

Anchored at the bottom of the HUD, the **Node Dispensary** allows instant node creation without searching context menus:

* Click any node chip on the bottom dock (**Pipe, Satellite, Router, Gate, Relay, Return, Socket, Vault, Tag**).
* The unassigned node instantiates immediately and attaches directly to your mouse cursor.
* Move your mouse anywhere on the canvas and click once to place the node.

---

## 7. Contextual Zero-Friction Spawners (`[RX]` & `[MOD]`)

Located on individual channel rows, contextual action buttons eliminate manual configuration:

* **`[RX]` (Pipes & Routers):** Spawns an unpruned `SSGSmartSatellite` directly under your cursor, pre-bound to that exact channel name and generation manifest. Move and click to place.
* **`[RX]` (Gates - Single Pair Guard):** Spawns a pre-bound, synchronized `SSGSmartGateRelay` and `SSGSmartGateReturn` pair side-by-side attached to your cursor. Once a Relay/Return pair exists on the canvas for a Gate, the `[RX]` button disables to prevent broken multi-point injection loops.
* **`[MOD]` (Sockets - 1:1 Tenant Guard):** Spawns the exact companion appliance module configured in the socket's schema selector, pre-bound to that socket's bay. If a companion module is already active on the canvas, the button disables to prevent duplicate tenant collisions.

---

## 8. Summary of Key Operational Tips

* **Clearing Ghost Links:** Swapping a module schema on an active `SSGSmartSocket` automatically purges and evicts previous companion appliances, setting their target to `"Available"`.
* **Dynamic Pin Naming Latency:** If connecting a final input wire leaves the slot label blank (`"◦"`), click the slot once or lock the schema to force the engine to refresh the label.
* **Quarantine Verification:** Setting an `SSGSmartGate` to `BYPASS` automatically excises all downstream companion appliances and loop nodes from prompt compilation, saving compute and VRAM.