# Precision 5820 (Xeon W-2235) performance tuning — analysis plan

**Status:** blocked on environment network policy + BIOS dump. Resume from "What I need to resume".
**Last updated:** 2026-08-09

## Context

Goal: tune the 5820 for **single-thread responsiveness / UI latency** and **GPU compute & render**, covering **BIOS + Windows + hardware**. This is the machine that builds and runs `widget-panel` (Qt panel via `native/qt-panel/build.ps1`, Electron/Vite renderer), so the repo's own build doubles as a benchmark.

Two constraints shape the approach:

1. **The BIOS cannot be read from a Claude Code session.** Sessions run in an ephemeral Linux container holding a clone of this repo, with no path to the workstation. Every current value has to come from a dump produced on the machine itself.
2. **Vendor documentation is unreachable from the container** (see "Blocked on" below). So no BIOS option names get invented — the authoritative list of what the BIOS actually exposes is the `cctk` dump.

Confirmed hardware baseline: **Xeon W-2235** — Cascade Lake-W, 6C/12T, 3.8 GHz base, **4.6 GHz max single-core turbo**, 130 W TDP, quad-channel **DDR4-2933**, LGA-2066. **4×16 GB = 64 GB**, i.e. 1 DIMM per channel — the ideal population for latency, provided the four modules sit in the correct four slots.

## Phase 1 — Capture the baseline (run on the 5820)

**BIOS dump.** Install Dell Command | Configure, then from an *elevated* prompt in `C:\Program Files (x86)\Dell\Command Configure\X86_64`:

```
cctk.exe -o=C:\temp\bios-current.ini
```

If that syntax is rejected, run `cctk.exe --help` and capture the export usage line — the syntax above is unverified against Dell's CLI reference. The GUI equivalent is **Dell Command | Configure → EXPORT CONFIG → .ini**. The export must be *complete*, not filtered.

**System state** (PowerShell, elevated):

```powershell
Get-CimInstance Win32_Processor | fl Name,MaxClockSpeed,NumberOfCores,NumberOfLogicalProcessors
Get-CimInstance Win32_PhysicalMemory | ft DeviceLocator,Speed,ConfiguredClockSpeed,Capacity,Manufacturer,PartNumber
Get-CimInstance Win32_BIOS | fl SMBIOSBIOSVersion,ReleaseDate
powercfg /getactivescheme
Get-CimInstance -ClassName Win32_DeviceGuard -Namespace root\Microsoft\Windows\DeviceGuard | fl *Status*
nvidia-smi -q > C:\temp\nvidia.txt
```

`ConfiguredClockSpeed` is the one that matters — it shows whether the kit actually runs at 2933 or has been pinned to 2666.

**Benchmarks — record before changing anything.** Three numbers, matched to the two goals:

- *Single-thread*: Cinebench R23 single-core (10 min) — the headline UI-latency proxy.
- *Build wall-clock*: a clean `native/qt-panel/build.ps1` run, timed. Real-world, repo-native, mixed ST/MT.
- *GPU*: `nvidia-smi --query-gpu=clocks.sm,temperature.gpu,power.draw --format=csv -l 1` logged during a 10-minute sustained load, plus whatever render/CUDA job represents the actual work.

Run each **twice** and keep the second number. Without this, "faster" is unfalsifiable.

## Phase 2 — Analysis

Diff the dump against a recommendation matrix and produce a table: **setting → current → recommended → expected effect → risk → exact rollback**. Nothing is recommended because it sounds fast; anything not justifiable for these two goals is explicitly marked "leave alone."

Expected direction for a W-2235, subject to what the dump shows:

| Area | Expected direction | Why it matters here |
|---|---|---|
| SpeedStep + C-States + Turbo | **All three ON** | The 4.6 GHz single-core bin is only reachable when other cores can drop into deep C-states. Disabling C-states — the classic "performance" tweak — *costs* top-end single-thread clock. Likely the highest-value correction. |
| Speed Shift / HWP (if exposed) | **Enable** | Hardware-managed P-states ramp in ~1 ms vs ~30 ms for OS-managed. Directly the UI-latency lever. |
| Hyper-Threading | **Leave ON** | 6 cores is already few; disabling HT for "latency" costs render/CUDA throughput and buys nothing measurable for UI. |
| Memory speed | **Verify 2933, not 2666** | A 2933 kit silently running 2666 is ~10 % memory bandwidth gone. |
| Above 4G Decoding / Resizable BAR | **Enable** if present | Required for large-BAR CUDA; helps viewport throughput. |
| PCIe ASPM | **Disable L0s/L1** | Link power states add wake latency to every GPU and NVMe transaction. |
| SATA Operation (RAID On → AHCI) | **Only with the documented procedure** | Real NVMe latency win, but flipping this on a running Windows install causes an unbootable INACCESSIBLE_BOOT_DEVICE unless the driver is staged first (safe-boot method). High value, high blast radius — its own step, its own rollback. |
| VT-d / VBS | **User's call, stated plainly** | Windows Memory Integrity (HVCI) costs measurable single-thread performance. Turning it off is a real security downgrade — quantify the trade-off, do not disable quietly. |
| Fan control override | **Consider** | More airflow → longer sustained turbo under render load. Costs noise. |
| Fastboot / POST behavior | **Leave** | Boot time only. No runtime effect — flagged so it doesn't eat attention. |

## Phase 3 — Apply in tranches, measure between each

1. **Tranche A (zero-risk BIOS)** — clock/power/memory settings above. Re-run the three benchmarks.
2. **Tranche B (Windows)** — power plan (Ultimate Performance), processor boost mode, core parking, NVIDIA "Prefer maximum performance" + PCIe link state off, HAGS, and the VBS decision. Re-measure.
3. **Tranche C (high-risk BIOS)** — SATA/RAID→AHCI if applicable, with the staged-driver procedure written out step by step beforehand. Re-measure.
4. **Tranche D (hardware notes)** — DIMM slot verification for true quad-channel, NVMe slot choice (CPU-attached PCIe adapter vs PCH-attached M.2 sharing DMI bandwidth), GPU slot and PSU headroom, cooling/airflow for sustained 130 W. Recommendations only; anything costing money clearly marked.

Each tranche is separately revertible, and any change that doesn't show up in the numbers gets reverted rather than kept on faith.

## Deliverable

A tuning document — `docs/workstation/precision-5820-tuning.md` — containing the settings table, the applied/rejected log with before/after numbers, and rollback steps.

## Verification

- Effective clocks under load via HWiNFO64 (watch *effective* clock, not requested clock) — confirm sustained all-core and 4.6 GHz single-core peaks.
- `ConfiguredClockSpeed` = 2933 across all four DIMMs.
- The three Phase 1 benchmarks re-run after each tranche; a change is kept only if it moves a number.
- Live sanity check via the panel itself — `renderer/widgets/workstation/workstation.service.js` polls CPU/GPU usage, temperature, power and clocks once a second through `WorkstationClient`, so the panel doubles as the monitoring dashboard while a tranche is under test.

## Blocked on: environment network policy

The session container has **no general outbound web access** — the org egress gateway answers 403 to CONNECT for every documentation host probed (`www.dell.com`, `dl.dell.com`, `downloads.dell.com`, `www.intel.com`, `ark.intel.com`, `learn.microsoft.com`, `developer.nvidia.com`, and even `en.wikipedia.org`). Web search still works, since it runs service-side rather than from the container, but it returns paraphrase rather than the manual's option tables.

**Decision: fix the policy before continuing.**

Allowlist on the environment (claude.ai/code → environment settings; see
https://code.claude.com/docs/en/claude-code-on-the-web):

```
www.dell.com          # 5820 Owner's Manual, BIOS setup option tables
dl.dell.com           # Dell Command | Configure User's Guide + CLI Reference (PDF)
downloads.dell.com    # BIOS releases / version history
www.intel.com         # W-2235 datasheet
ark.intel.com         # W-2235 spec sheet
```

Optional but useful for the Windows and GPU tranches: `learn.microsoft.com`, `developer.nvidia.com`.

Network policy is a property of the **environment**, not the session, so it takes effect in a **new session**; it does not open an already-running container retroactively.

## What I need to resume (next session)

1. **`bios-current.ini`** plus the Phase 1 command output — required regardless of doc access. The dump enumerates every option the specific BIOS revision exposes, with current values; no manual substitutes for it.
2. Confirmation the allowlist is live (or the two Dell PDFs committed to the repo as a fallback).

With both in hand, Phase 2 starts immediately.
