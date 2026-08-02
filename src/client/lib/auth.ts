import { passkeyClient } from "@better-auth/passkey/client";
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
  basePath: "/api/auth",
  plugins: [passkeyClient()],
});

export const { useSession, signIn, signOut } = authClient;

/** True when this browser can do platform passkeys (Face ID / Touch ID).
 *  Safari on an un-passcoded device and older browsers say no. */
export async function platformPasskeysAvailable(): Promise<boolean> {
  if (!globalThis.PublicKeyCredential?.isUserVerifyingPlatformAuthenticatorAvailable) {
    return false;
  }
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}
