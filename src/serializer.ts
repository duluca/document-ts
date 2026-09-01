import { Binary, Decimal128, Long, ObjectId } from 'mongodb'

export interface ISerializable {
  toJSON(): object
  toBSON(): object
}

export enum SerializationStrategy {
  JSON = 'toJSON',
  BSON = 'toBSON',
}

export function Serialize(
  strategy: SerializationStrategy,
  document: ISerializable,
  keys?: string[]
): object {
  if (!keys) {
    return serializeValue(strategy, document) as object
  }

  const serializationTarget: Record<string, unknown> = {}
  for (const key of new Set(keys)) {
    defineEnumerableProperty(
      serializationTarget,
      key,
      serializeValue(strategy, Reflect.get(document, key))
    )
  }
  return serializationTarget
}

function isBsonNative(value: object): boolean {
  return (
    value instanceof Date ||
    value instanceof ObjectId ||
    value instanceof Decimal128 ||
    value instanceof Long ||
    value instanceof Binary
  )
}

function serializeValue(strategy: SerializationStrategy, value: unknown): unknown {
  if (value === null || typeof value !== 'object') {
    return value
  }

  if (strategy === SerializationStrategy.BSON && isBsonNative(value)) {
    return value
  }

  const strategyFunction: unknown = Reflect.get(value, strategy)
  if (typeof strategyFunction === 'function') {
    return Reflect.apply(strategyFunction, value, [])
  }

  if (Array.isArray(value)) {
    return value.map((item) => serializeValue(strategy, item))
  }

  const target: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value)) {
    defineEnumerableProperty(target, key, serializeValue(strategy, child))
  }
  return target
}

function defineEnumerableProperty(
  target: Record<string, unknown>,
  key: string,
  value: unknown
): void {
  Object.defineProperty(target, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  })
}
