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

async function runGuards(
    guards: GuardClass[],
    req: FastifyRequest,
    res: FastifyReply,
): Promise<boolean> {
    for (const GuardCtor of guards) {
        const guardInstance: Guard = container.resolve(GuardCtor);
        const can = await Promise.resolve(guardInstance.canActivate({ req, res }));
        if (!can) {
            return false;
        }
    }
    return true;
}

async function runMiddlewares(
    handlers: (MiddlewareClass | MiddlewareHandler)[],
    req: FastifyRequest,
    res: FastifyReply,
): Promise<void> {
    for (const h of handlers) {
        if (
            typeof h === 'function' &&
            'prototype' in h &&
            typeof (h as any).prototype?.use === 'function'
        ) {
            const instance = container.resolve(h as MiddlewareClass);
            await Promise.resolve(instance.use(req, res));
        } else {
            await Promise.resolve((h as MiddlewareHandler)(req, res));
        }
        if (res.sent) return;
    }
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
        const classGuards = Reflect.getMetadata(METADATA_KEYS.guards, controller) || [];
        const classMiddlewares = Reflect.getMetadata(METADATA_KEYS.middlewares, controller) || [];
        const classHeaders = Reflect.getMetadata(METADATA_KEYS.headers, controller) || {};

        routes.forEach((route) => {
            const routePath = (prefix + route.path).replace('//', '/');
            
            // Récupération métadonnées méthode
            const methodParams: ParamDefinition[] = Reflect.getOwnMetadata(METADATA_KEYS.param, controller.prototype, route.methodName) || [];
            const methodSchema: RouteSchema = Reflect.getOwnMetadata(METADATA_KEYS.schema, controller.prototype, route.methodName) || {};
            const methodGuards = Reflect.getOwnMetadata(METADATA_KEYS.guards, controller.prototype, route.methodName) || [];
            const methodMiddlewares = Reflect.getOwnMetadata(METADATA_KEYS.middlewares, controller.prototype, route.methodName) || [];
            const methodHeaders = Reflect.getOwnMetadata(METADATA_KEYS.headers, controller.prototype, route.methodName) || {};

            // Fusion des tableaux
            const allGuards = [...classGuards, ...methodGuards];
            const allMiddlewares = [...classMiddlewares, ...methodMiddlewares];
            
            // Préparation des Headers sous forme itérable pour éviter Object.entries() à chaque requête
            const allHeadersObj = { ...classHeaders, ...methodHeaders };
            const allHeadersEntries = Object.entries(allHeadersObj);

			// grosse opti avant le sort ete dans le app[route.method](...)
            // Tri des paramètres
            const sortedParams = methodParams.sort((a, b) => a.index - b.index);

            // Binding du handler
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
                        const args = [];
                        if (sortedParams.length > 0) {
                            for (const param of sortedParams) {
                                switch (param.type) {
                                    case ParamType.REQ: args.push(req); break;
                                    case ParamType.RES: args.push(res); break;
                                    case ParamType.BODY: args.push(req.body); break;
                                    case ParamType.QUERY: args.push(param.key ? (req.query as any)[param.key] : req.query); break;
                                    case ParamType.PARAM: args.push(param.key ? (req.params as any)[param.key] : req.params); break;
                                    case ParamType.HEADERS: args.push(param.key ? req.headers[param.key] : req.headers); break;
                                    case ParamType.PLUGIN: args.push(param.key ? (req.server as any)[param.key] : req.server); break;
                                    default: args.push(undefined);
                                }
                            }
                        }

                        // 4. Headers
                        if (allHeadersEntries.length > 0) {
                            for (const [name, value] of allHeadersEntries) {
                                // @ts-ignore
                                if (!res.getHeader(name)) res.header(name, value);
                            }
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
                        if (error && typeof error.statusCode === 'number') {
                            res
                                .status(error.statusCode)
                                .send({ statusCode: error.statusCode, message: error.message || 'Error' });
                            return;
                        }
                        res.status(500).send({ statusCode: 500, message: 'Internal Server Error' });
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

            app.io.of(namespace).on('connection', (socket: Socket) => {
                if (connectionHandlerMethod) {
                    gatewayInstance[connectionHandlerMethod](socket);
                }

                messages.forEach(({ event, methodName }) => {
                    const handler = gatewayInstance[methodName].bind(gatewayInstance);
                    const schemaMeta: any =
                        Reflect.getOwnMetadata(METADATA_KEYS.schema, gateway.prototype, methodName) ??
                        undefined;

                    socket.on(event, async (payload: any) => {
                        try {
                            const bodySchema =
                                schemaMeta && typeof schemaMeta === 'object' && 'body' in schemaMeta
                                    ? (schemaMeta as any).body
                                    : schemaMeta;
                            if (bodySchema) {
                                const validate = (app.validatorCompiler as any)({ schema: bodySchema });
                                if (!validate(payload)) {
                                    socket.emit('error', {
                                        event,
                                        message: 'Validation failed',
                                        errors: validate.errors,
                                    });
                                    return;
                                }
                            }

                            const result = await Promise.resolve(handler(socket, payload));
                            if (result !== undefined) {
                                socket.emit(event, result);
                            }
                        } catch (error: any) {
                            socket.emit('error', {
                                event,
                                message: 'An error occurred on the server.',
                                error: error.message,
                            });
                        }
                    });
                });

                socket.on('disconnect', () => {
                    if (disconnectionHandlerMethod) {
                        gatewayInstance[disconnectionHandlerMethod](socket);
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