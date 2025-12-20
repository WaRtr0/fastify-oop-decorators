import { createParamDecorator } from '../params/param.factory.js';
import { ParamType } from '../params/param.interfaces.js';

export const ConnectedSocket = createParamDecorator(ParamType.SOCKET);
export const MessageBody = createParamDecorator(ParamType.MESSAGE_BODY);
