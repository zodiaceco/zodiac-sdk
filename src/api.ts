import type {
  ApplyConstellationPayload,
  ApplyConstellationResult,
  ResolveConstellationPayload,
  ResolveConstellationResult,
  ApiError as ApiErrorResponse,
  ApiErrorIssue,
  ListAccountsResult,
  ListUsersResult,
} from '@zodiaceco/api-types'
import assert from 'assert'
import { UUID } from 'crypto'

export type Options = {
  workspace?: string
  apiKey?: string
  baseUrl?: string
  fetch?: typeof globalThis.fetch
  headers?: Record<string, string>
}

const DEFAULT_API_URL = 'https://app.zodiac.eco/api/v1'

export class ApiClient {
  private apiKey: string
  private baseUrl: string
  private _fetch: typeof fetch
  private headers: Record<string, string>

  constructor({
    // Read `ZODIAC_API_URL`/`ZODIAC_API_KEY` lazily at construction time
    // rather than at module load: the CLI loads `.env` (and `init` writes a
    // fresh one) before the first client is created, so capturing them at
    // import time would bake in the default and ignore the user's config.
    baseUrl = process.env.ZODIAC_API_URL ?? DEFAULT_API_URL,
    fetch: customFetch = fetch,
    headers = {},
    apiKey = process.env.ZODIAC_API_KEY,
  }: Options = {}) {
    this.baseUrl = baseUrl.replace(/\/$/, '')
    this._fetch = customFetch
    this.headers = headers

    assert(
      apiKey,
      'No API key provided to the API client. Either pass it as the "apiKey" option or set the ZODIAC_API_KEY environment variable.'
    )

    this.apiKey = apiKey
  }

  protected async postJson(endpoint: string, payload: unknown) {
    const res = await this._fetch(`${this.baseUrl}/${endpoint}`, {
      method: 'POST',
      headers: {
        ...this.headers,
        'content-type': 'application/json',
        authorization: `Bearer ${this.apiKey}`,
      },
      body: jsonStringify(payload),
    })
    if (!res.ok) {
      await handleApiError(res)
    }

    return res.json()
  }

  protected async get(endpoint: string) {
    const res = await this._fetch(`${this.baseUrl}/${endpoint}`, {
      headers: { ...this.headers, authorization: `Bearer ${this.apiKey}` },
    })

    if (!res.ok) {
      await handleApiError(res)
    }

    return res.json()
  }

  /**
   * Every account the workspaces of this org hold, grouped by workspace.
   *
   * Only accounts that exist on chain are listed, so every entry carries an
   * address something was deployed to.
   */
  listAccounts(): Promise<ListAccountsResult> {
    return this.get('accounts')
  }

  /** Every member of this org, with the personal safes they have activated. */
  listUsers(): Promise<ListUsersResult> {
    return this.get('users')
  }

  /**
   * Stores a specification as the constellation's next revision, and answers
   * with a url to review and deploy it. Applying does not deploy anything, and
   * re-applying an undeployed revision replaces it rather than stacking.
   */
  applyConstellation(
    workspaceId: UUID,
    payload: ApplyConstellationPayload
  ): Promise<ApplyConstellationResult> {
    return this.postJson(
      `workspace/${workspaceId}/constellation/apply`,
      payload
    )
  }

  /**
   * Checks a specification the way applying it would, without storing
   * anything: what applying it would refuse is refused in the same words.
   */
  checkConstellation(
    workspaceId: UUID,
    payload: ApplyConstellationPayload
  ): Promise<{ ok: true }> {
    return this.postJson(
      `workspace/${workspaceId}/constellation/check`,
      payload
    )
  }

  /**
   * Reports what the accounts a specification names look like on chain.
   *
   * Declarations are merged over what is read, and a node with no address is
   * resolved against the setup safe of whoever's API key asks — describing the
   * account *that* caller would deploy. Name accounts by address and declare
   * nothing to be told only what is there, the same for every key.
   */
  resolveConstellation(
    workspaceId: UUID,
    payload: ResolveConstellationPayload
  ): Promise<ResolveConstellationResult> {
    return this.postJson(
      `workspace/${workspaceId}/constellation/resolve`,
      payload
    )
  }
}

export class ApiRequestError extends Error {
  public readonly status: number
  public readonly statusText: string
  public readonly details?: unknown
  /** What the API refused, when it could name each problem. */
  public readonly issues: ApiErrorIssue[]
  /** The API's own summary of the problem. */
  public readonly reason: string

  constructor(
    message: string,
    opts: {
      status: number
      statusText: string
      details?: unknown
      cause?: unknown
    }
  ) {
    const issues = readIssues(opts.details)

    super(
      issues.length > 0
        ? formatIssues(message, issues)
        : ApiRequestError.composeMessage(message, opts.details)
    )
    this.name = 'ApiRequestError'
    this.status = opts.status
    this.statusText = opts.statusText
    this.details = opts.details
    this.issues = issues
    this.reason = message
    if (opts.cause !== undefined) {
      ;(this as any).cause = opts.cause
    }
  }

  private static composeMessage(message: string, details?: unknown) {
    if (details == null) return message
    let detailsString: string
    try {
      detailsString =
        typeof details === 'string' ? details : jsonStringify(details, 2)
    } catch (_err) {
      detailsString = String(details)
    }
    return `${message}\nDetails: ${detailsString}`
  }

  toString() {
    return `${this.name}: ${this.message}`
  }
}

async function handleApiError(response: Response): Promise<never> {
  const contentType = response.headers.get('content-type')
  if (contentType?.includes('application/json')) {
    const errorData = (await response.json()) as ApiErrorResponse
    let error: ApiRequestError
    try {
      error = new ApiRequestError(errorData.error.message, {
        status: response.status,
        statusText: response.statusText,
        details: errorData.error.details,
      })
    } catch (jsonShapeError) {
      error = new ApiRequestError(
        `Failed parsing error response: ${jsonShapeError}`,
        {
          status: response.status,
          statusText: response.statusText,
          details: errorData,
        }
      )
    }
    throw error
  } else {
    throw new ApiRequestError(
      `${response.status} ${response.statusText}: ${response.url}`,
      {
        status: response.status,
        statusText: response.statusText,
      }
    )
  }
}

/**
 * The issues of an error response, each naming where in the request it is.
 * Anything that does not look like one is left to the raw details.
 */
const readIssues = (details: unknown): ApiErrorIssue[] => {
  if (
    typeof details !== 'object' ||
    details == null ||
    !('issues' in details)
  ) {
    return []
  }

  const { issues } = details

  if (!Array.isArray(issues)) {
    return []
  }

  return issues.flatMap((issue): ApiErrorIssue[] =>
    typeof issue === 'object' &&
    issue != null &&
    Array.isArray(issue.path) &&
    typeof issue.message === 'string'
      ? [{ path: issue.path, message: issue.message }]
      : []
  )
}

/** A headline and one line per issue, the way a terminal reads best. */
export const formatIssues = (
  headline: string,
  issues: { path: string; message: string }[] | ApiErrorIssue[]
) =>
  [
    `${headline}:`,
    ...issues.map(({ path, message }) => {
      const where = Array.isArray(path) ? path.join(' › ') : path

      return where === '' ? `  • ${message}` : `  • ${where}: ${message}`
    }),
  ].join('\n')

/** JSON.stringify with bigint support */
const jsonStringify = (value: unknown, indent?: number) =>
  JSON.stringify(
    value,
    (_, value) => {
      if (typeof value === 'bigint') {
        return value.toString()
      }

      return value
    },
    indent
  )
