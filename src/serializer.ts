/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
export interface ISerializable extends Object {
  toJSON(): object
  toBSON(): object
  [index: string]: any
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
  const strategyFunc = strategy.toString()
  if (!keys && document && typeof document[strategyFunc] === 'function') {
    return document[strategyFunc]()
  } else if (!keys) {
    return {}
  }
  keys = Array.from(new Set(keys))
  const serializationTarget: { [index: string]: any } = {}
  for (const key of keys) {
    const child = document[key]

    if (child && typeof child[strategyFunc] === 'function') {
      serializationTarget[key] = child[strategyFunc]()
    } else if (Array.isArray(child)) {
      if (child.length > 0) {
        serializationTarget[key] = []
        for (const cc of child) {
          if (typeof cc === 'object') {
            serializationTarget[key].push(Serialize(strategy, cc as ISerializable))
          } else {
            serializationTarget[key].push(cc)
          }
        }
      }
    } else {
      serializationTarget[key] = child
    }
  }
  return serializationTarget
}
