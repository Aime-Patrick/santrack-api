import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * A refusal that comes from the domain rather than from HTTP. Every one of
 * these corresponds to a numbered business rule: the caller scanned something
 * real, and the system is explaining why the operation cannot stand.
 *
 * 409 rather than 400 - the request was well formed, the world was not in the
 * state it needs to be in.
 */
export class TraceabilityRuleException extends HttpException {
  /**
   * `detail` carries whatever the caller needs in order to *act* on the
   * refusal, alongside the sentence explaining it. `DomainExceptionFilter`
   * passes unknown keys through untouched, so they arrive at the top level of
   * the 409 body.
   *
   * A production run refused on eligibility uses it to carry the whole check
   * list, so the screen that was showing those checks a moment ago can keep
   * showing them instead of falling back to a bare error banner.
   */
  constructor(message: string, detail?: Record<string, unknown>) {
    super(
      { status: 409, message, timestamp: new Date().toISOString(), ...detail },
      HttpStatus.CONFLICT,
    );
  }
}

export class ItemNotFoundException extends HttpException {
  constructor(qrCode: string) {
    super(
      {
        status: 404,
        message: `No item is registered under ${qrCode}`,
        timestamp: new Date().toISOString(),
      },
      HttpStatus.NOT_FOUND,
    );
  }
}

export class NotFoundEntityException extends HttpException {
  constructor(what: string, id: number | string) {
    super(
      {
        status: 404,
        message: `${what} ${id} was not found`,
        timestamp: new Date().toISOString(),
      },
      HttpStatus.NOT_FOUND,
    );
  }
}

/**
 * The device is replaying a queue it already delivered. The response carries
 * the original event so the client can mark its local record synchronised
 * instead of retrying forever (business rule 12).
 */
export class DuplicateClientEventException extends HttpException {
  constructor(clientEventId: string, eventId: number, recordedAt: Date) {
    super(
      {
        status: 409,
        message: `Operation ${clientEventId} was already recorded`,
        clientEventId,
        originalEventId: eventId,
        recordedAt: recordedAt.toISOString(),
        timestamp: new Date().toISOString(),
      },
      HttpStatus.CONFLICT,
    );
  }
}

export class OrganizationRequiredException extends HttpException {
  constructor() {
    super(
      {
        status: 409,
        message:
          'Complete organization setup before taking part in the chain of custody',
        timestamp: new Date().toISOString(),
      },
      HttpStatus.CONFLICT,
    );
  }
}

export class DuplicateException extends HttpException {
  constructor(message: string) {
    super(
      { status: 409, message, timestamp: new Date().toISOString() },
      HttpStatus.CONFLICT,
    );
  }
}

export class InvalidCredentialsException extends HttpException {
  constructor() {
    super(
      {
        status: 401,
        message: 'Email or password is incorrect',
        timestamp: new Date().toISOString(),
      },
      HttpStatus.UNAUTHORIZED,
    );
  }
}

/**
 * The caller is authenticated but is looking at something outside their
 * organization's chain of custody. Deliberately worded so it does not confirm
 * whether the identity exists (proposal section 25, tenant isolation).
 */
export class NotVisibleException extends HttpException {
  constructor(code: string) {
    super(
      {
        status: 404,
        message: `No item is registered under ${code}`,
        timestamp: new Date().toISOString(),
      },
      HttpStatus.NOT_FOUND,
    );
  }
}
