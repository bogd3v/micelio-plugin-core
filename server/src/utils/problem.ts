import type { Context } from 'koa'

/** An error answer of an API Micelio designs (RFC 9457, section 4 of the standard). */
export interface ProblemDetail {
  type: string
  title: string
  status: number
  detail: string
  /** Stable and machine-readable: a client branches on it, never on the text. */
  code: string
}

/** Answers the request with a problem detail as `application/problem+json`. */
export function sendProblem(ctx: Context, problem: ProblemDetail): void {
  ctx.status = problem.status
  ctx.body = problem
  // After the body: Koa sets `application/json` whenever the body is an object.
  ctx.type = 'application/problem+json'
}
