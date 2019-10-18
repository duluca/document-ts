export interface ISerializable {
  toJSON(): Object
  toBSON(): Object
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
): Object {
  var strategyFunc = strategy.toString()
  if (!keys && document && typeof document[strategyFunc] === 'function') {
    return document[strategyFunc]()
  } else if (!keys) {
    return {}
  }
  keys = Array.from(new Set(keys))
  let serializationTarget: { [index: string]: any } = {}
  for (let key of keys) {
    let child = document[key]

    if (child && typeof child[strategyFunc] === 'function') {
      serializationTarget[key] = child[strategyFunc]()
    } else if (Array.isArray(child)) {
      serializationTarget[key] = []
      for (let cc of child) {
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
