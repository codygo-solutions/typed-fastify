import type * as F from 'fastify';
import {
  FastifyRequestType,
  FastifyTypeProvider,
  FastifyTypeProviderDefault,
  ResolveFastifyRequestType,
} from 'fastify/types/type-provider';
import { Operation, Schema } from './schema';

const addSchema = <
  ServiceSchema extends Schema,
  RawServer extends F.RawServerBase = F.RawServerDefault,
  RawRequest extends F.RawRequestDefaultExpression<RawServer> = F.RawRequestDefaultExpression<RawServer>,
  RawReply extends F.RawReplyDefaultExpression<RawServer> = F.RawReplyDefaultExpression<RawServer>,
  Logger extends F.FastifyLoggerInstance = F.FastifyLoggerInstance,
  S = Service<ServiceSchema, RawServer, RawRequest, RawReply, Logger>,
>(
  fastify: F.FastifyInstance<RawServer, RawRequest, RawReply, Logger>,
  opts: {
    jsonSchema: {
      schema: Record<string, any>;
      fastify: Record<string, any>;
    };
    swaggerSecurityMap?: Record<string, any>;
    service: S;
  },
) => {
  const schema = opts.jsonSchema.schema;
  if (schema?.$id) {
    fastify.addSchema(schema);
  } else {
    throw Error('Schema was ignored, $id is missing; Typed fastify schema was not registered...');
  }

  fastify.decorateReply('matches', function (this: F.FastifyReply, routeWithMethod: string) {
    return `${this.request.method} ${this.request.routerPath}` === routeWithMethod;
  });
  fastify.decorateRequest('operationPath', null);
  fastify.addHook('onRequest', function (req, reply, done) {
    (req as {} as { operationPath: string }).operationPath = `${req.method} ${req.routerPath}`;
    done();
  });
  fastify.decorateReply('asReply', function (this: F.FastifyReply) {
    return this;
  });

  fastify.addHook('onRoute', (config) => {
    if (config.prefix !== fastify.prefix) return;

    const key = `${config.method} ${config.routePath}`;
    const fastifySchema = opts.jsonSchema.fastify;
    let maybeSchema = fastifySchema[key];
    if (!maybeSchema && config.routePath === '') {
      maybeSchema = fastifySchema[`${config.method} /`];
    }
    if (!maybeSchema && config.routePath === '/') {
      maybeSchema = fastifySchema[`${config.method} /`];
    }

    config.schema = config.schema || {};
    if (maybeSchema) {
      config.schema = {
        ...(config.schema ?? {}),
        ...(opts?.swaggerSecurityMap &&
          opts.swaggerSecurityMap[key] && {
            security: opts.swaggerSecurityMap[key],
          }),
        ...maybeSchema?.request?.properties,
        ...(maybeSchema.response && {
          response: maybeSchema.response,
        }),
      };
    }
  });
  const httpMethods: Set<F.HTTPMethods> = new Set(['DELETE', 'GET', 'HEAD', 'PATCH', 'POST', 'PUT', 'OPTIONS']);

  for (const path in opts.service) {
    if (!Object.hasOwnProperty.call(opts.service, path)) continue;
    const [method, ...route] = path.split(' ');
    const httpMethod = <F.HTTPMethods>String(method).toUpperCase();
    if (!method || !httpMethods.has(httpMethod)) {
      throw Error(`Wrong configuration for ${path}, method [${method}] is unknown HTTP method`);
    }
    const handler = opts.service[path];

    switch (typeof handler) {
      case 'object':
        fastify.route({
          ...handler,
          // @ts-ignore
          handler: handler.handler,
          method: httpMethod,
          url: route.join(' '),
        });
        break;
      case 'function':
        fastify.route({
          method: httpMethod,
          // @ts-ignore
          handler: handler,
          url: route.join(' '),
        });
        break;
      default:
        throw Error(`Unknown handler`);
    }
  }
};

export default addSchema;

type Missing<Candidate extends any, MaybeRequired extends any> = [Candidate, MaybeRequired] extends [never, never]
  ? false
  : [Candidate] extends [never]
  ? true
  : [Candidate] extends [MaybeRequired]
  ? false
  : true;

type ExtractMethodPath<T extends string | number | symbol, M extends F.HTTPMethods> = T extends `${M} ${infer P}`
  ? [M, P]
  : never;

type MP<T extends string | number | symbol> =
  | ExtractMethodPath<T, 'DELETE'>
  | ExtractMethodPath<T, 'GET'>
  | ExtractMethodPath<T, 'HEAD'>
  | ExtractMethodPath<T, 'PATCH'>
  | ExtractMethodPath<T, 'POST'>
  | ExtractMethodPath<T, 'PUT'>
  | ExtractMethodPath<T, 'OPTIONS'>;

type ExtractParams<T extends string | number | symbol, Acc = {}> = T extends `${infer _}:${infer P}/${infer R}`
  ? ExtractParams<R, Acc & { [_ in P]: string }>
  : T extends `${infer _}:${infer P}`
  ? Id<Acc & { [_ in P]: string }>
  : Acc;

interface Reply<
  Op extends Operation,
  Status,
  Content,
  Headers,
  Path extends keyof ServiceSchema['paths'],
  ServiceSchema extends Schema,
  RawServer extends F.RawServerBase = F.RawServerDefault,
  RawRequest extends F.RawRequestDefaultExpression<RawServer> = F.RawRequestDefaultExpression<RawServer>,
  RawReply extends F.RawReplyDefaultExpression<RawServer> = F.RawReplyDefaultExpression<RawServer>,
  ContextConfig = F.ContextConfigDefault,
> extends Omit<
    F.FastifyReply<RawServer, RawRequest, RawReply, Router<Op>, ContextConfig>,
    | 'send'
    | 'status'
    | 'statusCode'
    | 'code'
    | 'redirect'
    | 'headers'
    | 'header'
    | 'request'
    | 'getHeader'
    | 'getHeaders'
    | 'then'
  > {
  asReply(this: any): AsReply;
  matches<
    P extends keyof ServiceSchema['paths'],
    IsKnown = P extends Path ? true : false,
    NewOp extends ServiceSchema['paths'][P] = ServiceSchema['paths'][P],
    S = keyof Get<NewOp, 'response'>,
    Content = Get<Get2<NewOp, 'response', S>, 'content'>,
    Headers = Get<Get2<NewOp, 'response', S>, 'headers'>,
  >(
    this: any,
    path: IsKnown extends true ? P : Path,
  ): this is IsKnown extends true
    ? Reply<NewOp, S, Content, Headers, P, ServiceSchema, RawServer, RawRequest, RawReply, ContextConfig>
    : never;

  send<
    AllHeaders = Get2<Op['response'], Status, 'headers'>,
    O = [Headers, AllHeaders],
    MissingHeaders = Missing<Headers, AllHeaders>,
    MissingStatus = [Status] extends [never] ? true : false,
  >(
    ...payload: [MissingStatus] extends [true]
      ? [Invalid<`Missing status`>]
      : [MissingHeaders] extends [true]
      ? [
          Invalid<`Missing headers: [ ${Extract<
            keyof Omit<AllHeaders, keyof ([Headers] extends [never] ? {} : Headers)>,
            string
          >} ]. Please provide required headers before sending reply.`>,
        ]
      : [Get2<Op['response'], Status, 'content'>] extends [never]
      ? []
      : [Get2<Op['response'], Status, 'content'>]
  ): AsReply;

  readonly request: Request<ServiceSchema, Op, Path, RawServer, RawRequest>;
  readonly statusCode: Status;

  headers<Headers extends Get2<Op['response'], Status, 'headers'>>(
    values: Headers,
  ): OpaqueReply<Op, Status, Content, Headers, Path, ServiceSchema, RawServer, RawRequest, RawReply, ContextConfig>;

  header<Header extends keyof AllHeaders, AllHeaders = Get2<Op['response'], Status, 'headers'>>(
    header: Header,
    value: AllHeaders[Header],
  ): OpaqueReply<
    Op,
    Status,
    Content,
    [Headers] extends [never] ? { [K in Header]: AllHeaders[Header] } : Headers & { [K in Header]: AllHeaders[Header] },
    Path,
    ServiceSchema,
    RawServer,
    RawRequest,
    RawReply,
    ContextConfig
  >;

  getHeader<Header extends keyof Headers>(header: Header): Headers[Header];
  getHeaders(): Headers;

  redirect<Status extends keyof Op['response']>(statusCode: Status, url: string): AsReply;
  redirect(url: string): AsReply;

  status<
    Status extends [keyof Op['response']] extends [never]
      ? Invalid<` ${Extract<Path, string>} - has no response`>
      : keyof Op['response'],
  >(
    status: Status,
  ): OpaqueReply<Op, Status, Content, Headers, Path, ServiceSchema, RawServer, RawRequest, RawReply, ContextConfig>;
  code<Status extends keyof Op['response']>(
    status: Status,
  ): OpaqueReply<Op, Status, Content, Headers, Path, ServiceSchema, RawServer, RawRequest, RawReply, ContextConfig>;
}

type OpaqueReply<
  Op extends Operation,
  Status,
  Content,
  Headers,
  Path extends keyof ServiceSchema['paths'],
  ServiceSchema extends Schema,
  RawServer extends F.RawServerBase = F.RawServerDefault,
  RawRequest extends F.RawRequestDefaultExpression<RawServer> = F.RawRequestDefaultExpression<RawServer>,
  RawReply extends F.RawReplyDefaultExpression<RawServer> = F.RawReplyDefaultExpression<RawServer>,
  ContextConfig = F.ContextConfigDefault,
  Opaque = Reply<Op, Status, Content, Headers, Path, ServiceSchema, RawServer, RawRequest, RawReply, ContextConfig>,
> = Status extends unknown ? Opaque : Content extends unknown ? Opaque : Headers extends unknown ? Opaque : never;

interface Invalid<msg = any> {
  readonly __INVALID__: unique symbol;
}

interface AsReply {
  readonly __REPLY_SYMBOL__: unique symbol;
  then(fulfilled: () => void, rejected: (err: Error) => void): void;
}
const assertAsReply: (any: any) => asserts any is AsReply = () => {};
export const asReply = (any: any) => {
  assertAsReply(any);
  return any;
};
type Get<T, P> = P extends keyof T ? T[P] : never;
type Get2<T, P, P2> = Get<Get<T, P>, P2>;

interface Router<Op extends Operation> {
  Querystring: Get<Op['request'], 'querystring'>;
  Params: Get<Op['request'], 'params'>;
  Body: Get<Op['request'], 'body'>;
  Headers: Get<Op['request'], 'headers'>;
  // force reply to be never, as we expose it via custom reply interface
  Reply: never;
}
type Id<T> = T extends infer U ? { [K in keyof U]: U[K] } : never;

interface Request<
  ServiceSchema extends Schema,
  Op extends Operation,
  Path extends keyof ServiceSchema['paths'],
  RawServer extends F.RawServerBase = F.RawServerDefault,
  RawRequest extends F.RawRequestDefaultExpression<RawServer> = F.RawRequestDefaultExpression<RawServer>,
  SchemaCompiler extends F.FastifySchema = F.FastifySchema,
  TypeProvider extends F.FastifyTypeProvider = F.FastifyTypeProviderDefault,
  ContextConfig = F.ContextConfigDefault,
  Logger extends F.FastifyLoggerInstance = F.FastifyLoggerInstance,
  OpRequest extends Router<Op> = Router<Op>,
  PathParams = OpRequest['Params'] extends never
    ? ExtractParams<Path>
    : Id<Omit<ExtractParams<Path>, keyof OpRequest['Params']>>,
  RouteGeneric = OpRequest['Params'] extends [never]
    ? Omit<Router<Op>, 'Params'> & { Params: PathParams }
    : Omit<Router<Op>, 'Params'> & { Params: Id<PathParams & Router<Op>['Params']> },
  RequestType extends FastifyRequestType = ResolveFastifyRequestType<TypeProvider, SchemaCompiler, RouteGeneric>,
> extends Omit<
    F.FastifyRequest<
      RouteGeneric,
      RawServer,
      RawRequest,
      SchemaCompiler,
      TypeProvider,
      ContextConfig,
      Logger,
      RequestType
    >,
    'headers' | 'method' | 'routerMethod' | 'routerPath'
  > {
  readonly operationPath: Path;
  readonly method: MP<Path>[0];
  // A payload within a GET request message has no defined semantics; sending a payload body on a GET request might cause some existing implementations to reject the request.
  readonly body: MP<Path>[0] extends 'GET' ? never : Get<Op['request'], 'body'>;
  readonly routerMethod: MP<Path>[0];
  readonly headers: Get<Op['request'], 'headers'>;
  readonly routerPath: MP<Path>[1];
}

type IsEqual<T, U> = (<G>() => G extends T ? 1 : 2) extends <G>() => G extends U ? 1 : 2 ? true : false;

type GetInvalidParamsValidation<
  Op extends Operation,
  Path extends keyof ServiceSchema['paths'],
  ServiceSchema extends Schema,
  DifferentKeys = Id<Omit<Router<Op>['Params'], keyof ExtractParams<Path>>>,
> = Router<Op>['Params'] extends never
  ? false
  : IsEqual<DifferentKeys, {}> extends false
  ? Invalid<`request.params keys doesn't match params from router path, probably due to typo in [ ${Extract<
      keyof DifferentKeys,
      string
    >} ] in path: [ ${Extract<MP<Path>[1], string>} ]`>
  : false;

type Handler<
  Op extends Operation,
  Path extends keyof ServiceSchema['paths'],
  ServiceSchema extends Schema,
  RawServer extends F.RawServerBase = F.RawServerDefault,
  RawRequest extends F.RawRequestDefaultExpression<RawServer> = F.RawRequestDefaultExpression<RawServer>,
  RawReply extends F.RawReplyDefaultExpression<RawServer> = F.RawReplyDefaultExpression<RawServer>,
  ContextConfig = F.ContextConfigDefault,
  SchemaCompiler = F.FastifySchema,
  TypeProvider extends F.FastifyTypeProvider = F.FastifyTypeProviderDefault,
  RequestType extends FastifyRequestType = ResolveFastifyRequestType<TypeProvider, SchemaCompiler, Router<Op>>,
  Logger extends F.FastifyLoggerInstance = F.FastifyLoggerInstance,
  InvalidParams = GetInvalidParamsValidation<Op, Path, ServiceSchema>,
  ValidSchema = [Op['response'][keyof Op['response']]] extends [never]
    ? Invalid<`${Extract<Path, string>} - has no response, every path should have at least one response defined`>
    : InvalidParams extends Invalid
    ? InvalidParams
    : true,
  Status extends keyof Op['response'] = keyof Op['response'],
> = ValidSchema extends true
  ? (
      this: F.FastifyInstance<RawServer, RawRequest, RawReply, Logger>,
      request: Request<
        ServiceSchema,
        Op,
        Path,
        RawServer,
        RawRequest,
        ContextConfig,
        TypeProvider,
        RequestType,
        Logger
      >,
      reply: Reply<Op, never, never, never, Path, ServiceSchema, RawServer, RawRequest, RawReply, ContextConfig> & {
        readonly __unknownReply: unique symbol;
        M: MP<Path>[0];
      },
    ) => AsReply | Promise<AsReply>
  : ValidSchema;

type HandlerObj<
  Op extends Operation,
  Path extends keyof ServiceSchema['paths'],
  ServiceSchema extends Schema,
  RawServer extends F.RawServerBase = F.RawServerDefault,
  RawRequest extends F.RawRequestDefaultExpression<RawServer> = F.RawRequestDefaultExpression<RawServer>,
  RawReply extends F.RawReplyDefaultExpression<RawServer> = F.RawReplyDefaultExpression<RawServer>,
  ContextConfig = F.ContextConfigDefault,
  SchemaCompiler = F.FastifySchema,
  TypeProvider extends F.FastifyTypeProvider = F.FastifyTypeProviderDefault,
  RequestType extends FastifyRequestType = ResolveFastifyRequestType<TypeProvider, SchemaCompiler, Router<Op>>,
  Logger extends F.FastifyLoggerInstance = F.FastifyLoggerInstance,
> = F.RouteShorthandOptions<
  RawServer,
  RawRequest,
  RawReply,
  Router<Op>,
  ContextConfig,
  SchemaCompiler,
  TypeProvider,
  Logger
> & {
  handler: Handler<Op, Path, ServiceSchema, RawServer, RawRequest, RawReply, ContextConfig, Logger>;
};

export type Service<
  S extends Schema,
  RawServer extends F.RawServerBase = F.RawServerDefault,
  RawRequest extends F.RawRequestDefaultExpression<RawServer> = F.RawRequestDefaultExpression<RawServer>,
  RawReply extends F.RawReplyDefaultExpression<RawServer> = F.RawReplyDefaultExpression<RawServer>,
  ContextConfig = F.ContextConfigDefault,
  SchemaCompiler = F.FastifySchema,
  TypeProvider extends FastifyTypeProvider = FastifyTypeProviderDefault,
  Logger extends F.FastifyLoggerInstance = F.FastifyLoggerInstance,
> = {
  [P in keyof S['paths']]:
    | Handler<
        S['paths'][P],
        P,
        S,
        RawServer,
        RawRequest,
        RawReply,
        ContextConfig,
        SchemaCompiler,
        TypeProvider,
        ResolveFastifyRequestType<TypeProvider, SchemaCompiler, Router<S['paths'][P]>>,
        Logger
      >
    | HandlerObj<
        S['paths'][P],
        P,
        S,
        RawServer,
        RawRequest,
        RawReply,
        ContextConfig,
        SchemaCompiler,
        TypeProvider,
        ResolveFastifyRequestType<TypeProvider, SchemaCompiler, Router<S['paths'][P]>>,
        Logger
      >;
};

export type RequestHandler<
  ServiceSchema extends Schema,
  HandlerPaths extends keyof ServiceSchema['paths'],
  RawServer extends F.RawServerBase = F.RawServerDefault,
  RawRequest extends F.RawRequestDefaultExpression<RawServer> = F.RawRequestDefaultExpression<RawServer>,
  RawReply extends F.RawReplyDefaultExpression<RawServer> = F.RawReplyDefaultExpression<RawServer>,
  ContextConfig = F.ContextConfigDefault,
  SchemaCompiler = F.FastifySchema,
  TypeProvider extends FastifyTypeProvider = FastifyTypeProviderDefault,
  Logger extends F.FastifyLoggerInstance = F.FastifyLoggerInstance,
  S = Service<ServiceSchema, RawServer, RawRequest, RawReply, Logger>,
  Paths = ServiceSchema['paths'],
  OpHandler = {
    [Path in HandlerPaths]: Handler<
      Path extends keyof Paths ? Paths[Path] : never,
      Path,
      ServiceSchema,
      RawServer,
      RawRequest,
      RawReply,
      ContextConfig,
      SchemaCompiler,
      TypeProvider,
      ResolveFastifyRequestType<TypeProvider, SchemaCompiler, Router<Path extends keyof Paths ? Paths[Path] : never>>,
      Logger
    >;
  }[HandlerPaths],
  OpHandlerObj = {
    [Path in HandlerPaths]: HandlerObj<
      Path extends keyof Paths ? Paths[Path] : never,
      Path,
      ServiceSchema,
      RawServer,
      RawRequest,
      RawReply,
      ContextConfig,
      SchemaCompiler,
      TypeProvider,
      ResolveFastifyRequestType<TypeProvider, SchemaCompiler, Router<Path extends keyof Paths ? Paths[Path] : never>>,
      Logger
    >;
  }[HandlerPaths],
> = OpHandler extends (...args: any) => any
  ? {
      Request: Parameters<OpHandler>[0];
      AsFastifyRequest: Parameters<OpHandler>[0] extends F.FastifyRequest<any, any, any>
        ? F.FastifyRequest<
            Router<Paths[keyof Paths]>,
            RawServer,
            RawRequest,
            SchemaCompiler,
            TypeProvider,
            ContextConfig,
            Logger,
            ResolveFastifyRequestType<TypeProvider, SchemaCompiler, Router<Paths[keyof Paths]>>
          >
        : never;
      Reply: Parameters<OpHandler>[1];
      Return: AsReply | Promise<AsReply>;
      ReturnAsync: Promise<AsReply>;
      AsRoute: OpHandler;
      AsRouteObj: OpHandlerObj;
      Paths: HandlerPaths;
    }
  : never;
