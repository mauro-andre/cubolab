import { CF_CODE } from "../constants.js";

// Erro base — cada subclass carrega seu código CF + status HTTP esperado.
// O middleware `app.onError` no app.ts serializa pra CF response envelope.
export class CfShimError extends Error {
    readonly code: number;
    readonly httpStatus: number;

    constructor(code: number, httpStatus: number, message: string) {
        super(message);
        this.code = code;
        this.httpStatus = httpStatus;
    }
}

export class ZoneNotFoundError extends CfShimError {
    constructor() {
        super(CF_CODE.ZONE_NOT_FOUND, 404, "zone not found — add to CUBOLAB_ZONES");
    }
}

export class RecordNotFoundError extends CfShimError {
    constructor(recordId: string, zoneId: string) {
        super(CF_CODE.RECORD_NOT_FOUND, 404, `record ${recordId} not found in zone ${zoneId}`);
    }
}

export class UnsupportedTypeError extends CfShimError {
    constructor(type: string) {
        super(
            CF_CODE.RECORD_TYPE_UNSUPPORTED,
            400,
            `record type '${type}' is not supported in cubolab cf-shim (v1 supports A, CNAME)`,
        );
    }
}

// Duplicate = type + name + content + zone_id idênticos. Dois A records com
// mesmo name mas IPs diferentes são permitidos (CF permite round-robin).
export class DuplicateRecordError extends CfShimError {
    constructor() {
        super(
            CF_CODE.RECORD_DUPLICATE,
            400,
            "record with identical type, name and content already exists",
        );
    }
}

export class ValidationError extends CfShimError {
    constructor(detail: string) {
        super(CF_CODE.VALIDATION, 400, `Invalid DNS record input: ${detail}`);
    }
}

export class UpstreamError extends CfShimError {
    constructor(detail: string) {
        super(CF_CODE.UPSTREAM_FAILED, 502, `upstream challtestsrv error: ${detail}`);
    }
}

export class PersistenceError extends CfShimError {
    constructor() {
        super(
            CF_CODE.PERSISTENCE_FAILED,
            500,
            "dns record propagated to DNS but state persistence failed",
        );
    }
}
