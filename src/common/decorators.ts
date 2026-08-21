import {
  createParamDecorator,
  ExecutionContext,
  SetMetadata,
} from '@nestjs/common';
import { Capability } from '../auth/capabilities';
import { User } from '../auth/entities/user.entity';
import { Organization } from '../organization/entities/organization.entity';
import { OrganizationRequiredException } from './errors';

export const PUBLIC_KEY = 'santrack:public';

/**
 * Marks a route as reachable without a token. Used only by registration,
 * login and the public product verification endpoint - everything else in the
 * platform requires an account.
 */
export const Public = () => SetMetadata(PUBLIC_KEY, true);

export const CAPABILITY_KEY = 'santrack:capability';

/**
 * Declares what a route does, in domain terms. The guard resolves it against
 * the caller's role, so authorization is stated where the operation is
 * defined rather than in a table somewhere else.
 */
export const RequireCapability = (capability: Capability) =>
  SetMetadata(CAPABILITY_KEY, capability);

/** The authenticated user, already loaded with their organization. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): User => {
    return context.switchToHttp().getRequest().user as User;
  },
);

/**
 * The organization the caller acts on behalf of. Every traceability operation
 * needs one: the user becomes the event actor, the organization becomes the
 * acting party in the chain of custody. Users who have not finished onboarding
 * cannot take part.
 */
export const ActingOrg = createParamDecorator(
  (_data: unknown, context: ExecutionContext): Organization => {
    const user = context.switchToHttp().getRequest().user as User;
    if (!user?.organization) {
      throw new OrganizationRequiredException();
    }
    return user.organization;
  },
);
