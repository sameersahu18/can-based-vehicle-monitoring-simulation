class VirtualSensors {
  constructor() {
    this.data = {
      rpm: 1500,
      speed: 60,
      coolantTemperature: 90,
      batteryVoltage: 13.8,
      oilPressure: 3.2,
      engineLoad: 45
    };
    this.variation = {
      rpm: 50,
      speed: 2,
      coolantTemperature: 1,
      batteryVoltage: 0.1,
      oilPressure: 0.1,
      engineLoad: 2
    };
    this.faultMode = 'NORMAL';
    this.intervalId = null;
  }

  fluctuate(base, range, decimals = 0) {
    return Number((base + (Math.random() * 2 - 1) * range).toFixed(decimals));
  }

  read() {
    return { ...this.data };
  }

  setFaultMode(mode) {
    const supportedModes = ['NORMAL', 'OVERHEAT', 'LOW_OIL', 'LOW_BATTERY'];
    if (!supportedModes.includes(mode)) {
      throw new RangeError(`Unsupported fault mode: ${mode}`);
    }
    this.faultMode = mode;
    this.refreshData();
  }

  refreshData() {
    const nextData = {
      rpm: this.fluctuate(1500, this.variation.rpm),
      speed: this.fluctuate(60, this.variation.speed, 1),
      coolantTemperature: this.fluctuate(90, this.variation.coolantTemperature, 1),
      batteryVoltage: this.fluctuate(13.8, this.variation.batteryVoltage, 2),
      oilPressure: this.fluctuate(3.2, this.variation.oilPressure, 2),
      engineLoad: this.fluctuate(45, this.variation.engineLoad, 1)
    };

    if (this.faultMode === 'OVERHEAT') {
      nextData.coolantTemperature = this.fluctuate(115, 0.5, 1);
    } else if (this.faultMode === 'LOW_OIL') {
      nextData.oilPressure = this.fluctuate(0.5, 0.05, 2);
    } else if (this.faultMode === 'LOW_BATTERY') {
      nextData.batteryVoltage = this.fluctuate(11.2, 0.05, 2);
    }

    this.data = nextData;
  }

  start(intervalMs = 1000) {
    if (this.intervalId !== null) return;
    this.refreshData();
    this.intervalId = window.setInterval(() => this.refreshData(), intervalMs);
  }

  stop() {
    if (this.intervalId === null) return;
    window.clearInterval(this.intervalId);
    this.intervalId = null;
  }
}

class CANBus {
  constructor(logElement, maxLogLines = 50) {
    this.subscribers = new Map();
    this.logElement = logElement;
    this.maxLogLines = maxLogLines;
    this.logLines = [];
  }

  subscribe(id, callback) {
    const normalizedId = this.normalizeId(id);
    if (!this.subscribers.has(normalizedId)) this.subscribers.set(normalizedId, new Set());
    this.subscribers.get(normalizedId).add(callback);
    return () => this.subscribers.get(normalizedId)?.delete(callback);
  }

  publish(id, data) {
    const normalizedId = this.normalizeId(id);
    const payload = Array.isArray(data) ? data.map((byte) => this.normalizeByte(byte)) : [];
    const message = { id: normalizedId, data: payload, timestamp: new Date() };
    this.logMessage(message);

    for (const callback of this.subscribers.get(normalizedId) ?? []) {
      callback({ ...message, data: [...payload] });
    }
  }

  normalizeId(id) {
    const numericId = typeof id === 'string' ? Number.parseInt(id, 16) : id;
    if (!Number.isInteger(numericId) || numericId < 0 || numericId > 0x7ff) {
      throw new RangeError('CAN identifier must be an 11-bit standard identifier.');
    }
    return numericId;
  }

  normalizeByte(byte) {
    const numericByte = typeof byte === 'string' ? Number.parseInt(byte.replace(/^0x/i, ''), 16) : byte;
    if (!Number.isInteger(numericByte) || numericByte < 0 || numericByte > 0xff) {
      throw new RangeError('CAN payload entries must be bytes from 0x00 to 0xFF.');
    }
    return numericByte.toString(16).toUpperCase().padStart(2, '0');
  }

  logMessage({ id, data, timestamp }) {
    if (!this.logElement) return;

    const time = timestamp.toLocaleTimeString('en-GB', { hour12: false });
    const idText = `0x${id.toString(16).toUpperCase().padStart(3, '0')}`;
    const dataText = data.map((byte) => `0x${byte}`).join(' ');
    this.logLines.push({ time, idText, dataText });
    if (this.logLines.length > this.maxLogLines) {
      this.logLines.splice(0, this.logLines.length - this.maxLogLines);
    }

    const fragment = document.createDocumentFragment();
    for (const line of this.logLines) {
      const row = document.createElement('div');
      row.className = 'can-line';

      const timeNode = document.createElement('span');
      timeNode.className = 'can-line-time';
      timeNode.textContent = `[${line.time}] `;
      const idNode = document.createElement('span');
      idNode.className = 'can-line-id';
      idNode.textContent = `ID: ${line.idText}`;
      const dataNode = document.createElement('span');
      dataNode.className = 'can-line-data';
      dataNode.textContent = ` | DATA: ${line.dataText}`;

      row.append(timeNode, idNode, dataNode);
      fragment.append(row);
    }
    this.logElement.replaceChildren(fragment);
    this.logElement.scrollTop = this.logElement.scrollHeight;
  }
}

class EngineECU {
  constructor(sensors, canBus, intervalMs = 1000) {
    this.sensors = sensors;
    this.canBus = canBus;
    this.intervalMs = intervalMs;
    this.intervalId = null;
  }

  encodePowertrain(data) {
    // RPM uses two bytes; remaining signals use one scaled byte each (7 bytes total).
    const rpm = Math.round(data.rpm);
    const speed = Math.round(data.speed);
    const coolantTemperature = Math.round(data.coolantTemperature);
    const batteryVoltage = Math.round(data.batteryVoltage * 10);
    const oilPressure = Math.round(data.oilPressure * 10);
    const engineLoad = Math.round(data.engineLoad);

    return [
      (rpm >> 8) & 0xff,
      rpm & 0xff,
      speed,
      coolantTemperature,
      batteryVoltage,
      oilPressure,
      engineLoad
    ].map((byte) => byte.toString(16).toUpperCase().padStart(2, '0'));
  }

  transmit() {
    const sensorData = this.sensors.read();
    const payload = this.encodePowertrain(sensorData);
    this.canBus.publish(0x101, payload);
  }

  start() {
    if (this.intervalId !== null) return;
    this.sensors.start(this.intervalMs);
    this.transmit();
    this.intervalId = window.setInterval(() => this.transmit(), this.intervalMs);
  }

  stop() {
    if (this.intervalId === null) return;
    window.clearInterval(this.intervalId);
    this.intervalId = null;
    this.sensors.stop();
  }
}

class InstrumentClusterECU {
  constructor(canBus) {
    this.canBus = canBus;
    this.elements = {
      rpm: document.getElementById('engine-rpm'),
      speed: document.getElementById('vehicle-speed'),
      coolantTemperature: document.getElementById('coolant-temperature'),
      batteryVoltage: document.getElementById('battery-voltage'),
      oilPressure: document.getElementById('oil-pressure'),
      engineLoad: document.getElementById('engine-load')
    };
    this.unsubscribe = this.canBus.subscribe(0x101, (message) => this.receive(message));
  }

  decodePowertrain(payload) {
    if (!Array.isArray(payload) || payload.length < 7) return null;
    const bytes = payload.map((byte) => Number.parseInt(String(byte).replace(/^0x/i, ''), 16));
    if (bytes.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 0xff)) return null;
    return {
      rpm: (bytes[0] << 8) | bytes[1],
      speed: bytes[2],
      coolantTemperature: bytes[3],
      batteryVoltage: bytes[4] / 10,
      oilPressure: bytes[5] / 10,
      engineLoad: bytes[6]
    };
  }

  receive(message) {
    const data = this.decodePowertrain(message.data);
    if (!data) {
      console.warn('InstrumentClusterECU received an invalid powertrain payload.');
      return;
    }
    if (Object.values(this.elements).some((element) => !element)) {
      console.error('InstrumentClusterECU could not find one or more metric elements.');
      return;
    }

    this.elements.rpm.textContent = data.rpm.toLocaleString();
    this.elements.speed.textContent = data.speed.toFixed(0);
    this.elements.coolantTemperature.textContent = data.coolantTemperature.toFixed(0);
    this.elements.batteryVoltage.textContent = data.batteryVoltage.toFixed(1);
    this.elements.oilPressure.textContent = data.oilPressure.toFixed(1);
    this.elements.engineLoad.textContent = data.engineLoad.toFixed(0);
  }
}

class DiagnosticECU {
  constructor(canBus) {
    this.canBus = canBus;
    this.panel = document.getElementById('diagnostic-panel');
    this.icon = this.panel?.querySelector('.diagnostic-icon');
    this.title = document.getElementById('diagnostic-title');
    this.details = document.getElementById('diagnostic-details');
    this.state = document.getElementById('diagnostic-state');
    this.unsubscribe = this.canBus.subscribe(0x101, (message) => this.receive(message));
  }

  decodePowertrain(payload) {
    if (!Array.isArray(payload) || payload.length < 7) return null;
    const bytes = payload.map((byte) => Number.parseInt(String(byte).replace(/^0x/i, ''), 16));
    if (bytes.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 0xff)) return null;
    return {
      rpm: (bytes[0] << 8) | bytes[1],
      speed: bytes[2],
      coolantTemperature: bytes[3],
      batteryVoltage: bytes[4] / 10,
      oilPressure: bytes[5] / 10,
      engineLoad: bytes[6]
    };
  }

  findFaults(data) {
    const faults = [];
    if (data.coolantTemperature > 105) {
      faults.push({ dtc: 'P0217', name: 'Engine Overheating', reading: `${data.coolantTemperature} °C` });
    }
    if (data.oilPressure < 1.0) {
      faults.push({ dtc: 'P0524', name: 'Low Oil Pressure', reading: `${data.oilPressure.toFixed(1)} bar` });
    }
    if (data.batteryVoltage < 12.0) {
      faults.push({ dtc: 'P0562', name: 'Low Battery Voltage', reading: `${data.batteryVoltage.toFixed(1)} V` });
    }
    return faults;
  }

  receive(message) {
    const data = this.decodePowertrain(message.data);
    if (!data) {
      console.warn('DiagnosticECU received an invalid powertrain payload.');
      return;
    }

    const faults = this.findFaults(data);
    if (!this.panel || !this.icon || !this.title || !this.details || !this.state) return;

    const isFault = faults.length > 0;
    this.panel.classList.toggle('is-fault', isFault);
    this.panel.classList.toggle('is-normal', !isFault);
    this.icon.textContent = isFault ? '⚠' : '✓';
    this.title.textContent = isFault ? 'Diagnostic Alert' : 'System Normal';
    this.state.textContent = isFault
      ? `${faults.length} ACTIVE FAULT${faults.length === 1 ? '' : 'S'}`
      : 'ALL SYSTEMS NOMINAL';

    if (!isFault) {
      this.details.textContent = 'No active diagnostic trouble codes.';
      return;
    }

    const fragment = document.createDocumentFragment();
    for (const fault of faults) {
      const row = document.createElement('span');
      row.className = 'diagnostic-fault';
      row.textContent = `${fault.name} — DTC ${fault.dtc} (reading: ${fault.reading})`;
      fragment.append(row);
    }
    this.details.replaceChildren(fragment);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const sensors = new VirtualSensors();
  const canBus = new CANBus(document.getElementById('can-log'), 50);
  const instrumentCluster = new InstrumentClusterECU(canBus);
  const diagnosticECU = new DiagnosticECU(canBus);
  const engineECU = new EngineECU(sensors, canBus, 1000);

  const controlButtons = document.querySelectorAll('[data-fault-mode]');
  for (const button of controlButtons) {
    button.addEventListener('click', () => {
      const mode = button.dataset.faultMode;
      sensors.setFaultMode(mode);
      for (const control of controlButtons) {
        const selected = control === button;
        control.classList.toggle('is-selected', selected);
        control.setAttribute('aria-pressed', String(selected));
      }
      // Publish immediately so the cluster and diagnostics respond to the selected mode.
      engineECU.transmit();
    });
  }

  // Keep ECU references reachable for interactive inspection in the browser console.
  window.vehicleSimulation = { sensors, canBus, engineECU, instrumentCluster, diagnosticECU };
  engineECU.start();
});
