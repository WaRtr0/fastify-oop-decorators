# Fastify OOP Decorators

**A lightweight Object-Oriented Programming (OOP) decorator ecosystem built specifically for Fastify v5.**

`fastify-oop-decorators` is a Fastify plugin that brings a robust, modular, and decorator-based architecture (heavily inspired by Spring Boot, Angular, and NestJS) straight into your Fastify applications.

Unlike other frameworks that use heavy adapters to support multiple HTTP servers, this library is **built exclusively for Fastify**. This means zero abstraction overhead and 100% compatibility with the native Fastify ecosystem.

---

## Why use this library?

* **Fastify Ecosystem First:** You are not locked into a massive, restrictive framework. This is just a Fastify plugin. You maintain full access to standard Fastify plugins (like `@fastify/cors`, `@fastify/jwt`, etc.) without jumping through hoops.
* **Better Performance:** Because there is no multi-framework abstraction layer (like you would find with NestJS's FastifyAdapter), it runs exceptionally fast. Early benchmarks show a **~25% performance boost** on simple routes (without DTOs) and a **~20% boost** with validation, compared to traditional heavy frameworks. *(Detailed benchmarks coming soon).*
* **Lightning-Fast Validation:** Say goodbye to the heavy `class-validator`. We natively leverage Fastify's highly optimized JSON schemas (powered by AJV) to validate requests and responses at blazing speeds.

---

## Complementary Library: AJV-Decorators

To push optimization even further while maintaining an excellent Developer Experience (DX), I highly recommend using **[AJV-Decorators](https://github.com/WaRtr0/ajv-decorators)** alongside this library.

It allows you to build your DTOs using classes and decorators (just like `class-validator`), but under the hood, it generates native JSON schemas for AJV. 

**The result?** You get clean, OOP-style code without the performance penalty of `class-validator`, fully benefiting from AJV's speed—which is the fastest validator out there according to their [own benchmarks](https://ajv.js.org/guide/why-ajv.html#super-fast-secure).

---

## Installation

```bash
npm install fastify-oop-decorators reflect-metadata fastify
# or
pnpm add fastify-oop-decorators reflect-metadata fastify

```

*Note: Make sure to enable `experimentalDecorators` and `emitDecoratorMetadata` in your `tsconfig.json`.*

## Quick Start

Here is how easy it is to get started:

```typescript
import Fastify from 'fastify';
import { bootstrap, Controller, Get, Module } from 'fastify-oop-decorators';

// 1. Define your Controller
@Controller('/hello')
class HelloController {
  @Get()
  sayHello() {
    return { message: 'Hello from Fastify OOP!' };
  }
}

// 2. Define your Module
@Module({
  controllers: [HelloController],
})
class AppModule {}

// 3. Bootstrap the application
async function start() {
  const app = Fastify({ logger: true });
  
  // Attach the OOP ecosystem to Fastify
  await bootstrap(app, AppModule);

  await app.listen({ port: 3000 });
}

start();

```

## API & Decorators (Inspired by NestJS)

Honestly, if you are familiar with NestJS, you already know how to use most of this library. The core decorators (`@Module`, `@Controller`, `@Get`, `@Post`, `@Body`, `@UseGuards`, etc.) work exactly as you'd expect.

However, we added a few **Fastify-specific decorators** to help you get the most out of the underlying server:

* `@InjectPlugin('pluginName')`: Directly inject a Fastify plugin (like a database connection or Redis client) into your services.
* `@Plugin()`: Extract the Fastify server instance directly from your route parameters.
* `@Schema()`, `@BodySchema()`, `@ResponseSchema()`: Hook directly into Fastify's native AJV compiler for your routes.

*(Full, detailed documentation is currently in the works).*

## Roadmap

The current main goal is a **modular refactor**.
I plan to split this repository into smaller, dedicated packages (e.g., `@fastify-oop/core`, `@fastify-oop/websockets`) so you only have to install exactly what you need, keeping your final build as light as possible.

## Contributing & Support

Contributions are more than welcome! Whether it's adding tests, refining benchmarks, or proposing new Fastify-centric features, feel free to open a PR or an issue.

If you like the project or if it helps you transition from NestJS to pure Fastify, **please consider leaving a star (⭐) on the repository.** It really helps the project grow!
