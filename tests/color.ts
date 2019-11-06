import { ISerializable, SerializationStrategy, Serialize } from '../lib'

export interface IColor {
  hue: string
  alpha: number
}

export class Color implements IColor, ISerializable {
  constructor(public hue = '', public alpha = 0) {}

  static Build(color?: IColor) {
    if (color) {
      return new Color(color.hue, color.alpha)
    }
    return undefined
  }

  toJSON(): object {
    const keys = Object.keys(this)
    return Serialize(SerializationStrategy.JSON, this, keys)
  }
  toBSON(): object {
    const keys = Object.keys(this)
    return Serialize(SerializationStrategy.BSON, this, keys)
  }
}
