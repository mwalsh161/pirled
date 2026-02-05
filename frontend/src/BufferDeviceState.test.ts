import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { BufferDeviceState, buildFieldMap } from './BufferDeviceState';
import SCHEMA from './__fixtures__/wire-schema.json';

/**
 * Load binary fixture file for realistic device state testing
 */
function loadFixture(filename: string): ArrayBuffer {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const fixturePath = join(__dirname, '__fixtures__', filename);
  const buffer = readFileSync(fixturePath);
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

describe('BufferDeviceState', () => {
  let fieldMap: ReturnType<typeof buildFieldMap>;

  beforeEach(() => {
    fieldMap = buildFieldMap(SCHEMA);
  });

  describe('with realistic device data', () => {
    it('should decode a complete real-world device state from binary fixture', () => {
      const buffer = loadFixture('device-state.bin');
      const state = new BufferDeviceState(buffer, fieldMap);

      // Verify scalar values from fixture
      expect(state.getTimestamp()).toBe(1707343800000);
      expect(state.getPirState()).toBe(0x0f);
      expect(state.getPirOverride()).toBe(0x00);

      // Verify LED configs
      const config0 = state.getLedConfig(0);
      expect(config0.brightness).toBe(1000);
      expect(config0.rampOnMs).toBe(200);
      expect(config0.holdOnMs).toBe(5000);
      expect(config0.rampOffMs).toBe(500);
      expect(config0.waitOnMs).toBe(30000);
      expect(config0.pirMaskOn).toBe(0xff);
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
      const buffer = new ArrayBuffer(86);
      const view = new DataView(buffer);

      // Offset 10: LED config 0
      view.setInt16(10, -100, true); // brightness
      view.setInt16(12, -50, true); // rampOnMs
      view.setInt32(14, -1000, true); // holdOnMs

      // Offset 74: LED state 0
      view.setInt16(74, -500, true); // brightness
      view.setUint8(76, 0); // state

      const state = new BufferDeviceState(buffer, fieldMap);

      expect(state.getLedConfig(0).brightness).toBe(-100);
      expect(state.getLedConfig(0).rampOnMs).toBe(-50);
      expect(state.getLedState(0).brightness).toBe(-500);
    });

    it('should decode maximum unsigned/signed values', () => {
      const buffer = new ArrayBuffer(86);
      const view = new DataView(buffer);

      // Timestamp with realistic large value
      view.setBigInt64(0, BigInt(1707343800000), true);
      view.setUint8(8, 255); // pirState
      view.setUint8(9, 255); // pirOverride

      // LED config 0 at offset 10 with max values
      view.setInt16(10, 32767, true); // brightness (max int16)
      view.setInt16(12, 32767, true); // rampOnMs
      view.setUint32(14, 4294967295, true); // holdOnMs (max uint32)
      view.setUint32(20, 4294967295, true); // waitOnMs (max uint32)
      view.setUint8(24, 255); // pirMaskOn (max uint8)

      // LED state 0 at offset 74
      view.setInt16(74, 32767, true); // brightness (max int16)
      view.setUint8(76, 3); // state

      const state = new BufferDeviceState(buffer, fieldMap);

      expect(state.getTimestamp()).toBe(1707343800000);
      expect(state.getPirState()).toBe(255);
      expect(state.getLedConfig(0).brightness).toBe(32767);
      expect(state.getLedConfig(0).holdOnMs).toBe(4294967295);
      expect(state.getLedConfig(0).waitOnMs).toBe(4294967295);
      expect(state.getLedState(0).brightness).toBe(32767);
    });

    it('should correctly index all 4 LED configs', () => {
      const buffer = new ArrayBuffer(86);
      const view = new DataView(buffer);

      // Write unique brightness values to each LED config for verification
      for (let i = 0; i < 4; i++) {
        const offset = 10 + i * 16;
        view.setInt16(offset, (i + 1) * 100, true); // brightness
        view.setUint8(offset + 14, i + 1); // pirMaskOn
        view.setUint8(offset + 15, i + 1); // pirMaskOff
      }

      // Write unique brightness values to each LED state
      for (let i = 0; i < 4; i++) {
        const offset = 74 + i * 3;
        view.setInt16(offset, (i + 1) * 10, true); // brightness
        view.setUint8(offset + 2, i); // state
      }

      const state = new BufferDeviceState(buffer, fieldMap);

      // Each LED config should have unique values for verification
      for (let i = 0; i < 4; i++) {
        const config = state.getLedConfig(i);
        expect(config.brightness).toBe((i + 1) * 100);
        expect(config.pirMaskOn).toBe(i + 1);
        expect(config.pirMaskOff).toBe(i + 1);
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
      expect(fieldMap.get('pirState').size).toBe(1);
      expect(fieldMap.get('pirOverride').size).toBe(1);
    });

    it('should have correct array metadata', () => {
      const ledConfigs = fieldMap.get('ledConfigs');
      expect(ledConfigs.arrayLen).toBe(4);
      expect(ledConfigs.size).toBe(16);

      const ledStates = fieldMap.get('ledStates');
      expect(ledStates.arrayLen).toBe(4);
      expect(ledStates.size).toBe(3);
    });

    it('should have correct field offsets', () => {
      expect(fieldMap.get('timestamp').offset).toBe(0);
      expect(fieldMap.get('pirState').offset).toBe(8);
      expect(fieldMap.get('pirOverride').offset).toBe(9);
      expect(fieldMap.get('ledConfigs').offset).toBe(10);
      expect(fieldMap.get('ledStates').offset).toBe(74);
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
      const buffer = loadFixture('device-state.bin');
      const state = new BufferDeviceState(buffer, fieldMap);

      expect(state.getBuffer()).toBe(buffer);
    });
  });
});
