// OpenAPI spec builder (architecture.md line 511: "GET /api-docs —
// interactive OpenAPI/Swagger documentation"; Section 7.1 lists it as
// part of the API surface).
//
// This module only BUILDS the spec object from the @openapi JSDoc
// comments already present on every route file - it does not mount any
// route itself. app.ts decides whether/where to serve it (gated to
// non-production, per the approved forked decision recorded in
// HANDOFF.md's Gap #2 entry).
//
// The `apis` glob below points at TypeScript SOURCE files
// (src/modules/**/*.routes.ts), not compiled dist/ output. This is
// deliberate and only safe because this module is never imported by the
// production entrypoint (dist/app.js only runs with NODE_ENV=production,
// which never reaches the code path that calls buildOpenApiSpec()) - see
// app.ts. Dev/test always run via `tsx`/`vitest` directly against .ts
// source (see package.json's dev:api / test scripts), so the source
// files swagger-jsdoc reads from are always present at that point. If a
// future session ever needs /api-docs available under a compiled
// dist/app.js run, this glob and the production gate below both need to
// change together - see HANDOFF.md's Gap #2 entry for the full context.

import swaggerJSDoc from "swagger-jsdoc";
import { env } from "./env.js";

export function buildOpenApiSpec(): object {
  return swaggerJSDoc({
    definition: {
      openapi: "3.0.3",
      info: {
        title: "Decentralized Voting System API",
        version: "1.0.0",
        description:
          "Backend API for the Ethereum-backed decentralized voting " +
          "platform. See docs/architecture/architecture.md in the " +
          "repository for the full system design.",
      },
      servers: [{ url: `http://localhost:${env.API_PORT}` }],
    },
    // Relative to the process's current working directory (the backend/
    // package root in every dev/test invocation), not to this file -
    // swagger-jsdoc resolves globs via `glob`, not `require`/`import`.
    apis: ["src/modules/**/*.routes.ts"],
  });
}