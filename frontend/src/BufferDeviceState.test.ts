import { describe, it, expect } from 'vitest';
import { BufferDeviceState, buildFieldMap } from './BufferDeviceState';
import SCHEMA from './__fixtures__/wire-schema.json';

const PAYLOAD_SIZE = 96;
const PIR_STATE_OFFSET = 8;
const PIR_OVERRIDE_OFFSET = 10;
const LED_CONFIGS_OFFSET = 12;
const LED_CONFIG_SIZE = 18;
const LED_STATES_OFFSET = 84;
const LED_STATE_SIZE = 3;

function createDeviceStateBuffer(): ArrayBuffer {
  const buffer = new ArrayBuffer(PAYLOAD_SIZE);
  const view = new DataView(buffer);

  view.setBigInt64(0, BigInt(1707343800000), true);
  view.setUint16(PIR_STATE_OFFSET, 0x010f, true);
  view.setUint16(PIR_OVERRIDE_OFFSET, 0x00f0, true);

  const ledConfigs = [
    {
      brightness: 1000,
      rampOnMs: 200,
      holdOnMs: 5000,
      rampOffMs: 500,
      waitOnMs: 30000,
      pirMaskOn: 0xffff,
      pirMaskOff: 0x0000,
    },
    {
      brightness: 800,
      rampOnMs: 300,
      holdOnMs: 3000,
      rampOffMs: 600,
      waitOnMs: 1000,
      pirMaskOn: 0x0102,
      pirMaskOff: 0x0002,
    },
  ];

  for (let i = 0; i < ledConfigs.length; i += 1) {
    const offset = LED_CONFIGS_OFFSET + i * LED_CONFIG_SIZE;
    const config = ledConfigs[i];
    view.setInt16(offset, config.brightness, true);
    view.setInt16(offset + 2, config.rampOnMs, true);
    view.setUint32(offset + 4, config.holdOnMs, true);
    view.setInt16(offset + 8, config.rampOffMs, true);
    view.setUint32(offset + 10, config.waitOnMs, true);
    view.setUint16(offset + 14, config.pirMaskOn, true);
    view.setUint16(offset + 16, config.pirMaskOff, true);
  }

  view.setInt16(LED_STATES_OFFSET, 500, true);
  view.setUint8(LED_STATES_OFFSET + 2, 1);
  view.setInt16(LED_STATES_OFFSET + LED_STATE_SIZE, 300, true);
  view.setUint8(LED_STATES_OFFSET + LED_STATE_SIZE + 2, 2);

  return buffer;
}

describe('BufferDeviceState', () => {
  let fieldMap: ReturnType<typeof buildFieldMap>;

  beforeEach(() => {
    fieldMap = buildFieldMap(SCHEMA);
  });

  describe('with realistic device data', () => {
    it('should decode a complete real-world device state buffer', () => {
      const buffer = createDeviceStateBuffer();
      const state = new BufferDeviceState(buffer, fieldMap);

      // Verify scalar values from fixture
      expect(state.getTimestamp()).toBe(1707343800000);
      expect(state.getPirState()).toBe(0x010f);
      expect(state.getPirOverride()).toBe(0x00f0);

      // Verify LED configs
      const config0 = state.getLedConfig(0);
      expect(config0.brightness).toBe(1000);
      expect(config0.rampOnMs).toBe(200);
      expect(config0.holdOnMs).toBe(5000);
      expect(config0.rampOffMs).toBe(500);
      expect(config0.waitOnMs).toBe(30000);
      expect(config0.pirMaskOn).toBe(0xffff);
      expect(config0.pirMaskOff).toBe(0x00);

      const config1 = state.getLedConfig(1);
      expect(config1.brightness).toBe(800);
      expect(config1.rampOnMs).toBe(300);
      expect(config1.holdOnMs).toBe(3000);

      // Verify LED states
      const ledState0 = state.getLedState(0);
      expect(ledState0.brightness).toBe(500);
      expect(ledState0.state).toBe(1);

      const ledState1 = state.getLedState(1);
      expect(ledState1.brightness).toBe(300);
      expect(ledState1.state).toBe(2);
    });

    it('should decode device state with negative brightness values', () => {
      const buffer = new ArrayBuffer(PAYLOAD_SIZE);
      const view = new DataView(buffer);

      // LED config 0
      view.setInt16(LED_CONFIGS_OFFSET, -100, true); // brightness
      view.setInt16(LED_CONFIGS_OFFSET + 2, -50, true); // rampOnMs
      view.setInt32(LED_CONFIGS_OFFSET + 4, -1000, true); // holdOnMs

      // LED state 0
      view.setInt16(LED_STATES_OFFSET, -500, true); // brightness
      view.setUint8(LED_STATES_OFFSET + 2, 0); // state

      const state = new BufferDeviceState(buffer, fieldMap);

      expect(state.getLedConfig(0).brightness).toBe(-100);
      expect(state.getLedConfig(0).rampOnMs).toBe(-50);
      expect(state.getLedState(0).brightness).toBe(-500);
    });

    it('should decode maximum unsigned/signed values', () => {
      const buffer = new ArrayBuffer(PAYLOAD_SIZE);
      const view = new DataView(buffer);

      // Timestamp with realistic large value
      view.setBigInt64(0, BigInt(1707343800000), true);
      view.setUint16(PIR_STATE_OFFSET, 65535, true); // pirState
      view.setUint16(PIR_OVERRIDE_OFFSET, 65535, true); // pirOverride

      // LED config 0 with max values
      view.setInt16(LED_CONFIGS_OFFSET, 32767, true); // brightness (max int16)
      view.setInt16(LED_CONFIGS_OFFSET + 2, 32767, true); // rampOnMs
      view.setUint32(LED_CONFIGS_OFFSET + 4, 4294967295, true); // holdOnMs (max uint32)
      view.setUint32(LED_CONFIGS_OFFSET + 10, 4294967295, true); // waitOnMs (max uint32)
      view.setUint16(LED_CONFIGS_OFFSET + 14, 65535, true); // pirMaskOn (max uint16)

      // LED state 0
      view.setInt16(LED_STATES_OFFSET, 32767, true); // brightness (max int16)
      view.setUint8(LED_STATES_OFFSET + 2, 3); // state

      const state = new BufferDeviceState(buffer, fieldMap);

      expect(state.getTimestamp()).toBe(1707343800000);
      expect(state.getPirState()).toBe(65535);
      expect(state.getLedConfig(0).brightness).toBe(32767);
      expect(state.getLedConfig(0).holdOnMs).toBe(4294967295);
      expect(state.getLedConfig(0).waitOnMs).toBe(4294967295);
      expect(state.getLedState(0).brightness).toBe(32767);
    });

    it('should correctly index all 4 LED configs', () => {
      const buffer = new ArrayBuffer(PAYLOAD_SIZE);
      const view = new DataView(buffer);

      // Write unique brightness values to each LED config for verification
      for (let i = 0; i < 4; i++) {
        const offset = LED_CONFIGS_OFFSET + i * LED_CONFIG_SIZE;
        view.setInt16(offset, (i + 1) * 100, true); // brightness
        view.setUint16(offset + 14, 0x0100 + i + 1, true); // pirMaskOn
        view.setUint16(offset + 16, 0x0100 + i + 1, true); // pirMaskOff
      }

      // Write unique brightness values to each LED state
      for (let i = 0; i < 4; i++) {
        const offset = LED_STATES_OFFSET + i * LED_STATE_SIZE;
        view.setInt16(offset, (i + 1) * 10, true); // brightness
        view.setUint8(offset + 2, i); // state
      }

      const state = new BufferDeviceState(buffer, fieldMap);

      // Each LED config should have unique values for verification
      for (let i = 0; i < 4; i++) {
        const config = state.getLedConfig(i);
        expect(config.brightness).toBe((i + 1) * 100);
        expect(config.pirMaskOn).toBe(0x0100 + i + 1);
        expect(config.pirMaskOff).toBe(0x0100 + i + 1);
      }

      // Each LED state should have unique values for verification
      for (let i = 0; i < 4; i++) {
        const ledState = state.getLedState(i);
        expect(ledState.brightness).toBe((i + 1) * 10);
        expect(ledState.state).toBe(i);
      }
    });
  });

  describe('field map structure', () => {
    it('should create a field map with correct entries', () => {
      expect(fieldMap.has('timestamp')).toBe(true);
      expect(fieldMap.has('pirState')).toBe(true);
      expect(fieldMap.has('pirOverride')).toBe(true);
      expect(fieldMap.has('ledConfigs')).toBe(true);
      expect(fieldMap.has('ledStates')).toBe(true);
    });

    it('should have correct field sizes', () => {
      expect(fieldMap.get('timestamp').size).toBe(8);
      expect(fieldMap.get('pirState').size).toBe(2);
      expect(fieldMap.get('pirOverride').size).toBe(2);
    });

    it('should have correct array metadata', () => {
      const ledConfigs = fieldMap.get('ledConfigs');
      expect(ledConfigs.arrayLen).toBe(4);
      expect(ledConfigs.size).toBe(18);

      const ledStates = fieldMap.get('ledStates');
      expect(ledStates.arrayLen).toBe(4);
      expect(ledStates.size).toBe(3);
    });

    it('should have correct field offsets', () => {
      expect(fieldMap.get('timestamp').offset).toBe(0);
      expect(fieldMap.get('pirState').offset).toBe(8);
      expect(fieldMap.get('pirOverride').offset).toBe(10);
      expect(fieldMap.get('ledConfigs').offset).toBe(12);
      expect(fieldMap.get('ledStates').offset).toBe(84);
    });

    it('should compute offsets for primitive arrays without sub-fields', () => {
      const schema = [
        { name: 'timestamp', size: 8, type: 'int' },
        { name: 'samples', arrayLen: 4, size: 2, type: 'uint' },
        { name: 'tail', size: 1, type: 'uint' },
      ];
      const map = buildFieldMap(schema);

      expect(map.get('samples')?.offset).toBe(8);
      expect(map.get('samples')?.size).toBe(2);
      expect(map.get('tail')?.offset).toBe(16);
    });
  });

  describe('error handling', () => {
    it('should throw error for missing field', () => {
      const buffer = new ArrayBuffer(100);
      const emptyFieldMap: ReturnType<typeof buildFieldMap> = new Map();

      const state = new BufferDeviceState(buffer, emptyFieldMap);

      expect(() => state.getTimestamp()).toThrow('Field timestamp not found in schema');
    });

    it('should throw error when accessing ledState with missing field', () => {
      const buffer = new ArrayBuffer(100);
      const emptyFieldMap: ReturnType<typeof buildFieldMap> = new Map();

      const state = new BufferDeviceState(buffer, emptyFieldMap);

      expect(() => state.getLedState(0)).toThrow('Field ledStates not found in schema');
    });

    it('should throw error when accessing ledConfig with missing field', () => {
      const buffer = new ArrayBuffer(100);
      const emptyFieldMap: ReturnType<typeof buildFieldMap> = new Map();

      const state = new BufferDeviceState(buffer, emptyFieldMap);

      expect(() => state.getLedConfig(0)).toThrow('Field ledConfigs not found in schema');
    });
  });

  describe('buffer operations', () => {
    it('should return the original buffer', () => {
      const buffer = createDeviceStateBuffer();
      const state = new BufferDeviceState(buffer, fieldMap);

      expect(state.getBuffer()).toBe(buffer);
    });
  });
});
