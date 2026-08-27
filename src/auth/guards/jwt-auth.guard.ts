import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Request } from 'express';
import { Repository } from 'typeorm';
import { CAPABILITY_ANY_KEY, CAPABILITY_KEY, PUBLIC_KEY } from '../../common/decorators';
import { Capability, userCan } from '../capabilities';
import { User } from '../entities/user.entity';

/**
 * Authenticates the bearer token and resolves it to the domain user, then
 * checks the capability the route declared.
 *
 * Applied globally: a route is protected unless it explicitly opts out with
 * Public(). Defaulting to closed means a new endpoint cannot be published
 * unauthenticated by forgetting a decorator.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly reflector: Reflector,
    @InjectRepository(User)
    private readonly users: Repository<User>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const token = bearerToken(request);
    if (!token) {
      throw new UnauthorizedException('Authentication required');
    }

    let userId: number;
    try {
      const payload = await this.jwtService.verifyAsync<{ sub: number }>(token);
      userId = payload.sub;
    } catch {
      throw new UnauthorizedException('Authentication required');
    }

    // Loaded fresh on every request rather than trusted from the token, so a
    // role change or a removed user takes effect immediately instead of
    // lingering until the token expires.
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException('Authentication required');
    }
    (request as Request & { user: User }).user = user;

    const required = this.reflector.getAllAndOverride<Capability>(
      CAPABILITY_KEY,
      [context.getHandler(), context.getClass()],
    );
    // Resolved against the person, not only their job title: a licensing
    // authority's staff hold capabilities their role table does not list.
    // Authenticated but not permitted is 403, not 401 - re-authenticating
    // would not help, and telling the caller to try again would be a lie.
    if (required && !userCan(user, required)) {
      throw new ForbiddenException(
        `Your role (${user.role}) cannot perform this operation`,
      );
    }

    const requiredAny = this.reflector.getAllAndOverride<Capability[]>(
      CAPABILITY_ANY_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (
      requiredAny?.length &&
      !requiredAny.some((capability) => userCan(user, capability))
    ) {
      throw new ForbiddenException(
        `Your role (${user.role}) cannot perform this operation`,
      );
    }

    return true;
  }
}

function bearerToken(request: Request): string | null {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return null;
  }
  const token = header.slice(7).trim();
  return token.length > 0 ? token : null;
}
