export type Type<T = any> = new (...args: any[]) => T;

export interface ModuleMetadata {
	imports?: Type[];
	controllers?: Type[];
	providers?: Type[];
	gateways?: Type[];
}

export interface OnModuleInit {
	onModuleInit(): void | Promise<void>;
}

export interface OnModuleDestroy {
	onModuleDestroy(): void | Promise<void>;
}