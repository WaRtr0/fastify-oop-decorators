export enum ParamType {
	REQ,
	RES,
	BODY,
	QUERY,
	PARAM,
	HEADERS,
	PLUGIN,
	JWT_BODY,
	SOCKET,
	MESSAGE_BODY,
}

export interface ParamDefinition {
	index: number;
	type: ParamType;
	key?: string | undefined;
}
