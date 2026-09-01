import { describe, expect, test } from '@jest/globals'

import {
  Binary,
  BSON,
  Decimal128,
  Document as MongoDocument,
  Long,
  ObjectId,
} from 'mongodb'

import { ISerializable, SerializationStrategy, Serialize } from '../src/index'
import { Color } from './color'

class SerializationFixture implements ISerializable {
  constructor(
    public mixed: unknown[],
    public empty: unknown[] = []
  ) {}

  toJSON(): object {
    return Serialize(SerializationStrategy.JSON, this, ['mixed', 'empty'])
  }

  toBSON(): object {
    return Serialize(SerializationStrategy.BSON, this, ['mixed', 'empty'])
  }
}

describe('Serialize', () => {
  test('uses a serializable value strategy when keys are omitted', () => {
    const child = new Color('blue', 0.25)

    expect(Serialize(SerializationStrategy.JSON, child)).toEqual({
      hue: 'blue',
      alpha: 0.25,
    })
    expect(
      Serialize(SerializationStrategy.JSON, {
        toJSON: undefined,
        toBSON: undefined,
        plain: { nested: true },
      } as unknown as ISerializable)
    ).toEqual({
      toJSON: undefined,
      toBSON: undefined,
      plain: { nested: true },
    })
  })

  test('preserves a mixed nested array in JSON and BSON', () => {
    const date = new Date('2024-01-02T03:04:05.000Z')
    const objectId = new ObjectId('64b64c6f0000000000000001')
    const decimal = Decimal128.fromString('123.45')
    const long = Long.fromString('9007199254740993')
    const binary = new Binary(Buffer.from([1, 2, 3]))
    const child = new Color('red', 0.5)
    const fixture = new SerializationFixture([
      7,
      'value',
      null,
      {
        plain: true,
        nested: [date, objectId, decimal, long, binary],
      },
      [false, { depth: 2 }],
      child,
      date,
      objectId,
      decimal,
      long,
      binary,
    ])

    expect(fixture.toJSON()).toEqual({
      mixed: [
        7,
        'value',
        null,
        {
          plain: true,
          nested: [
            date.toJSON(),
            objectId.toJSON(),
            decimal.toJSON(),
            { low: 1, high: 2097152, unsigned: false },
            binary.toJSON(),
          ],
        },
        [false, { depth: 2 }],
        { hue: 'red', alpha: 0.5 },
        date.toJSON(),
        objectId.toJSON(),
        decimal.toJSON(),
        { low: 1, high: 2097152, unsigned: false },
        binary.toJSON(),
      ],
      empty: [],
    })

    const bsonOutput = fixture.toBSON() as {
      empty: unknown[]
      mixed: unknown[]
    }
    expect(bsonOutput.empty).toEqual([])
    expect(bsonOutput.mixed[5]).toEqual({ hue: 'red', alpha: 0.5 })
    expect(bsonOutput.mixed[6]).toBe(date)
    expect(bsonOutput.mixed[7]).toBe(objectId)
    expect(bsonOutput.mixed[8]).toBe(decimal)
    expect(bsonOutput.mixed[9]).toBe(long)
    expect(bsonOutput.mixed[10]).toBe(binary)

    const roundTrip = BSON.deserialize(BSON.serialize(bsonOutput as MongoDocument), {
      promoteLongs: false,
    }) as unknown as { empty: unknown[]; mixed: unknown[] }
    const nested = (roundTrip.mixed[3] as { nested: unknown[] }).nested
    expect(roundTrip.empty).toEqual([])
    expect(nested[0]).toBeInstanceOf(Date)
    expect(nested[1]).toBeInstanceOf(ObjectId)
    expect(nested[2]).toBeInstanceOf(Decimal128)
    expect(nested[3]).toBeInstanceOf(Long)
    expect(nested[4]).toBeInstanceOf(Binary)
    expect((roundTrip.mixed[6] as Date).toISOString()).toBe(date.toISOString())
    expect((roundTrip.mixed[7] as ObjectId).equals(objectId)).toBe(true)
    expect((roundTrip.mixed[8] as Decimal128).toString()).toBe(decimal.toString())
    expect((roundTrip.mixed[9] as Long).equals(long)).toBe(true)
    expect((roundTrip.mixed[10] as Binary).value()).toEqual(binary.value())
  })
})
