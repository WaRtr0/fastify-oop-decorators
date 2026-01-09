import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import 'reflect-metadata';
import type { Socket } from 'socket.io';
import type { Guard, GuardClass } from './guards/guards.interfaces.js';
import { METADATA_KEYS } from './helpers/metadata.keys.js';
import { HttpException } from './http/exceptions.js';
import type { MiddlewareClass, MiddlewareHandler } from './middleware/middleware.interfaces.js';
import type { ModuleMetadata, Type } from './module/module.interfaces.js';
import { ParamType, type ParamDefinition } from './params/param.interfaces.js';
import type { RouteDefinition } from './routes.js';
import { container } from './services/container.js';
import type { RouteSchema } from './validation/schema.decorator.js';
import type { SubscribeMessageDefinition } from './websocket/subscribe-message.decorator.js';


const DEFAULT_HTTP_CODES : Record<string, number> = {
    // 'get': 200,
    'post': 201,
    // 'put': 204,
    // 'patch': 204,
    // 'delete': 204,
};

function processModule(module: Type): { providers: Type[]; controllers: Type[]; gateways: Type[] } {
    const allProviders: Type[] = [];
    const allControllers: Type[] = [];
    const allGateways: Type[] = [];
    const modulesToProcess: Type[] = [module];
    const processedModules = new Set<Type>();

    while (modulesToProcess.length > 0) {
        const currentModule = modulesToProcess.shift()!;
        if (processedModules.has(currentModule)) {
            continue;
        }
        processedModules.add(currentModule);

        const metadata: ModuleMetadata = Reflect.getMetadata(METADATA_KEYS.module, currentModule);
        if (!metadata) {
            continue;
        }

        allProviders.push(...(metadata.providers || []));
        allControllers.push(...(metadata.controllers || []));
        allGateways.push(...(metadata.gateways || []));

        if (metadata.imports) {
            modulesToProcess.push(...metadata.imports);
        }
    }

    return { providers: allProviders, controllers: allControllers, gateways: allGateways };
}

type ResolvedGuard = Guard;
type ResolvedMiddleware = MiddlewareClass | MiddlewareHandler | { use: MiddlewareHandler };

// Optimisation V4: Boucle For + Array pré-alloué
function buildArgFactory(params: ParamDefinition[]): (req: FastifyRequest, res: FastifyReply) => any[] {
    const sorted = params.sort((a, b) => a.index - b.index);
    const len = sorted.length;

    if (len === 0) {
        const empty: any[] = [];
        return () => empty;
    }

    const getters = new Array<(req: FastifyRequest, res: FastifyReply) => any>(len);

    for (let i = 0; i < len; i++) {
        const param = sorted[i];
        switch (param.type) {
            case ParamType.REQ: getters[i] = (req) => req; break;
            case ParamType.RES: getters[i] = (_, res) => res; break;
            case ParamType.BODY: getters[i] = (req) => req.body; break;
            case ParamType.QUERY: getters[i] = param.key ? (req) => (req.query as any)[param.key!] : (req) => req.query; break;
            case ParamType.PARAM: getters[i] = param.key ? (req) => (req.params as any)[param.key!] : (req) => req.params; break;
            case ParamType.HEADERS: getters[i] = param.key ? (req) => req.headers[param.key!] : (req) => req.headers; break;
            case ParamType.PLUGIN: getters[i] = param.key ? (req) => (req.server as any)[param.key!] : (req) => req.server; break;
            case ParamType.JWT_BODY: getters[i] = (req) => (req as any).user || parseJWT(req.headers['authorization']); break;
            default: getters[i] = () => undefined;
        }
    }

    return (req, res) => {
        const args = new Array(len);
        for (let i = 0; i < len; i++) {
            args[i] = getters[i](req, res);
        }
        return args;
    };
}

// async function runGuards(
//     guards: GuardClass[],
//     req: FastifyRequest,
//     res: FastifyReply,
// ): Promise<boolean> {
//     for (const GuardCtor of guards) {
//         const guardInstance: Guard = container.resolve(GuardCtor);
//         const can = await Promise.resolve(guardInstance.canActivate({ req, res }));
//         if (!can) {
//             return false;
//         }
//     }
//     return true;
// }

// async function runMiddlewares(
//     handlers: (MiddlewareClass | MiddlewareHandler)[],
//     req: FastifyRequest,
//     res: FastifyReply,
// ): Promise<void> {
//     for (const h of handlers) {
//         if (
//             typeof h === 'function' &&
//             'prototype' in h &&
//             typeof (h as any).prototype?.use === 'function'
//         ) {
//             const instance = container.resolve(h as MiddlewareClass);
//             await Promise.resolve(instance.use(req, res));
//         } else {
//             await Promise.resolve((h as MiddlewareHandler)(req, res));
//         }
//         if (res.sent) return;
//     }
// }


// opti : on resolve plus chaque runtime, on creer des instances et deja resolve
async function runGuards(guards: ResolvedGuard[], req: FastifyRequest, res: FastifyReply): Promise<boolean> {
    for (const guard of guards) {
        const can = await guard.canActivate({ req, res });
        if (!can) return false;
    }
    return true;
}

async function runMiddlewares(handlers: ResolvedMiddleware[], req: FastifyRequest, res: FastifyReply): Promise<void> {
    for (const h of handlers) {
        if (typeof h === 'function') {
            await (h as MiddlewareHandler)(req, res);
        } else if ('use' in h && typeof h.use === 'function') {
             await h.use(req, res);
        }
        if (res.sent) return;
    }
}

// Oui attention il n'est pas secure, il ne verifie pas la signature mais c justement rechercher
// car evite d'utiliser du cpu pour rien, car on aura le check qui passe par dessu (le guard)
function parseJWT(token: string | undefined | null | string[]): any {
    if (!token) return undefined;
    if (Array.isArray(token)) token = token[0];

    try {
        let startIndex = 0;
        if (token.startsWith('Bearer ')) startIndex = 7;
        // add en minuscule on ne sait jamais...
        else if (token.startsWith('bearer ')) startIndex = 7;

        // const parts = token.split('.');
        // if (parts.length >= 2) {
        //     const payloadBase64 = parts[1];
        //     const decoded = Buffer.from(payloadBase64, 'base64').toString('utf-8');
        //     return JSON.parse(decoded);
        // }

        // opti au lieu d'utiliser split qui a allou un tableau de 3 string

        const firstDot = token.indexOf('.', startIndex);
        if (firstDot === -1) return undefined;

        const secondDot = token.indexOf('.', firstDot + 1);
        if (secondDot === -1) return undefined;

        const payloadBase64 = token.substring(firstDot + 1, secondDot);
        return JSON.parse(Buffer.from(payloadBase64, 'base64').toString('utf-8'));
    } catch (e) {
        return undefined;
    }
}

function resolveWebSocketArgs(
    params: ParamDefinition[],
    socket: Socket,
    payload?: any,
): any[] {
    const args: any[] = [];
    for (const param of params) {
        switch (param.type) {
            case ParamType.SOCKET:
                args.push(socket);
                break;
            case ParamType.MESSAGE_BODY:
                args.push(payload);
                break;
            case ParamType.JWT_BODY:
                args.push(
                    parseJWT(
                        socket.handshake.auth?.token ||
                            socket.handshake.query?.token ||
                            socket.handshake.headers['authorization'],
                    ),
                );
                break;
            default:
                args.push(undefined);
        }
    }
    return args;
}

export async function bootstrap(app: FastifyInstance, rootModule: Type) {
    container.setApp(app);
    const { providers, controllers, gateways } = processModule(rootModule);

    // 1. Initialisation des Services
    providers.forEach((provider) => container.resolve(provider));

    // 2. Initialisation des Contrôleurs
    controllers.forEach((controller) => {
        const controllerInstance = container.resolve(controller);
        const prefix = Reflect.getMetadata(METADATA_KEYS.controller, controller) || '';
        const routes: RouteDefinition[] = Reflect.getMetadata(METADATA_KEYS.routes, controller) || [];

        // Pré-calcul des métadonnées de classe (Fait 1 seule fois)
        const classGuardCtors: GuardClass[] = Reflect.getMetadata(METADATA_KEYS.guards, controller) || [];
        const classGuardsInstances = classGuardCtors.map(G => container.resolve(G));

        const classMiddlewareCtors = Reflect.getMetadata(METADATA_KEYS.middlewares, controller) || [];
        const classMiddlewaresInstances = classMiddlewareCtors.map((M: any) => {
            if (M.prototype && M.prototype.use) return container.resolve(M as MiddlewareClass);
            return M;
        });

        const classHeaders = Reflect.getMetadata(METADATA_KEYS.headers, controller) || {};

        routes.forEach((route) => {
            const routePath = (prefix + route.path).replace('//', '/');

            const methodParams: ParamDefinition[] = Reflect.getOwnMetadata(METADATA_KEYS.param, controller.prototype, route.methodName) || [];
            const argFactory = buildArgFactory(methodParams);

            const methodSchema: RouteSchema = Reflect.getOwnMetadata(METADATA_KEYS.schema, controller.prototype, route.methodName) || {};
            // const methodGuards = Reflect.getOwnMetadata(METADATA_KEYS.guards, controller.prototype, route.methodName) || [];
            // const methodMiddlewares = Reflect.getOwnMetadata(METADATA_KEYS.middlewares, controller.prototype, route.methodName) || [];

            const methodHeaders = Reflect.getOwnMetadata(METADATA_KEYS.headers, controller.prototype, route.methodName) || {};
            const allHeadersEntries = Object.entries({ ...classHeaders, ...methodHeaders });

            const methodGuardCtors: GuardClass[] = Reflect.getOwnMetadata(METADATA_KEYS.guards, controller.prototype, route.methodName) || [];
            const methodGuardsInstances = methodGuardCtors.map(G => container.resolve(G));

            const methodMiddlewareCtors = Reflect.getOwnMetadata(METADATA_KEYS.middlewares, controller.prototype, route.methodName) || [];
            const methodMiddlewaresInstances = methodMiddlewareCtors.map((M: any) => {
                    if (M.prototype && M.prototype.use) return container.resolve(M as MiddlewareClass);
                    return M;
            });

            const allGuards = [...classGuardsInstances, ...methodGuardsInstances];
            const allMiddlewares = [...classMiddlewaresInstances, ...methodMiddlewaresInstances];

            const explicitHttpCode = Reflect.getOwnMetadata(METADATA_KEYS.httpCode, controller.prototype, route.methodName);
            const finalHttpCode = explicitHttpCode ?? DEFAULT_HTTP_CODES[route.method];

            const handler = controllerInstance[route.methodName].bind(controllerInstance);


            app[route.method](
                routePath,
                { schema: methodSchema },
                async (req: FastifyRequest, res: FastifyReply) => {
                    try {
                        // 1. Middlewares
                        if (allMiddlewares.length > 0) {
                            await runMiddlewares(allMiddlewares, req, res);
                            if (res.sent) return;
                        }

                        // 2. Guards
                        if (allGuards.length > 0) {
                            const ok = await runGuards(allGuards, req, res);
                            if (!ok) {
                                res.status(403).send({ message: 'Forbidden' });
                                return;
                            }
                        }

                        // 3. Construction des arguments (Optimisé)
                        // const args = [];
                        // if (sortedParams.length > 0) {
                        //     for (const param of sortedParams) {
                        //         switch (param.type) {
                        //             case ParamType.REQ: args.push(req); break;
                        //             case ParamType.RES: args.push(res); break;
                        //             case ParamType.BODY: args.push(req.body); break;
                        //             case ParamType.QUERY: args.push(param.key ? (req.query as any)[param.key] : req.query); break;
                        //             case ParamType.PARAM: args.push(param.key ? (req.params as any)[param.key] : req.params); break;
                        //             case ParamType.HEADERS: args.push(param.key ? req.headers[param.key] : req.headers); break;
                        //             case ParamType.PLUGIN: args.push(param.key ? (req.server as any)[param.key] : req.server); break;
                        //             case ParamType.JWT_BODY: args.push(parseJWT(req.headers['authorization'])); break;
                        //             default: args.push(undefined);
                        //         }
                        //     }
                        // }

                        // Construction des arguments Optimisé V3 !

                        const args = argFactory(req, res);

                        // 4. Headers
                        if (allHeadersEntries.length > 0) {
                            for (const [name, value] of allHeadersEntries) {
                                res.header(name, value);
                            }
                        }

                        if (finalHttpCode) {
                            res.status(finalHttpCode);
                        }
                        // 5. Exécution Handler
                        const result = await handler(...args);

                        if (!res.sent) {
                            res.send(result);
                        }
                    } catch (error: any) {
                        if (error instanceof HttpException) {
                            res.status(error.status).send({
                                statusCode: error.status,
                                message: error.message,
                                error: error.name,
                                payload: error.payload,
                            });
                            return;
                        }

                        const status = error.statusCode || 500;
                        res.status(status).send({ statusCode: status, message: error.message || 'Internal Server Error' });
                    }
                },
            );

            app.log.info(`Mapped route: [${route.method.toUpperCase()}] ${routePath}`);
        });
    });

    // --- WebSocket Gateway Initialization ---
    if (gateways.length > 0) {
        if (!app.io) {
            app.log.warn('Socket.io plugin not found. WebSocket Gateways will not be initialized.');
            return;
        }

        app.log.info('Initializing WebSocket Gateways...');

        gateways.forEach((gateway) => {
            const gatewayInstance = container.resolve(gateway);
            const namespace = Reflect.getMetadata(METADATA_KEYS.webSocketGateway, gateway) || '/';
            const messages: SubscribeMessageDefinition[] =
                Reflect.getMetadata(METADATA_KEYS.subscribeMessage, gateway) || [];
            const connectionHandlerMethod: string | symbol | undefined = Reflect.getMetadata(
                METADATA_KEYS.subscribeConnection,
                gateway,
            );
            const disconnectionHandlerMethod: string | symbol | undefined = Reflect.getMetadata(
                METADATA_KEYS.subscribeDisconnection,
                gateway,
            );

            // opti V3 la compilation de l'ajv ete toujours dans la runtime il ne fait pas dans chaque event mais fait toute meme a chaque connection de nouveau utilisateur... maintenant c en cache juste avant...
            const connectionParams = connectionHandlerMethod 
                ? (Reflect.getOwnMetadata(METADATA_KEYS.param, gateway.prototype, connectionHandlerMethod) || []).sort((a: any, b: any) => a.index - b.index) 
                : [];

            const disconnectionParams = disconnectionHandlerMethod
                ? (Reflect.getOwnMetadata(METADATA_KEYS.param, gateway.prototype, disconnectionHandlerMethod) || []).sort((a: any, b: any) => a.index - b.index)
                : [];

            const preparedListeners = messages.map(({ event, methodName }) => {
                const handler = gatewayInstance[methodName].bind(gatewayInstance);

                const schemaMeta: any = Reflect.getOwnMetadata(METADATA_KEYS.schema, gateway.prototype, methodName);
                const bodySchema = schemaMeta?.body || schemaMeta;
                let validate: ((data: any) => boolean) | undefined;

                  // grosse opti !
                if (bodySchema) {
                    validate = (app.validatorCompiler as any)({ schema: bodySchema });
                }

                const methodParams = Reflect.getOwnMetadata(METADATA_KEYS.param, gateway.prototype, methodName) || [];
                const sortedParams = methodParams.sort((a: any, b: any) => a.index - b.index);

                return { event, handler, validate, sortedParams };
            });

            app.io.of(namespace).on('connection', (socket: Socket) => {
                // const connectionParams: ParamDefinition[] = connectionHandlerMethod
                    // ? Reflect.getOwnMetadata(METADATA_KEYS.param, gateway.prototype, connectionHandlerMethod) || []
                    // : [];
                // const sortedConnectionParams = connectionParams.sort((a, b) => a.index - b.index);

                // if (connectionHandlerMethod) {
                //     if (sortedConnectionParams.length > 0) {
                //         const args = resolveWebSocketArgs(sortedConnectionParams, socket);
                //         gatewayInstance[connectionHandlerMethod](...args);
                //     } else {
                //         gatewayInstance[connectionHandlerMethod](socket);
                //     }
                // }

                if (connectionHandlerMethod) {
                    const args = connectionParams.length > 0
                        ? resolveWebSocketArgs(connectionParams, socket)
                        : [socket];
                    gatewayInstance[connectionHandlerMethod](...args);
                }

                // messages.forEach(({ event, methodName }) => {
                //     const handler = gatewayInstance[methodName].bind(gatewayInstance);
                //     const schemaMeta: any =
                //         Reflect.getOwnMetadata(METADATA_KEYS.schema, gateway.prototype, methodName) ??
                //         undefined;
                //     const methodParams: ParamDefinition[] = Reflect.getOwnMetadata(
                //         METADATA_KEYS.param,
                //         gateway.prototype,
                //         methodName,
                //     ) || [];
                //     const sortedMethodParams = methodParams.sort((a, b) => a.index - b.index);


                //     // opti de malade, evite de recompiler ajv a chaque runime (chaque event)
                //     let validate: ((data: any) => boolean) | undefined;

                //     const bodySchema = schemaMeta && typeof schemaMeta === 'object' && 'body' in schemaMeta ? (schemaMeta as any).body : schemaMeta;

                //     if (bodySchema) {
                //         validate = (app.validatorCompiler as any)({ schema: bodySchema });
                //     }

                //     socket.on(event, async (payload: any) => {
                //         try {
                //             // desastre d'opti...

                //             // const bodySchema =
                //             //     schemaMeta && typeof schemaMeta === 'object' && 'body' in schemaMeta
                //             //         ? (schemaMeta as any).body
                //             //         : schemaMeta;
                //             // if (bodySchema) {
                //             //     const validate = (app.validatorCompiler as any)({ schema: bodySchema });
                //             //     if (!validate(payload)) {
                //             //         socket.emit('error', {
                //             //             event,
                //             //             message: 'Validation failed',
                //             //             errors: validate.errors,
                //             //         });
                //             //         return;
                //             //     }
                //             // }

                //             if (validate) {
                //                 const isValid = validate(payload);
                //                 if (!isValid) {
                //                     socket.emit('error', {
                //                         event,
                //                         message: 'Validation failed',
                //                         errors: (validate as any).errors,
                //                     });
                //                     return;
                //                 }
                //             }

                //             let args: any[] = [socket, payload];
                //             if (sortedMethodParams.length > 0) {
                //                 args = resolveWebSocketArgs(sortedMethodParams, socket, payload);
                //             }

                //             const result = await Promise.resolve(handler(...args));
                //             if (result !== undefined) {
                //                 socket.emit(event, result);
                //             }
                //         } catch (error: any) {
                //             socket.emit('error', {
                //                 event,
                //                 message: 'An error occurred on the server.',
                //                 error: error.message,
                //             });
                //         }
                //     });
                // });

                // preparedListeners.forEach(({ event, handler, validate, sortedParams }) => {
                //     socket.on(event, async (payload: any) => {
                //         try {

                //             if (validate) {
                //                 const isValid = validate(payload);
                //                 if (!isValid) {
                //                     socket.emit('error', {
                //                         event,
                //                         message: 'Validation failed',
                //                         errors: (validate as any).errors,
                //                     });
                //                     return;
                //                 }
                //             }

                //             let args: any[] = [socket, payload];
                //             if (sortedParams.length > 0) {
                //                 args = resolveWebSocketArgs(sortedParams, socket, payload);
                //             }

                //             const result = await Promise.resolve(handler(...args));

                //             if (result !== undefined) {
                //                 socket.emit(event, result);
                //             }
                //         } catch (error: any) {
                //             socket.emit('error', {
                //                 event,
                //                 message: 'An error occurred on the server.',
                //                 error: error.message,
                //             });
                //         }
                //     });
                // });

                for (const listener of preparedListeners) {
                    // opti accession 
                    const { event, handler, validate, sortedParams } = listener;
                    socket.on(event, async (payload: any) => {
                        try {
                            if (validate && !validate(payload)) {
                                return socket.emit('error', { event, message: 'Validation failed', errors: (validate as any).errors });
                            }
                            let args = [socket, payload];
                            if (sortedParams.length > 0) args = resolveWebSocketArgs(sortedParams, socket, payload);

                            const result = await handler(...args);
                            if (result !== undefined) socket.emit(event, result);
                        } catch (e: any) {
                            socket.emit('error', { event, message: 'Server error', error: e.message });
                        }
                    });
                }

                socket.on('disconnect', () => {
                    if (disconnectionHandlerMethod) {
                        const args = disconnectionParams.length > 0
                            ? resolveWebSocketArgs(disconnectionParams, socket)
                            : [socket];
                        gatewayInstance[disconnectionHandlerMethod](...args);
                    }
                });
            });
            app.log.info(`WebSocket Gateway initialized for namespace: ${namespace}`);
        });
    }

    // --- Lifecycle Hooks ---

    // OnModuleInit
    for (const instance of container.getAllInstances()) {
        if (typeof instance.onModuleInit === 'function') {
            await instance.onModuleInit();
        }
    }

    // OnModuleDestroy
    app.addHook('onClose', async () => {
        for (const service of container.getAllInstances()) {
            if (typeof service.onModuleDestroy === 'function') {
                await service.onModuleDestroy();
            }
        }
    });
}