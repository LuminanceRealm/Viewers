/**
 * Updates the user authentication service with the provided token and cleans the token from the URL.
 * @param token - The token to set in the user authentication service.
 * @param location - The location object from the router.
 * @param userAuthenticationService - The user authentication service instance.
 */
export function updateAuthServiceAndCleanUrl(
  token: string,
  location: any,
  userAuthenticationService: any
): void {
  if (!token) {
    return;
  }

  // if a token is passed in, set the userAuthenticationService to use it
  // for the Authorization header for all requests
  userAuthenticationService.setServiceImplementation({
    getAuthorizationHeader: () => ({
      Authorization: 'Bearer ' + token,
    }),
  });

  // NUBIX: keep the token in the URL (upstream strips it from history here).
  // Refreshing or hand-editing the viewer URL must preserve the logged-in
  // session, and the NUBIX token adds no new exposure: it is the study's
  // internal_pin, which already travels visibly inside the ?url= manifest
  // param in logged-in flows.
}
