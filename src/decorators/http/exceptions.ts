export class HttpException extends Error {
	public readonly status: number;
	public readonly payload?: unknown;

	constructor(message: string, status: number, payload?: unknown) {
		super(message);
		this.name = this.constructor.name;
		this.status = status;
		this.payload = payload;
	}
}

export class BadRequestException extends HttpException {
	constructor(message = 'Bad Request', payload?: unknown) {
		super(message, 400, payload);
	}
}

export class UnauthorizedException extends HttpException {
	constructor(message = 'Unauthorized', payload?: unknown) {
		super(message, 401, payload);
	}
}

export class ForbiddenException extends HttpException {
	constructor(message = 'Forbidden', payload?: unknown) {
		super(message, 403, payload);
	}
}

export class NotFoundException extends HttpException {
	constructor(message = 'Not Found', payload?: unknown) {
		super(message, 404, payload);
	}
}

export class ConflictException extends HttpException {
	constructor(message = 'Conflict', payload?: unknown) {
		super(message, 409, payload);
	}
}

export class UnprocessableEntityException extends HttpException {
	constructor(message = 'Unprocessable Entity', payload?: unknown) {
		super(message, 422, payload);
	}
}

export class InternalServerErrorException extends HttpException {
	constructor(message = 'Internal Server Error', payload?: unknown) {
		super(message, 500, payload);
	}
}

export class BadGatewayException extends HttpException {
	constructor(message = 'Bad Gateway', payload?: unknown) {
		super(message, 502, payload);
	}
}