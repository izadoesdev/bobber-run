/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as admin from "../admin.js";
import type * as auth from "../auth.js";
import type * as chat from "../chat.js";
import type * as cleanup from "../cleanup.js";
import type * as crons from "../crons.js";
import type * as fund from "../fund.js";
import type * as islandRules from "../islandRules.js";
import type * as islands from "../islands.js";
import type * as jev from "../jev.js";
import type * as leaderboard from "../leaderboard.js";
import type * as legacyAccounts from "../legacyAccounts.js";
import type * as legacySignIn from "../legacySignIn.js";
import type * as lib from "../lib.js";
import type * as limits from "../limits.js";
import type * as moderate from "../moderate.js";
import type * as names from "../names.js";
import type * as profiles from "../profiles.js";
import type * as records from "../records.js";
import type * as rotation from "../rotation.js";
import type * as saves from "../saves.js";
import type * as sea from "../sea.js";
import type * as stats from "../stats.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  admin: typeof admin;
  auth: typeof auth;
  chat: typeof chat;
  cleanup: typeof cleanup;
  crons: typeof crons;
  fund: typeof fund;
  islandRules: typeof islandRules;
  islands: typeof islands;
  jev: typeof jev;
  leaderboard: typeof leaderboard;
  legacyAccounts: typeof legacyAccounts;
  legacySignIn: typeof legacySignIn;
  lib: typeof lib;
  limits: typeof limits;
  moderate: typeof moderate;
  names: typeof names;
  profiles: typeof profiles;
  records: typeof records;
  rotation: typeof rotation;
  saves: typeof saves;
  sea: typeof sea;
  stats: typeof stats;
  users: typeof users;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  auth: import("@convex-dev/auth/_generated/component.js").ComponentApi<"auth">;
  authAnonymous: import("@convex-dev/auth/components/anonymous/_generated/component.js").ComponentApi<"authAnonymous">;
  authPassword: import("@convex-dev/auth/components/password/_generated/component.js").ComponentApi<"authPassword">;
  authUsername: import("@convex-dev/auth/components/username/_generated/component.js").ComponentApi<"authUsername">;
  rateLimiter: import("@convex-dev/rate-limiter/_generated/component.js").ComponentApi<"rateLimiter">;
};
