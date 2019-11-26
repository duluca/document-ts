[![CircleCI](https://circleci.com/gh/duluca/DocumentTS.svg?style=svg)](https://circleci.com/gh/duluca/DocumentTS)
[![DeepScan grade](https://deepscan.io/api/teams/1906/projects/4995/branches/38924/badge/grade.svg)](https://deepscan.io/dashboard#view=project&tid=1906&pid=4995&bid=38924)
[![Coverage Status](https://coveralls.io/repos/github/duluca/DocumentTS/badge.svg?branch=master)](https://coveralls.io/github/duluca/DocumentTS?branch=master)

# DocumentTS 4

A very thin TypeScript-based MongoDB helper with optional, rich ODM (Object Document Mapper) convenience features

> Check out the sample full-stack project [Minimal MEAN](https://github.com/excellalabs/minimal-mean)

> Check out my book _Angular 6 for Enterprise-Ready Web Applications_. Get it on http://AngularForEnterprise.com.

> Looking to containerize MongoDB? Checkout [excellalabs/mongo](https://github.com/excellalabs/mongo-docker) for a fully featured Mongo container (with Auth & SSL) inherited from the official Mongo Docker image and instructions on [how to deploy it on AWS](https://gist.github.com/duluca/ebcf98923f733a1fdb6682f111b1a832#file-awc-ecs-access-to-aws-efs-md).

## Quick Start

> Supports MongoDB v4+, Mongo Driver 3.3+ and TypeScript 3.7+

- Add DocumentTS to your project with `npm install document-ts mongodb`
- Connect to your Mongo database using `connect()`
- Connect will retry connecting to the database 10 times every 2 seconds
  - Set `connectionRetryWait` (in seconds) and `connectionRetryMax` to modify this behavior
- Specify `isProd` and `certFileUri` to connect using an SSL certificate

```js
import { connect } from 'document-ts'

async function start() {
  // If isProd is set to true and a .pem file is provided, SSL will be used to connect: i.e. connect(config.mongoUri, isProd, 'server/compose-ca.pem')
  await connect(process.env.MONGO_URI)
}

start()
```

- If you use `connect()` then you don't have to worry about having your Database Instance initialized during an asynchoronous start up sequence. `getDbInstance` gives you access to the native MongoDB driver to perform custom functions like creating indexes.

```js
import { getDbInstance } from 'document-ts'

// assuming this is called within an async function
await dbInstance.collection('users').createIndexes([
  {
    key: {
      displayName: 1,
    },
  },
  {
    key: {
      email: 1,
    },
    unique: true,
  },
])
```

- Define the interface for your first model
  > See `tests\user.ts` for sample Model implementation

```js
import { IDocument } from 'document-ts'

export interface IUser extends IDocument {
  email: string;
  firstName: string;
  lastName: string;
  role: string;
}
```

- Define the class for your model
  > See `tests\user.ts` for sample Model implementation

```js
import { Document } from 'document-ts'

export class User extends Document<IUser> implements IUser {
  static collectionName = 'users'

  private password: string

  public email: string
  public firstName: string
  public lastName: string
  public role: string

  constructor(user?: IUser) {
    super(User.collectionName, user)
  }
  ...
}
```

- Implement `getCalculatedPropertiesToInclude()` which will ensure that your `get` properties that are "calculate" on the fly will be serialized when sending the model down to the client, but it will **not** be saved in the database.

```js
  getCalculatedPropertiesToInclude(): string[]{
      return ['fullName']
  }
```

- Implement `getPropertiesToExclude()` which will ensure that certain properties like passwords will **not** be serialized when sending the model down to the client, but it will still be saved in the database.

```js
  getPropertiesToExclude(): string[]{
      return ['password']
  }
```

- Implement the `CollectionFactory` class, so that you can run Mongo queries without having to call `getDbInstance` or specify the collection and TypeScript type name every time you run a query. CollectionFactory provides convenience functions like `find`, `findOne`, `findOneAndUpdate`, `findWithPagination` and similar, while also handling `hydration` tasks, such as serializing getters and child documents.

```js
import { CollectionFactory } from 'document-ts'

class UserCollectionFactory extends CollectionFactory<User> {
  constructor(docType: typeof User) {
    super(User.collectionName, docType, ['firstName', 'lastName', 'email'])
  }
}

export let UserCollection = new UserCollectionFactory(User)
```

- `CollectionFactory` is powerful and flexible. In your custom class, you can implement MongoDB aggregate queries to run advance join-like queries, geo queries and whatever MongoDB supports. `findWithPagination` itself is very powerful and will enable you to implement paginated dashboards with easse.

- `findWithPagination` leverage query parameters for pagination and configuration

```js
export interface IQueryParameters {
  filter?: string
  skip?: number
  limit?: number
  sortKeyOrList?: string | Object[] | Object
  projectionKeyOrList?: string | Object[] | Object
}
```

- Optionally implement `toJSON()` to customize serialization/hydration behavior or extend `ISerializable`

```js
  toJSON() {
    let keys = Object.keys(this).concat(['fullAddress', 'localAddress'])
    return Serialize(SerializationStrategy.JSON, this, keys)
  }
```

- Optionally implement `toBSON()` to customize database serialization behavior or extend `ISerializable`

```
  toBSON() {
    let keys = Object.keys(this).concat(['fullAddress', 'localAddress'])
    return Serialize(SerializationStrategy.BSON, this, keys)
  }
```

- To debug the default serialization behavior, implement

```js
  toJSON() {
    // drop a breakpoint here or console.log(this)
    return super.toJSON()
  }

  toBSON() {
    return super.toBSON()
  }
```

See the Minimal MEAN sample project for usage - https://github.com/excellalabs/minimal-mean

## Features

- `connect()`
  _MongoDB async connection harness_
  It can be a challenge to ensure that database connectivity exists, when writing an fully async web application. `connect()` makes it easy to connect to a MongoDB instance and makes it safe to be called simultanously from multiple threads starting up at the same time.
- `Document` and `IDocument`
  _Base Class and Interface to help define your own models_
  ...

## Goals

- Reliable
  - Rely on the rock-solid Native Node.js MongoDB drivers
  - Don't inject custom code into DB calls without explicit intent by the developer
  - Don't hide new MongoDB features, so you don't have to wait DocumentTS to be updated before you can use them
- Optional
  - Stays out of the way, so developers can slowly transition
  - If performance becomes a concern easily switch to native MongoDB calls for the best performance
- Async
  - Ensure developers can write simpler and more reliable code by surfaceing promises and async/await features
- Convienient
  - Developers define their own models through simple Interfaces
  - Choose fields that you want to automatically hydrate, such as child or related objects
  - Serialize calculated fields with every request
  - Protect certain fields (like passwords) from serialization, so they aren't accidently sent across the wire
- Promote Good Patterns
  - Suggest/enable easy to understand and implement patters for developers, so their code can scale and remain organized
- Prevent Bloat
  - Leverage TypeScript types, interfaces, generics and inheritance to achieve development-time certainty of proper database access
  - Keep the code smart, readable and lean
  - Be very selective about any new features

## What It Isn't

Not a full-fledged ODM or ORM replacement and doesn't aspire to be one like Mongoose or Camo. Databases are HARD. MongoDB took many years to mature, Microsoft has been trying for a really long time to build a reliable ORM with Entity Framework, Mongoose and many other ODMs are ridden with bugs (no offense) when you push them beyond the basics. It takes great resources to deliver a solid data access experience, so with DocumentTS you can developer directly against MongoDB while enjoying some conveniences as you choose.

## Inspirations

Although DocumentTS doesn't aspire to replace Mongoose or Camo, it most definitely is inspired by them in the way they've solved certain problems such as hydration. Check out the source code for those projects here:

- Mongoose
- [Camo](https://github.com/scottwrobinson/camo)

## Building This Project

- Run `npm install`
- Run `npm test`

### Maintainers

- **[Kenton Bocock](https://github.com/kentonbmax)**
