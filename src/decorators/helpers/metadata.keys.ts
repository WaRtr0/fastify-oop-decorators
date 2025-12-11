export const METADATA_KEYS = {
	// http metadata
	controller: Symbol('controller'),
	routes: Symbol('routes'),
	injectParams: Symbol('inject_params'),
	injectProps: Symbol('inject_props'),
	service: Symbol('service'),
	module: Symbol('module'),
	param: Symbol('param'),
	schema: Symbol('schema'),
	guards: Symbol('guards'),
	middlewares: Symbol('middlewares'),
	headers: Symbol('headers'),
	httpCode: Symbol('httpCode'),
	redirect: Symbol('redirect'),
	injectPlugin: Symbol('injectPlugin'),

	// WebSocket Metadata
	webSocketGateway: Symbol('webSocketGateway'),
	subscribeMessage: Symbol('subscribeMessage'),
	subscribeConnection: Symbol('subscribeConnection'),
	subscribeDisconnection: Symbol('subscribeDisconnection'),
};
