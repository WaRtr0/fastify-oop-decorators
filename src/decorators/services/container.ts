import type { FastifyInstance } from 'fastify';
import 'reflect-metadata';
import { METADATA_KEYS } from '../helpers/metadata.keys.js';

type Constructor<T> = new (...args: any[]) => T;

class DIContainer {
	private services: Map<any, any> = new Map();
	private app: FastifyInstance | null = null;

	public setApp(app: FastifyInstance) {
		this.app = app;
	}

	public register<T>(token: any, instance: T): void {
		if (!this.services.has(token)) {
			this.services.set(token, instance);
		}
	}

	public resolve<T>(token: Constructor<T>): T {
		if (this.services.has(token)) {
			return this.services.get(token);
		}

		const designParamTypes: Constructor<any>[] =
			Reflect.getMetadata('design:paramtypes', token) || [];
		const injectParamsMap: Record<number, any> =
			Reflect.getMetadata(METADATA_KEYS.injectParams, token) || {};

		const maxArgs = Math.max(
			designParamTypes.length,
			...Object.keys(injectParamsMap).map((k) => Number(k) + 1),
			0,
		);

		const constructorArgs = Array.from({ length: maxArgs }, (_, index) => {
			const depToken = injectParamsMap[index] ?? designParamTypes[index];
			return depToken ? this.resolve(depToken) : undefined;
		});

		const newInstance = new token(...constructorArgs);

		this.register(token, newInstance);

		// Apply property injections
		const injectPropsMap: Record<string | symbol, any> =
			Reflect.getMetadata(METADATA_KEYS.injectProps, token) || {};
		for (const [propKey, depToken] of Object.entries(injectPropsMap)) {
			let tokenToResolve = depToken;
			if (typeof depToken === 'function' && !depToken.prototype) {
				tokenToResolve = depToken();
			}
			(newInstance as any)[propKey] = this.resolve(tokenToResolve);
		}

		// Apply plugin injections
		const injectPluginsMap = Reflect.getMetadata(METADATA_KEYS.injectPlugin, token) || {};
		for (const [propKey, pluginName] of Object.entries(injectPluginsMap)) {
			if (!this.app) {
				throw new Error("Fastify instance not set in Container. Did you forget to update bootstrap?");
			}
			// On va chercher directement app['db'] ou app['io']
			// On utilise 'as any' car TypeScript ne peut pas savoir dynamiquement que 'db' existe
			const pluginValue = (this.app as any)[pluginName as string];
			
			if (pluginValue === undefined) {
				console.warn(`[DI] Warning: Plugin '${pluginName}' not found on Fastify instance.`);
			}
			
			(newInstance as any)[propKey] = pluginValue;
		}

		return newInstance;
	}

	public getAllInstances(): any[] {
		return Array.from(this.services.values());
	}
}

export const container = new DIContainer();
