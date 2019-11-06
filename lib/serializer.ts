export interface ISerializable {
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
      serializationTarget[key] = []
      for (const cc of child) {
        if (typeof cc === 'object') {
          serializationTarget[key].push(Serialize(strategy, cc))
        } else {
          serializationTarget[key].push(cc)
        }
      }
    } else {
      serializationTarget[key] = child
    }
  }
  return serializationTarget
}
