import 'reflect-metadata';
import { METADATA_KEYS } from '../helpers/metadata.keys.js';

export function Service(): ClassDecorator {
	return function (target: object) {
		Reflect.defineMetadata(METADATA_KEYS.service, true, target);
	};
}

export const Injectable = Service;