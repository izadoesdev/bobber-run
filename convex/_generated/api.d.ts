/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as auth from "../auth.js";
import type * as cleanup from "../cleanup.js";
import type * as crons from "../crons.js";
import type * as fund from "../fund.js";
import type * as http from "../http.js";
import type * as lib from "../lib.js";
import type * as limits from "../limits.js";
import type * as names from "../names.js";
import type * as profiles from "../profiles.js";
import type * as records from "../records.js";
import type * as saves from "../saves.js";
import type * as sea from "../sea.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  auth: typeof auth;
  cleanup: typeof cleanup;
  crons: typeof crons;
  fund: typeof fund;
  http: typeof http;
  lib: typeof lib;
  limits: typeof limits;
  names: typeof names;
  profiles: typeof profiles;
  records: typeof records;
  saves: typeof saves;
  sea: typeof sea;
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

export declare const components: {};
