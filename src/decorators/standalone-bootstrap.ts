import 'reflect-metadata';
import { container } from './services/container.js';
import { METADATA_KEYS } from './helpers/metadata.keys.js';
import type { Type, ModuleMetadata } from './module/module.interfaces.js';

class MicroserviceContext {
    [key: string]: any;
}


// Creation d une app fastify fake, beaucoup plus legere qui permet de faire des containers sans aucune logique en HTTP et donc beaucoup plus leger...

export async function bootstrapStandalone(rootModule: Type, globals: Record<string, any> = {}) {
    //Similule l'app Fastify pour les plugins injectés et etc...
    const context = new MicroserviceContext();
    Object.assign(context, globals);
    container.setApp(context as any); // On dupe le container

    const modulesToProcess = [rootModule];
    const processedModules = new Set<Type>();
    const allControllers: Type[] = [];

    while (modulesToProcess.length > 0) {
        const currentModule = modulesToProcess.shift()!;
        if (processedModules.has(currentModule)) continue;
        processedModules.add(currentModule);

        const metadata: ModuleMetadata = Reflect.getMetadata(METADATA_KEYS.module, currentModule);
        if (!metadata) continue;

        if (metadata.providers) {
            metadata.providers.forEach(provider => container.resolve(provider));
        }

        if (metadata.controllers) {
            allControllers.push(...metadata.controllers);
        }

        if (metadata.imports) {
            modulesToProcess.push(...metadata.imports);
        }
    }

    allControllers.forEach(controller => container.resolve(controller));

    for (const instance of container.getAllInstances()) {
        if (typeof instance.onModuleInit === 'function') {
            await instance.onModuleInit();
        }
    }
    console.log('[Standalone] Dependency Injection initialized.');
    return context;
}