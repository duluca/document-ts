import { uniq as _uniq } from 'lodash'

export interface ISerializable {
  toJSON(): Object
  toBSON(): Object
  [index: string]: any
}

export enum serializationStrategy {
  toJSON,
  toBSON,
}

export function serialize(
  strategy: serializationStrategy,
  document: ISerializable,
  keys?: string[]
): Object {
  var strategyFunc = strategy.toString()
  if (!keys && document && typeof document[strategyFunc] === 'function') {
    return document[strategyFunc]()
  } else if (!keys) {
    return {}
  }
  keys = _uniq(keys)
  let serializationTarget: { [index: string]: any } = {}
  for (let key of keys) {
    let child = document[key]

    if (child && typeof child[strategyFunc] === 'function') {
      serializationTarget[key] = child[strategyFunc]()
    } else if (Array.isArray(child)) {
      serializationTarget[key] = []
      for (let cc of child) {
        if (typeof cc === 'object') {
          serializationTarget[key].push(serialize(strategy, cc))
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
