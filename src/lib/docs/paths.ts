// Paths that MUST stay under /docs so middleware serves them on
// docs.novaracleaning.com rather than 308-ing them to another host.
// The Google OAuth callback in particular has to live here: a callback
// on admin.novaracleaning.com would set the session cookie on the admin
// host, and docs.novaracleaning.com would never see it.

export const DOCS_HOME = "/docs";
export const DOCS_AUTH = "/docs/auth";
export const DOCS_AUTH_CALLBACK = "/docs/auth/callback";
export const DOCS_SIGN_OUT = "/docs/auth/sign-out";
