import 'reflect-metadata';
import { METADATA_KEYS } from '../helpers/metadata.keys.js';

export function InjectPlugin(pluginName: string): PropertyDecorator {
  return (target: any, propertyKey: string | symbol) => {
    // On stocke un objet : { 'nomPropriete': 'nomDuPlugin' }
    // Ex: { 'database': 'db' }
    const existing = Reflect.getMetadata(METADATA_KEYS.injectPlugin, target.constructor) || {};
    existing[propertyKey] = pluginName;
    Reflect.defineMetadata(METADATA_KEYS.injectPlugin, existing, target.constructor);
  };
}