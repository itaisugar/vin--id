/**
 * Shared authentication / authorization errors.
 *
 * These live in their own module (rather than inside a feature service) so that
 * both `lib/vehicles/*` and `lib/organizations/*` can throw and catch them
 * without importing each other — which would be circular.
 *
 * `NotAuthenticatedError` is re-exported from `lib/vehicles/service` for
 * backwards compatibility with the modules that already import it from there.
 */

export class NotAuthenticatedError extends Error {
  constructor() {
    super("Not authenticated");
    this.name = "NotAuthenticatedError";
  }
}

/**
 * The user is signed in but has no organization. Should be unreachable — the
 * signup trigger provisions one — but a profile row can lag behind an auth user
 * (e.g. a account created before the fleet migration and never backfilled), and
 * silently falling back to *some* organization would be a cross-tenant leak.
 */
export class OrganizationMissingError extends Error {
  constructor() {
    super("No organization for the current user");
    this.name = "OrganizationMissingError";
  }
}

/** The user's role does not permit this operation (e.g. a viewer writing). */
export class NotAuthorizedError extends Error {
  constructor(message = "Not authorized") {
    super(message);
    this.name = "NotAuthorizedError";
  }
}
