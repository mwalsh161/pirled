import { type LedConfig, type LedState } from './types';

interface SchemaField {
  name: string;
  size?: number;
  type?: string;
  arrayLen?: number;
  sub?: SchemaField[];
}

interface FieldOffset {
  offset: number;
  size: number;
  type: string;
  arrayLen?: number;
  sub?: FieldOffset[];
}

const littleEndian = true;

/**
 * Build a field offset map from a schema for O(1) field lookups.
 * This is computed once when the schema is available and reused across all buffers.
 */
export function buildFieldMap(schema: SchemaField[]): Map<string, FieldOffset> {
  const fieldMap = new Map<string, FieldOffset>();
  let offset = 0;

  for (const field of schema) {
    const subSchema = field.sub ?? [];
    const hasSubSchema = subSchema.length > 0;

    if (field.arrayLen && field.arrayLen > 0) {
      // Array field - store the base offset and array metadata
      const arrayOffset = offset;
      const elementSize = hasSubSchema ? calculateStructSize(subSchema) : field.size;
      if (elementSize === undefined) {
        throw new Error(`Array field ${field.name} missing element size`);
      }
      const elementType = hasSubSchema ? 'container' : field.type;
      if (elementType === undefined) {
        throw new Error(`Array field ${field.name} missing element type`);
      }

      const arrayField: FieldOffset = {
        offset: arrayOffset,
        size: elementSize,
        type: elementType,
        arrayLen: field.arrayLen,
      };
      if (hasSubSchema) {
        arrayField.sub = buildSubFieldMap(subSchema);
      }
      fieldMap.set(field.name, arrayField);

      offset += elementSize * field.arrayLen;
    } else if (hasSubSchema) {
      // Struct-like container field
      const structSize = calculateStructSize(subSchema);
      fieldMap.set(field.name, {
        offset,
        size: structSize,
        type: 'container',
        sub: buildSubFieldMap(subSchema),
      });
      offset += structSize;
    } else {
      if (field.size === undefined || field.type === undefined) {
        throw new Error(`Scalar field ${field.name} missing size/type`);
      }
      // Scalar field
      fieldMap.set(field.name, {
        offset,
        size: field.size,
        type: field.type,
      });

      offset += field.size;
    }
  }

  return fieldMap;
}

function buildSubFieldMap(schema: SchemaField[]): FieldOffset[] {
  const result: FieldOffset[] = [];
  let offset = 0;
  
  for (const field of schema) {
    if (field.size === undefined || field.type === undefined) {
      throw new Error(`Sub-field ${field.name} missing size/type`);
    }
    result.push({
      offset,
      size: field.size,
      type: field.type,
    });
    offset += field.size;
  }

  return result;
}

function calculateStructSize(schema: SchemaField[]): number {
  return schema.reduce((sum, field) => {
    if (field.size === undefined) {
      throw new Error(`Sub-field ${field.name} missing size`);
    }
    return sum + field.size;
  }, 0);
}

function readUint(dataView: DataView, offset: number, size: number): number {
  switch (size) {
    case 1:
      return dataView.getUint8(offset);
    case 2:
      return dataView.getUint16(offset, littleEndian);
    case 4:
      return dataView.getUint32(offset, littleEndian);
    default:
      throw new Error(`Unsupported uint size: ${size}`);
  }
}

function readInt(dataView: DataView, offset: number, size: number): number {
  switch (size) {
    case 1:
      return dataView.getInt8(offset);
    case 2:
      return dataView.getInt16(offset, littleEndian);
    case 4:
      return dataView.getInt32(offset, littleEndian);
    case 8:
      return Number(dataView.getBigInt64(offset, littleEndian));
    default:
      throw new Error(`Unsupported int size: ${size}`);
  }
}

function readValue(dataView: DataView, offset: number, size: number, type: string): number {
  if (type === 'int') {
    return readInt(dataView, offset, size);
  } else {
    return readUint(dataView, offset, size);
  }
}

function readSubField(dataView: DataView, elementOffset: number, field: FieldOffset): number {
  return readValue(dataView, elementOffset + field.offset, field.size, field.type);
}

function getRequiredSubField(subFields: FieldOffset[], index: number, fieldName: string): FieldOffset {
  const subField = subFields[index];
  if (!subField) {
    throw new Error(`Missing sub-field ${index} for ${fieldName}`);
  }
  return subField;
}

function toLedMachineState(value: number): LedState['state'] {
  if (value === 1 || value === 2 || value === 3) {
    return value;
  }
  return 0;
}

/**
 * BufferDeviceState wraps a binary buffer and provides efficient accessor methods
 * to read fields without re-parsing the entire buffer every access.
 */
export class BufferDeviceState {
  private buffer: ArrayBuffer;
  private dataView: DataView;
  private fieldMap: Map<string, FieldOffset>;

  constructor(buffer: ArrayBuffer, fieldMap: Map<string, FieldOffset>) {
    this.buffer = buffer;
    this.dataView = new DataView(buffer);
    this.fieldMap = fieldMap;
  }

  getPirState(): number {
    const field = this.fieldMap.get('pirState');
    if (!field) throw new Error('Field pirState not found in schema');
    return readValue(this.dataView, field.offset, field.size, field.type);
  }

  getPirOverride(): number {
    const field = this.fieldMap.get('pirOverride');
    if (!field) throw new Error('Field pirOverride not found in schema');
    return readValue(this.dataView, field.offset, field.size, field.type);
  }

  getTimestamp(): number {
    const field = this.fieldMap.get('timestamp');
    if (!field) throw new Error('Field timestamp not found in schema');
    return readValue(this.dataView, field.offset, field.size, field.type);
  }

  getLedState(index: number): LedState {
    const field = this.fieldMap.get('ledStates');
    if (!field || !field.sub) throw new Error('Field ledStates not found in schema');
    
    const elementOffset = field.offset + index * field.size;
    const brightnessField = getRequiredSubField(field.sub, 0, 'ledStates');
    const stateField = getRequiredSubField(field.sub, 1, 'ledStates');
    
    return {
      brightness: readSubField(this.dataView, elementOffset, brightnessField),
      state: toLedMachineState(readSubField(this.dataView, elementOffset, stateField)),
    };
  }

  getLedConfig(index: number): LedConfig {
    const field = this.fieldMap.get('ledConfigs');
    if (!field || !field.sub) throw new Error('Field ledConfigs not found in schema');
    
    const elementOffset = field.offset + index * field.size;
    const brightnessField = getRequiredSubField(field.sub, 0, 'ledConfigs');
    const rampOnField = getRequiredSubField(field.sub, 1, 'ledConfigs');
    const holdOnField = getRequiredSubField(field.sub, 2, 'ledConfigs');
    const rampOffField = getRequiredSubField(field.sub, 3, 'ledConfigs');
    const waitOnField = getRequiredSubField(field.sub, 4, 'ledConfigs');
    const pirMaskOnField = getRequiredSubField(field.sub, 5, 'ledConfigs');
    const pirMaskOffField = getRequiredSubField(field.sub, 6, 'ledConfigs');
    
    return {
      brightness: readSubField(this.dataView, elementOffset, brightnessField),
      rampOnMs: readSubField(this.dataView, elementOffset, rampOnField),
      holdOnMs: readSubField(this.dataView, elementOffset, holdOnField),
      rampOffMs: readSubField(this.dataView, elementOffset, rampOffField),
      waitOnMs: readSubField(this.dataView, elementOffset, waitOnField),
      pirMaskOn: readSubField(this.dataView, elementOffset, pirMaskOnField),
      pirMaskOff: readSubField(this.dataView, elementOffset, pirMaskOffField),
    };
  }

  getBuffer(): ArrayBuffer {
    return this.buffer;
  }
}
