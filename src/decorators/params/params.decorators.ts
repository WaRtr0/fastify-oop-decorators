import { createParamDecorator } from './param.factory.js';
import { ParamType } from './param.interfaces.js';

export const Req = createParamDecorator(ParamType.REQ);
export const Res = createParamDecorator(ParamType.RES);
export const Body = createParamDecorator(ParamType.BODY);
export const Query = createParamDecorator(ParamType.QUERY);
export const Param = createParamDecorator(ParamType.PARAM);
export const Headers = createParamDecorator(ParamType.HEADERS);
export const Plugin = createParamDecorator(ParamType.PLUGIN);
export const JWTBody = createParamDecorator(ParamType.JWT_BODY);
