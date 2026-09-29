import { config } from '../config.js';
import { log } from '../lib/logger.js';

/**
 * Optional Firebase Authentication bridge for Global mode.
 *
 * Hackerly's own session system is the source of truth for authorization, so
 * this module has exactly two jobs:
 *   1. tell the browser whether Google sign-in is available
 *   2. verify a Firebase ID token on the server with the admin SDK
 *
 * When Firebase is not configured (the default for self-hosted installs) every
 * call here is a no-op and the UI hides the Google button. Nothing pretends.
 */
let adminAuth: any = null;
let initAttempted = false;

async function getAdminAuth(): Promise<any | null> {
  if (initAttempted) return adminAuth;
  initAttempted = true;
  if (!config.firebase.configured) {
    log.info('firebase auth disabled (no service account configured)');
    return null;
  }
  try {
    const appMod: any = await import('firebase-admin/app');
    const authMod: any = await import('firebase-admin/auth');
    const app = appMod.getApps().length
      ? appMod.getApp()
      : appMod.initializeApp(
          {
            credential: {
              projectId: config.firebase.projectId,
              clientEmail: config.firebase.clientEmail,
              privateKey: config.firebase.privateKey,
            },
          },
          'hackerly',
        );
    adminAuth = authMod.getAuth(app);
    log.info('firebase auth ready', { project: config.firebase.projectId });
  } catch (e) {
    log.warn('firebase auth unavailable', { error: (e as Error).message });
    adminAuth = null;
  }
  return adminAuth;
}

export interface VerifiedClaims {
  uid: string;
  email?: string;
  name?: string;
  picture?: string;
  email_verified?: boolean;
}

export const firebaseAuth = {
  available(): boolean {
    return Boolean(config.firebase.projectId && config.firebase.webApiKey);
  },

  /** Config safe to hand to the browser. Never contains a secret. */
  publicConfig() {
    if (!config.firebase.projectId || !config.firebase.webApiKey) return { enabled: false };
    return {
      enabled: true,
      apiKey: config.firebase.webApiKey,
      authDomain: config.firebase.authDomain || `${config.firebase.projectId}.firebaseapp.com`,
      projectId: config.firebase.projectId,
    };
  },

  async verifyIdToken(idToken: string): Promise<VerifiedClaims | null> {
    const auth = await getAdminAuth();
    if (auth) {
      try {
        const decoded = await auth.verifyIdToken(idToken, true);
        return {
          uid: decoded.uid,
          email: decoded.email,
          name: decoded.name,
          picture: decoded.picture,
          email_verified: decoded.email_verified,
        };
      } catch (e) {
        log.warn('id token rejected by admin auth', { error: (e as Error).message });
      }
    }
    try {
      const resp = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`);
      if (resp.ok) {
        const d: any = await resp.json();
        if (d && (d.sub || d.user_id)) {
          return {
            uid: d.sub || d.user_id,
            email: d.email,
            name: d.name,
            picture: d.picture,
            email_verified: d.email_verified === 'true' || d.email_verified === true,
          };
        }
      }
    } catch (e) {
      log.warn('google tokeninfo fallback error', { error: (e as Error).message });
    }
    return null;
  },
};
