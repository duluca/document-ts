# DocumentTS
A very thin TypeScript based MongoDB helper with optional, rich ODM (Object Document Mapper) convenience features

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

## Quick Start
Coming soon

## Features
Coming soon
