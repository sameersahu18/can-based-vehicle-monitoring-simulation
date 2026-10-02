# CAN-Based Vehicle Monitoring Simulation

A browser-based prototype that demonstrates how vehicle sensor data can flow through simulated electronic control units (ECUs) over a CAN-style message bus. Built with plain HTML, CSS, and vanilla JavaScript; no frameworks or build step are required.

## Features

- Virtual sensors produce changing RPM, road speed, coolant temperature, battery voltage, oil pressure, and engine load readings.
- An `EngineECU` converts the readings into a seven-byte hexadecimal payload and publishes it on simulated CAN ID `0x101` once per second.
- An `InstrumentClusterECU` subscribes to `0x101`, decodes the payload, and updates the live dashboard.
- A `DiagnosticECU` independently subscribes to the same messages, checks thresholds, and reports simulated diagnostic trouble codes:
  - Coolant temperature above 105 °C: **P0217 — Engine Overheating**
  - Oil pressure below 1.0 bar: **P0524 — Low Oil Pressure**
  - Battery voltage below 12.0 V: **P0562 — Low Battery Voltage**
- Fault injection controls simulate overheat, low oil pressure, and low battery conditions. Each selection immediately sends a CAN message so the dashboard and diagnostics react without waiting for the next timer tick.
- A CAN monitor shows recent frames and retains at most 50 log entries.

## Run locally

1. Download or clone this repository.
2. Open `index.html` in a modern browser.

No package installation or server is required. The Google Fonts import is optional; the page uses system-font fallbacks when offline.

## Simulated payload layout

The standard 11-bit CAN identifier is `0x101`. Its seven-byte payload is encoded in this order:

| Bytes | Signal | Encoding |
| --- | --- | --- |
| 0–1 | Engine RPM | Unsigned 16-bit, big-endian, RPM |
| 2 | Vehicle speed | Unsigned byte, km/h rounded to an integer |
| 3 | Coolant temperature | Unsigned byte, °C rounded to an integer |
| 4 | Battery voltage | Unsigned byte, volts × 10 |
| 5 | Oil pressure | Unsigned byte, bar × 10 |
| 6 | Engine load | Unsigned byte, percent rounded to an integer |

Example: `05 DC 3C 5A 8A 20 2D` represents 1500 rpm, 60 km/h, 90 °C, 13.8 V, 3.2 bar, and 45% load.

## Scope

This project is a software simulation. It does not connect to a physical vehicle, CAN controller, or OBD-II adapter. The frame layout and DTC behavior are illustrative and are not a substitute for a vehicle-specific protocol implementation.
