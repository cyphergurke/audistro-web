import { createHash } from "node:crypto";

type HTTPMethod = "get" | "post" | "put" | "patch" | "delete";
type SuccessStatus = 200 | 201 | 202;

export type PathsWithMethod<Paths extends object, Method extends HTTPMethod> = {
  [Path in Extract<keyof Paths, string>]: Method extends keyof Paths[Path] ? Path : never;
}[Extract<keyof Paths, string>];

type OperationFor<
  Paths extends object,
  Method extends HTTPMethod,
  Path extends PathsWithMethod<Paths, Method>
> = Paths[Path] extends Record<Method, infer Operation> ? Operation : never;

type ParametersFor<Operation> = Operation extends { parameters: infer Parameters } ? Parameters : never;

type PathParamsFor<Operation> = ParametersFor<Operation> extends { path: infer PathParams }
  ? PathParams
  : ParametersFor<Operation> extends { path?: infer PathParams }
    ? PathParams
    : never;

type QueryParamsFor<Operation> = ParametersFor<Operation> extends { query: infer QueryParams }
  ? QueryParams
  : ParametersFor<Operation> extends { query?: infer QueryParams }
    ? QueryParams
    : never;

type ResponsesFor<Operation> = Operation extends { responses: infer Responses } ? Responses : never;

type ResponseForStatus<Responses, Status extends SuccessStatus> = Status extends keyof Responses
  ? Responses[Status]
  : `${Status}` extends keyof Responses
    ? Responses[`${Status}`]
    : never;

type JSONContent<Response> = Response extends { content: infer Content }
  ? Content extends { "application/json": infer Body }
    ? Body
    : never
  : never;

type BinaryContent<Response> = Response extends { content: infer Content }
  ? Content extends { "application/octet-stream": infer Body }
    ? Body
    : never
  : never;

export type SuccessJSONResponse<Operation> =
  | JSONContent<ResponseForStatus<ResponsesFor<Operation>, 200>>
  | JSONContent<ResponseForStatus<ResponsesFor<Operation>, 201>>
  | JSONContent<ResponseForStatus<ResponsesFor<Operation>, 202>>;

export type SuccessBinaryResponse<Operation> =
  | BinaryContent<ResponseForStatus<ResponsesFor<Operation>, 200>>
  | BinaryContent<ResponseForStatus<ResponsesFor<Operation>, 201>>
  | BinaryContent<ResponseForStatus<ResponsesFor<Operation>, 202>>;

type JSONRequestBodyFor<Operation> = Operation extends {
  requestBody: { content: { "application/json": infer Body } };
}
  ? Body
  : never;

export type JSONRequestBody<
  Paths extends object,
  Method extends HTTPMethod,
  Path extends PathsWithMethod<Paths, Method>
> = JSONRequestBodyFor<OperationFor<Paths, Method, Path>>;

type QueryPrimitive = string | number | boolean;

export class APIClientError extends Error {
  readonly status: number;
  readonly bodyText: string;
  readonly contentType: string;
  readonly setCookie: string | null;
  readonly payload: { error?: string; message?: string } | null;

  constructor(status: number, bodyText: string, contentType: string, setCookie: string | null) {
    const payload = parseErrorPayload(bodyText);
    super(payload?.message ?? payload?.error ?? `upstream request failed with status ${status}`);
    this.name = "APIClientError";
    this.status = status;
    this.bodyText = bodyText;
    this.contentType = contentType;
    this.setCookie = setCookie;
    this.payload = payload;
  }
}

export type RequestJSONOptions<
  Paths extends object,
  Method extends HTTPMethod,
  Path extends PathsWithMethod<Paths, Method>
> = {
  method: Method;
  path: Path;
  pathParams?: PathParamsFor<OperationFor<Paths, Method, Path>>;
  query?: QueryParamsFor<OperationFor<Paths, Method, Path>>;
  json?: JSONRequestBody<Paths, Method, Path>;
  headers?: HeadersInit;
  cookie?: string;
  timeoutMs?: number;
  cache?: RequestCache;
};

export type RequestFormOptions<
  Paths extends object,
  Method extends HTTPMethod,
  Path extends PathsWithMethod<Paths, Method>
> = {
  method: Method;
  path: Path;
  pathParams?: PathParamsFor<OperationFor<Paths, Method, Path>>;
  query?: QueryParamsFor<OperationFor<Paths, Method, Path>>;
  formData: FormData;
  headers?: HeadersInit;
  cookie?: string;
  timeoutMs?: number;
  cache?: RequestCache;
};

type APIClientResult<T> = {
  data: T;
  response: Response;
  setCookie: string | null;
};

function parseErrorPayload(bodyText: string): { error?: string; message?: string } | null {
  const trimmed = bodyText.trim();
  if (!trimmed) {
    return null;
  }
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (typeof parsed !== "object" || parsed === null) {
      return null;
    }
    const record = parsed as Record<string, unknown>;
    if (typeof record.error === "string" || typeof record.message === "string") {
      return {
        error: typeof record.error === "string" ? record.error : undefined,
        message: typeof record.message === "string" ? record.message : undefined
      };
    }
    if (typeof record.error === "object" && record.error !== null) {
      const nested = record.error as Record<string, unknown>;
      return {
        error: typeof nested.code === "string" ? nested.code : undefined,
        message: typeof nested.message === "string" ? nested.message : undefined
      };
    }
  } catch {
    return null;
  }
  return null;
}

function buildURL<Path extends string>(
  baseURL: string,
  pathTemplate: Path,
  pathParams?: Record<string, string | number>,
  query?: Record<string, QueryPrimitive | null | undefined>
): URL {
  let resolvedPath: string = pathTemplate;
  if (pathParams) {
    for (const [name, value] of Object.entries(pathParams)) {
      resolvedPath = resolvedPath.replace(`{${name}}`, encodeURIComponent(String(value)));
    }
  }
  const url = new URL(resolvedPath, baseURL);
  if (query) {
    for (const [name, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === "") {
        continue;
      }
      url.searchParams.set(name, String(value));
    }
  }
  return url;
}

function mergeHeaders(
  headers: HeadersInit | undefined,
  cookie: string | undefined
): Record<string, string> {
  const merged: Record<string, string> = {};
  if (headers instanceof Headers) {
    headers.forEach((value, key) => {
      merged[key] = value;
    });
  } else if (Array.isArray(headers)) {
    for (const [key, value] of headers) {
      merged[key] = value;
    }
  } else if (headers) {
    Object.assign(merged, headers);
  }
  if (cookie) {
    merged.cookie = cookie;
  }
  return merged;
}

async function readFailure(response: Response): Promise<never> {
  const bodyText = await response.text();
  throw new APIClientError(
    response.status,
    bodyText,
    response.headers.get("content-type") ?? "",
    response.headers.get("set-cookie")
  );
}

async function fetchWithTimeout(input: URL, init: RequestInit, timeoutMs = 6000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export function createAPIClient<Paths extends object>(baseURL: string) {
  return {
    async requestJSON<
      Method extends HTTPMethod,
      Path extends PathsWithMethod<Paths, Method>,
      ResponseBody = SuccessJSONResponse<OperationFor<Paths, Method, Path>>
    >(options: RequestJSONOptions<Paths, Method, Path>): Promise<APIClientResult<ResponseBody>> {
      const url = buildURL(
        baseURL,
        options.path,
        options.pathParams as Record<string, string | number> | undefined,
        options.query as Record<string, QueryPrimitive | null | undefined> | undefined
      );
      const headers = mergeHeaders(options.headers, options.cookie);
      let body: BodyInit | undefined;
      if (options.json !== undefined) {
        headers["Content-Type"] = "application/json";
        body = JSON.stringify(options.json);
      }
      const response = await fetchWithTimeout(
        url,
        {
          method: options.method.toUpperCase(),
          headers,
          body,
          cache: options.cache ?? "no-store"
        },
        options.timeoutMs
      );
      if (!response.ok) {
        await readFailure(response);
      }
      const data = (await response.json()) as ResponseBody;
      return {
        data,
        response,
        setCookie: response.headers.get("set-cookie")
      };
    },

    async requestForm<
      Method extends HTTPMethod,
      Path extends PathsWithMethod<Paths, Method>,
      ResponseBody = SuccessJSONResponse<OperationFor<Paths, Method, Path>>
    >(options: RequestFormOptions<Paths, Method, Path>): Promise<APIClientResult<ResponseBody>> {
      const url = buildURL(
        baseURL,
        options.path,
        options.pathParams as Record<string, string | number> | undefined,
        options.query as Record<string, QueryPrimitive | null | undefined> | undefined
      );
      const response = await fetchWithTimeout(
        url,
        {
          method: options.method.toUpperCase(),
          headers: mergeHeaders(options.headers, options.cookie),
          body: options.formData,
          cache: options.cache ?? "no-store"
        },
        options.timeoutMs
      );
      if (!response.ok) {
        await readFailure(response);
      }
      const data = (await response.json()) as ResponseBody;
      return {
        data,
        response,
        setCookie: response.headers.get("set-cookie")
      };
    },

    async requestBinary<
      Method extends HTTPMethod,
      Path extends PathsWithMethod<Paths, Method>,
      ResponseBody = SuccessBinaryResponse<OperationFor<Paths, Method, Path>>
    >(options: Omit<RequestJSONOptions<Paths, Method, Path>, "json">): Promise<APIClientResult<ResponseBody>> {
      const url = buildURL(
        baseURL,
        options.path,
        options.pathParams as Record<string, string | number> | undefined,
        options.query as Record<string, QueryPrimitive | null | undefined> | undefined
      );
      const response = await fetchWithTimeout(
        url,
        {
          method: options.method.toUpperCase(),
          headers: mergeHeaders(options.headers, options.cookie),
          cache: options.cache ?? "no-store"
        },
        options.timeoutMs
      );
      if (!response.ok) {
        await readFailure(response);
      }
      const data = (await response.arrayBuffer()) as ResponseBody;
      return {
        data,
        response,
        setCookie: response.headers.get("set-cookie")
      };
    }
  };
}

export function proxyErrorResponse(error: APIClientError): Response {
  return new Response(error.bodyText, {
    status: error.status,
    headers: {
      "Content-Type": error.contentType || "application/json",
      "Cache-Control": "no-store"
    }
  });
}

export function generatedFileDigest(contents: string): string {
  return createHash("sha256").update(contents).digest("hex");
}
