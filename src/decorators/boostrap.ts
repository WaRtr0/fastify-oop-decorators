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

export function bootstrap(app: FastifyInstance, rootModule: Type) {
	container.setApp(app); // on set une instance de fastify dans le container pour les injections de plugins
	const { providers, controllers, gateways } = processModule(rootModule);

	providers.forEach((provider) => container.resolve(provider));
	controllers.forEach((controller) => {
		const controllerInstance = container.resolve(controller);
		const prefix = Reflect.getMetadata(METADATA_KEYS.controller, controller) || '';
		const routes: RouteDefinition[] = Reflect.getMetadata(METADATA_KEYS.routes, controller) || [];

		const classGuards: GuardClass[] = Reflect.getMetadata(METADATA_KEYS.guards, controller) || [];
		const classMiddlewares: (MiddlewareClass | MiddlewareHandler)[] =
			Reflect.getMetadata(METADATA_KEYS.middlewares, controller) || [];
		const classHeaders: Record<string, string> =
			Reflect.getMetadata(METADATA_KEYS.headers, controller) || {};

		routes.forEach((route) => {
			const routePath = (prefix + route.path).replace('//', '/');
			const handler = controllerInstance[route.methodName].bind(controllerInstance);
			const params: ParamDefinition[] =
				Reflect.getOwnMetadata(METADATA_KEYS.param, controller.prototype, route.methodName) || [];
			const methodSchema: RouteSchema =
				Reflect.getOwnMetadata(METADATA_KEYS.schema, controller.prototype, route.methodName) || {};
			const methodGuards: GuardClass[] =
				Reflect.getOwnMetadata(METADATA_KEYS.guards, controller.prototype, route.methodName) || [];
			const methodMiddlewares: (MiddlewareClass | MiddlewareHandler)[] =
				Reflect.getOwnMetadata(METADATA_KEYS.middlewares, controller.prototype, route.methodName) ||
				[];
			const methodHeaders: Record<string, string> =
				Reflect.getOwnMetadata(METADATA_KEYS.headers, controller.prototype, route.methodName) || {};

			const allGuards: GuardClass[] = [...classGuards, ...methodGuards];
			const allMiddlewares: (MiddlewareClass | MiddlewareHandler)[] = [
				...classMiddlewares,
				...methodMiddlewares,
			];
			const allHeaders: Record<string, string> = { ...classHeaders, ...methodHeaders };

			app[route.method](
				routePath,
				{ schema: methodSchema },
				async (req: FastifyRequest, res: FastifyReply) => {
					try {
						if (allMiddlewares.length > 0) {
							await runMiddlewares(allMiddlewares, req, res);
							if (res.sent) return;
						}

						if (allGuards.length > 0) {
							const ok = await runGuards(allGuards, req, res);
							if (!ok) {
								res.status(403).send({ message: 'Forbidden' });
								return;
							}
						}

						const args = params
							.sort((a, b) => a.index - b.index)
							.map((param) => {
								switch (param.type) {
									case ParamType.REQ:
										return req;
									case ParamType.RES:
										return res;
									case ParamType.BODY:
										return req.body;
									case ParamType.QUERY:
										return param.key ? (req.query as any)[param.key] : req.query;
									case ParamType.PARAM:
										return param.key ? (req.params as any)[param.key] : req.params;
									case ParamType.HEADERS:
										return param.key ? req.headers[param.key] : req.headers;
									case ParamType.PLUGIN:
										return param.key ? (req.server as any)[param.key] : req.server;
									default:
										return undefined;
								}
							});

						for (const [name, value] of Object.entries(allHeaders)) {
							if (!res.getHeader(name)) res.header(name, value);
						}

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
							// Validation { body: schema }, soit schema raw classique...
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
}
