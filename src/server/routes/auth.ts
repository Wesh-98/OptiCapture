import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomBytes, randomUUID } from 'node:crypto';
import { db } from '../db.js';
import {
  authenticateToken,
  authLimiter,
  googleClient,
  requireOwner,
  asyncRoute,
} from '../middleware.js';
import { revokeToken, pendingOAuth, pendingOAuthSet, DUMMY_HASH, BCRYPT_COST } from '../cache.js';
import {
  generateStoreCode,
  normalizeUsername,
  parseSqliteUtc,
  toSqliteUtc,
  UnsupportedImageTypeError,
} from '../helpers.js';
import {
  saveStoreDetails,
  storeContactFormatError,
  storeFieldLengthError,
  storeNameError,
} from '../storeDetails.js';
import type { AuthRequest } from '../types.js';
import { logError } from '../logger.js';

export const authRouter = express.Router();

function isRequestBody(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyStringFields<T extends string>(
  body: Record<string, unknown>,
  fields: readonly T[]
): body is Record<string, unknown> & Partial<Record<T, string>> {
  return fields.every(field => body[field] === undefined || typeof body[field] === 'string');
}

function registrationInputError(input: {
  storeName: string | undefined;
  username: string;
  password: string | undefined;
  hasOAuthKey: boolean;
  contact: Parameters<typeof storeFieldLengthError>[0];
}): string | null {
  const { storeName, username, password, contact } = input;
  if (!storeName || !username) return 'Store name and username are required';
  if (storeName.length > 100) return 'Store name must be 100 characters or fewer';
  if (username.length > 50) return 'Username must be 50 characters or fewer';
  const lengthError = storeFieldLengthError(contact);
  if (lengthError) return lengthError;
  if (!password && !input.hasOAuthKey) return 'Password is required';
  if (password && (password.length < 8 || !/[A-Z]/.test(password) || !/\d/.test(password)))
    return 'Password must be at least 8 characters with 1 uppercase letter and 1 number';
  return storeContactFormatError(contact);
}

function writeAuthLog(
  action: string,
  details: string,
  userId: number,
  storeId: number | null | undefined
) {
  db.prepare('INSERT INTO logs (action, details, user_id, store_id) VALUES (?, ?, ?, ?)').run(
    action,
    details,
    userId,
    storeId
  );
}

function incrementFailedLoginAttempts(users: any[]) {
  const uniqueUsers = new Map<number, any>();
  for (const user of users) {
    if (user?.id != null) uniqueUsers.set(user.id, user);
  }

  // Increment in SQL, not from the row read before the async password check: concurrent
  // failures would otherwise each write back the same stale count and never reach the lockout.
  const updateUser = db.prepare(`
    UPDATE users
    SET failed_login_attempts = COALESCE(failed_login_attempts, 0) + 1,
        locked_until = CASE WHEN COALESCE(failed_login_attempts, 0) + 1 >= 5 THEN ? ELSE locked_until END
    WHERE id = ?
  `);

  const lockedUntil = toSqliteUtc(new Date(Date.now() + 15 * 60 * 1000));
  for (const user of uniqueUsers.values()) {
    updateUser.run(lockedUntil, user.id);
  }
}

function buildAccountSessionUser(userId: number) {
  const user = db
    .prepare(
      'SELECT id, username, role, store_id, token_version, must_reset_password FROM users WHERE id = ?'
    )
    .get(userId) as any;
  if (!user) {
    return null;
  }

  return {
    id: user.id,
    username: user.username,
    role: user.role,
    default_store_id: user.store_id ?? null,
    token_version: user.token_version ?? 1,
    must_reset_password: user.must_reset_password === 1,
  };
}

// Local helper — only called from auth handlers in this file
function issueJwt(
  req: express.Request,
  res: express.Response,
  user: {
    id: number;
    username: string;
    role?: string;
    default_store_id?: number | null;
    token_version?: number;
    must_reset_password?: boolean | number;
  }
) {
  const token = jwt.sign(
    {
      id: user.id,
      username: user.username,
      role: user.role,
      default_store_id: user.default_store_id ?? null,
      token_version: user.token_version ?? 1,
      must_reset_password: Boolean(user.must_reset_password),
    },
    process.env.JWT_SECRET!,
    { expiresIn: '8h', algorithm: 'HS256', issuer: 'opticapture', audience: 'opticapture-app' }
  );
  const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';
  res.cookie('token', token, {
    httpOnly: true,
    secure: isHttps,
    sameSite: isHttps ? 'strict' : 'lax',
    maxAge: 8 * 60 * 60 * 1000,
  });
  return token;
}

type LoginLookup =
  | { failure: { status: number; error: string } }
  | {
      user: any;
      passwordMatch: boolean;
      role: string | null;
      storeId: number | null;
      storeName: string | null;
    };

function loginFailure(status: number, error: string): LoginLookup {
  return { failure: { status, error } };
}

// Both lookups compare against DUMMY_HASH when no account matches, so a missing username
// takes as long to reject as a wrong password.

async function findStoreLogin(
  storeCode: string,
  username: string,
  password: string
): Promise<LoginLookup> {
  const store = db
    .prepare('SELECT id, name, status FROM stores WHERE store_code = ?')
    .get(storeCode) as any;
  if (!store) return loginFailure(401, 'Invalid store code');
  if (store.status === 'suspended') return loginFailure(403, 'Store account suspended');

  const matchingUsers = db
    .prepare(
      `
        SELECT u.*, us.role AS access_role
        FROM user_stores us
        JOIN users u ON u.id = us.user_id
        WHERE lower(u.username) = ? AND us.store_id = ?
        ORDER BY CASE WHEN u.store_id = us.store_id THEN 0 ELSE 1 END, u.id ASC
      `
    )
    .all(username, store.id) as any[];

  let user = matchingUsers[0] ?? null;
  let passwordMatch: boolean;
  if (matchingUsers.length > 1) {
    const passwordChecks = await Promise.all(
      matchingUsers.map(candidate => bcrypt.compare(password, candidate.password ?? DUMMY_HASH))
    );
    const matchedUsers = matchingUsers.filter((_, index) => passwordChecks[index]);
    if (matchedUsers.length > 1) {
      return loginFailure(
        409,
        'Multiple accounts match this username for the selected store. Contact support.'
      );
    }
    // When multiple accessible accounts share the same username for a store,
    // a bad password attempt cannot be attributed safely to a single user.
    if (matchedUsers.length === 0) return loginFailure(401, 'Invalid credentials');
    user = matchedUsers[0];
    passwordMatch = true;
  } else {
    passwordMatch = await bcrypt.compare(password, user?.password ?? DUMMY_HASH);
  }

  return {
    user,
    passwordMatch,
    role: user?.access_role ?? user?.role ?? null,
    storeId: store.id,
    storeName: store.name,
  };
}

// No store code — superadmin only
async function findSuperadminLogin(username: string, password: string): Promise<LoginLookup> {
  const user = db
    .prepare("SELECT * FROM users WHERE lower(username) = ? AND role = 'superadmin'")
    .get(username) as any;
  const passwordMatch = await bcrypt.compare(password, user?.password ?? DUMMY_HASH);
  return {
    user,
    passwordMatch,
    role: user?.role ?? null,
    storeId: user?.store_id ?? null,
    storeName: user?.store_name ?? null,
  };
}

authRouter.post(
  '/login',
  authLimiter,
  asyncRoute(async (req, res) => {
    if (!isRequestBody(req.body)) return res.status(400).json({ error: 'Invalid request body' });
    const { username, password, store_code } = req.body;
    const normalizedUsername = normalizeUsername(username);

    if (
      !normalizedUsername ||
      !password ||
      typeof password !== 'string' ||
      (store_code !== undefined && typeof store_code !== 'string')
    ) {
      return res.status(400).json({ error: 'Username and password are required' });
    }
    if (!store_code && normalizedUsername !== 'superadmin') {
      return res.status(400).json({ error: 'Store Code Required' });
    }

    const lookup = store_code
      ? await findStoreLogin(store_code, normalizedUsername, password)
      : await findSuperadminLogin(normalizedUsername, password);
    if ('failure' in lookup) {
      return res.status(lookup.failure.status).json({ error: lookup.failure.error });
    }
    const { user, passwordMatch } = lookup;
    const loginRole = lookup.role;
    const loginStoreId = lookup.storeId;
    const loginStoreName = lookup.storeName;

    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Check if account is locked. locked_until is stored UTC; a malformed value parses to
    // NaN, which is treated as not locked.
    const lockedUntilMs = user.locked_until ? parseSqliteUtc(user.locked_until) : Number.NaN;
    if (!Number.isNaN(lockedUntilMs) && lockedUntilMs > Date.now()) {
      const minutesLeft = Math.ceil((lockedUntilMs - Date.now()) / 60000);
      return res
        .status(429)
        .json({ error: `Account locked. Try again in ${minutesLeft} minute(s).` });
    }

    if (!passwordMatch) {
      incrementFailedLoginAttempts([user]);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Reset failed attempts on successful login
    db.prepare('UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE id = ?').run(
      user.id
    );

    const sessionUser = {
      ...user,
      role: loginRole ?? user.role,
      store_id: loginStoreId ?? user.store_id,
      store_name: loginStoreName ?? user.store_name,
    };

    const accountSession = buildAccountSessionUser(user.id);
    if (!accountSession) {
      return res.status(404).json({ error: 'User not found' });
    }

    issueJwt(req, res, accountSession);
    writeAuthLog(
      'LOGIN',
      `Signed in as ${sessionUser.username}`,
      sessionUser.id,
      sessionUser.store_id ?? null
    );
    res.json({
      id: sessionUser.id,
      username: sessionUser.username,
      role: sessionUser.role,
      store_name: sessionUser.store_name,
      store_id: sessionUser.store_id,
      must_reset_password: Boolean(sessionUser.must_reset_password),
    });
  })
);

// Google OAuth — start
authRouter.get('/google', authLimiter, (req, res) => {
  const intent = req.query.intent === 'signup' ? 'signup' : 'login';
  const csrfToken = randomBytes(16).toString('hex');
  // Store state nonce in a short-lived httpOnly cookie to prevent CSRF (H-1)
  res.cookie('oauth_state', `${csrfToken}:${intent}`, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 10 * 60 * 1000,
  });
  const url = googleClient.generateAuthUrl({
    access_type: 'offline',
    scope: ['openid', 'email', 'profile'],
    state: csrfToken,
    prompt: 'select_account',
  });
  res.redirect(url);
});

// Google OAuth — callback
authRouter.get(
  '/google/callback',
  asyncRoute(async (req, res) => {
    const { code, state } = req.query as { code: string; state: string };

    // H-1: Validate CSRF state nonce
    const storedState = req.cookies?.oauth_state as string | undefined;
    res.clearCookie('oauth_state');
    if (!storedState || !state || !storedState.startsWith(state + ':')) {
      return res.redirect('/login?error=oauth_failed');
    }

    try {
      const { tokens } = await googleClient.getToken(code);
      // No setCredentials here: verifyIdToken takes the token explicitly, and googleClient is
      // a module-level singleton, so storing per-user credentials on it would let concurrent
      // sign-ins overwrite each other's state.
      const ticket = await googleClient.verifyIdToken({
        idToken: tokens.id_token!,
        audience: process.env.GOOGLE_CLIENT_ID,
      });
      const payload = ticket.getPayload()!;
      const googleId = payload.sub;
      const email = payload.email || '';
      const name = payload.name || '';

      // 1. Look up by oauth_id
      let user = db
        .prepare("SELECT * FROM users WHERE oauth_provider = 'google' AND oauth_id = ?")
        .get(googleId) as any;

      // 2. Fall back to matching by email — only safe to auto-link if:
      //    a) Google verified the email, AND
      //    b) The existing account has no password (was created via OAuth/invite only)
      //    Accounts with passwords must not be silently takeable via Google OAuth.
      if (!user && email && payload.email_verified) {
        const byEmail = db.prepare('SELECT * FROM users WHERE email = ?').get(email) as any;
        if (byEmail && !byEmail.password) {
          db.prepare("UPDATE users SET oauth_provider = 'google', oauth_id = ? WHERE id = ?").run(
            googleId,
            byEmail.id
          );
          user = { ...byEmail, oauth_provider: 'google', oauth_id: googleId };
        }
      }

      if (user) {
        // Check suspension — the password login path does this at line 114, but
        // the OAuth path was missing it, letting suspended owners log in via Google.
        const store = db
          .prepare('SELECT status FROM stores WHERE id = ?')
          .get(user.store_id) as any;
        if (store?.status === 'suspended') return res.redirect('/login?error=suspended');
        const accountSession = buildAccountSessionUser(user.id);
        if (!accountSession) return res.redirect('/login?error=oauth_failed');
        issueJwt(req, res, accountSession);
        writeAuthLog('LOGIN', `Signed in with Google as ${user.username}`, user.id, user.store_id);
        return res.redirect(user.role === 'superadmin' ? '/admin' : '/');
      }

      // New user — save pending profile and redirect to signup
      const key = randomUUID();
      pendingOAuthSet(key, { googleId, email, name, expiresAt: Date.now() + 10 * 60 * 1000 });
      res.redirect(`/signup?pending=${key}`);
    } catch {
      // H-2: Use opaque error code, not raw message
      res.redirect('/login?error=oauth_failed');
    }
  })
);

// Google OAuth — retrieve pending profile (called by signup page)
authRouter.get('/google/pending', authLimiter, (req, res) => {
  const key = req.query.key as string;
  const entry = pendingOAuth.get(key);
  if (!entry || entry.expiresAt < Date.now()) {
    pendingOAuth.delete(key);
    return res
      .status(404)
      .json({ error: 'Session expired. Please try signing in with Google again.' });
  }
  res.json({ email: entry.email, name: entry.name });
});

// Register new store + owner
authRouter.post(
  '/register',
  authLimiter,
  asyncRoute(async (req, res) => {
    if (!isRequestBody(req.body)) return res.status(400).json({ error: 'Invalid request body' });
    const registerFields = [
      'store_name',
      'street',
      'city',
      'zipcode',
      'state',
      'phone',
      'email',
      'username',
      'password',
      'oauth_key',
    ] as const;
    if (!hasOnlyStringFields(req.body, registerFields)) {
      return res.status(400).json({ error: 'Registration fields must be strings' });
    }
    const {
      store_name,
      street,
      city,
      zipcode,
      state,
      phone,
      email,
      username,
      password,
      oauth_key,
    } = req.body;
    const normalizedUsername = normalizeUsername(username);
    const inputError = registrationInputError({
      storeName: store_name,
      username: normalizedUsername,
      password,
      hasOAuthKey: Boolean(oauth_key),
      contact: { street, city, zipcode, phone, email },
    });
    if (inputError) return res.status(400).json({ error: inputError });

    // Username uniqueness is now store-scoped (UNIQUE(username, store_id)); new stores always get a fresh store_id so no pre-check needed

    // Validate OAuth key if provided
    const oauthEntry = oauth_key ? pendingOAuth.get(oauth_key) : null;
    if (oauth_key && (!oauthEntry || oauthEntry.expiresAt < Date.now())) {
      pendingOAuth.delete(oauth_key);
      return res
        .status(400)
        .json({ error: 'Google session expired. Please sign in with Google again.' });
    }

    const hashed = password ? await bcrypt.hash(password, BCRYPT_COST) : null;

    const register = db.transaction(() => {
      // Generate a unique store code (retry on collision, bounded to prevent infinite loop)
      let storeCode = generateStoreCode();
      let codeAttempts = 0;
      while (db.prepare('SELECT id FROM stores WHERE store_code = ?').get(storeCode)) {
        if (++codeAttempts > 10) throw new Error('Could not generate a unique store code');
        storeCode = generateStoreCode();
      }

      const storeInfo = db
        .prepare(
          'INSERT INTO stores (name, street, city, zipcode, state, phone, email, store_code) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        )
        .run(
          store_name,
          street || null,
          city || null,
          zipcode || null,
          state || null,
          phone || '',
          email || '',
          storeCode
        );
      const storeId = storeInfo.lastInsertRowid as number;
      const userInfo = db
        .prepare(
          'INSERT INTO users (username, password, role, store_id, store_name, oauth_provider, oauth_id, email) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        )
        .run(
          normalizedUsername,
          hashed,
          'owner',
          storeId,
          store_name,
          oauthEntry ? 'google' : null,
          oauthEntry ? oauthEntry.googleId : null,
          oauthEntry ? oauthEntry.email : email || null
        );
      const userId = userInfo.lastInsertRowid as number;
      db.prepare(
        'INSERT OR IGNORE INTO user_stores (user_id, store_id, role) VALUES (?, ?, ?)'
      ).run(userId, storeId, 'owner');

      // Seed 4 default categories for the new store
      const catInsert = db.prepare(
        'INSERT INTO categories (name, icon, store_id) VALUES (?, ?, ?)'
      );
      const defaults: [string, string][] = [
        ['Snacks', '/icons/snack.png'],
        ['Beverages', '/icons/soft-drinks.png'],
        ['Candy', '/icons/candy.png'],
        ['Grocery', '/icons/grocery.png'],
      ];
      for (const [name, icon] of defaults) catInsert.run(name, icon, storeId);

      return { storeId, storeCode, userId };
    });

    try {
      const { storeId, storeCode, userId } = register();
      writeAuthLog('CREATE', `Registered store "${store_name}"`, userId, storeId);
      if (oauthEntry) {
        pendingOAuth.delete(oauth_key!);
        const newUser = db
          .prepare("SELECT * FROM users WHERE store_id = ? AND role = 'owner'")
          .get(storeId) as any;
        const accountSession = buildAccountSessionUser(newUser.id);
        if (!accountSession) {
          return res.status(404).json({ error: 'User not found' });
        }
        issueJwt(req, res, accountSession);
        return res.status(201).json({
          message: 'Store registered',
          store_id: storeId,
          store_code: storeCode,
          redirect: '/',
        });
      }
      res.status(201).json({
        message: 'Store registered successfully',
        store_id: storeId,
        store_code: storeCode,
      });
    } catch (err: any) {
      logError('auth:register', err);
      res.status(500).json({ error: 'An internal error occurred' });
    }
  })
);

authRouter.post('/logout', (req, res) => {
  const token = req.cookies?.token;
  if (token) {
    revokeToken(token);
    // Bump token_version so this token is rejected even after the in-memory
    // revocation store is wiped on a server restart.
    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET!, {
        algorithms: ['HS256'],
        issuer: 'opticapture',
        audience: 'opticapture-app',
      }) as { id?: number };
      if (typeof payload.id === 'number') {
        db.prepare('UPDATE users SET token_version = token_version + 1 WHERE id = ?').run(
          payload.id
        );
      }
    } catch {
      // Token already expired or invalid — cookie cleared below regardless
    }
  }
  res.clearCookie('token');
  res.json({ message: 'Logged out' });
});

authRouter.get('/me', authenticateToken, (req: AuthRequest, res) => {
  if (req.user.role === 'superadmin') {
    return res.json({
      id: req.user.id,
      username: req.user.username,
      role: 'superadmin',
      store_id: req.user.store_id ?? null,
      store_name: req.user.store_name ?? 'HQ',
      store_logo: req.user.store_logo ?? null,
      must_reset_password: Boolean(req.user.must_reset_password),
      needs_store_selection: false,
    });
  }

  if (req.user.needs_store_selection || req.user.store_id == null) {
    return res.json({
      id: req.user.id,
      username: req.user.username,
      role: null,
      store_id: null,
      store_name: null,
      store_logo: null,
      must_reset_password: Boolean(req.user.must_reset_password),
      needs_store_selection: true,
    });
  }

  return res.json({
    id: req.user.id,
    username: req.user.username,
    role: req.user.role,
    store_id: req.user.store_id,
    store_name: req.user.store_name,
    store_logo: req.user.store_logo ?? null,
    must_reset_password: Boolean(req.user.must_reset_password),
    needs_store_selection: false,
  });
});

// My stores — list all stores this user has access to
authRouter.get('/my-stores', authenticateToken, (req: AuthRequest, res) => {
  const stores = db
    .prepare(
      `
    SELECT s.id, s.name, s.logo, s.status, us.role
    FROM user_stores us
    JOIN stores s ON s.id = us.store_id
    WHERE us.user_id = ?
    ORDER BY s.name ASC
  `
    )
    .all(req.user.id);
  res.json(stores);
});

// Switch store — validates access so the client can update its active store context
authRouter.post('/switch-store', authenticateToken, (req: AuthRequest, res) => {
  const storeId = Number.parseInt(req.body.store_id);
  if (Number.isNaN(storeId)) return res.status(400).json({ error: 'Invalid store ID' });
  const access = db
    .prepare('SELECT role FROM user_stores WHERE user_id = ? AND store_id = ?')
    .get(req.user.id, storeId) as any;
  if (!access) return res.status(403).json({ error: 'No access to that store' });

  const store = db.prepare('SELECT * FROM stores WHERE id = ?').get(storeId) as any;
  if (!store || store.status === 'suspended')
    return res.status(403).json({ error: 'Store is suspended' });

  res.json({
    success: true,
    store_id: store.id,
    store_name: store.name,
    store_logo: store.logo || null,
    role: access.role,
  });
});

// Store Settings routes live here alongside the account/session endpoints

// Store Settings — get
// Deliberately not gated behind requireOwner: takers open this screen too, and the
// forced temp-password reset flow routes every role here. Instead the store_code —
// which is half of the store-code login credential — is withheld from non-owners.
// The client only renders the store-code card when the field is present.
authRouter.get('/store/settings', authenticateToken, (req: AuthRequest, res) => {
  if (req.user.store_id == null) {
    return res.status(409).json({ error: 'Store selection required', needs_store_selection: true });
  }

  const store = db
    .prepare(
      'SELECT id, name, street, city, zipcode, state, phone, email, status, logo, store_code FROM stores WHERE id = ?'
    )
    .get(req.user.store_id) as any;
  if (!store) return res.status(404).json({ error: 'Store not found' });

  const canSeeStoreCode = req.user.role === 'owner' || req.user.role === 'superadmin';
  res.json(canSeeStoreCode ? store : { ...store, store_code: null });
});

// Store Settings — update store info
authRouter.put('/store/settings', authenticateToken, requireOwner, (req: AuthRequest, res) => {
  if (req.user.store_id == null) {
    return res.status(409).json({ error: 'Store selection required', needs_store_selection: true });
  }

  if (!isRequestBody(req.body)) return res.status(400).json({ error: 'Invalid request body' });
  if (
    !hasOnlyStringFields(req.body, [
      'name',
      'street',
      'city',
      'zipcode',
      'state',
      'phone',
      'email',
      'logo',
    ])
  ) {
    return res.status(400).json({ error: 'Store fields must be strings' });
  }
  const { name, street, city, zipcode, state, phone, email, logo } = req.body;
  const details = { name: name ?? '', street, city, zipcode, state, phone, email };
  const detailsError =
    storeNameError(name) ?? storeFieldLengthError(details) ?? storeContactFormatError(details);
  if (detailsError) return res.status(400).json({ error: detailsError });
  try {
    saveStoreDetails(req.user.store_id, details, logo);
    writeAuthLog(
      'UPDATE',
      `Updated store settings for "${details.name.trim()}"`,
      req.user.id,
      req.user.store_id
    );

    const updatedStore = db
      .prepare(
        'SELECT id, name, street, city, zipcode, state, phone, email, status, logo, store_code FROM stores WHERE id = ?'
      )
      .get(req.user.store_id);

    res.json(updatedStore);
  } catch (error) {
    if (error instanceof UnsupportedImageTypeError) {
      return res.status(400).json({ error: error.message });
    }

    logError('auth:store-settings', error);
    return res.status(500).json({ error: 'An internal error occurred' });
  }
});

// Store Settings — change password
authRouter.put(
  '/store/password',
  authenticateToken,
  asyncRoute<AuthRequest>(async (req: AuthRequest, res) => {
    if (!isRequestBody(req.body)) return res.status(400).json({ error: 'Invalid request body' });
    const { current_password, new_password } = req.body;
    if (
      !current_password ||
      !new_password ||
      typeof current_password !== 'string' ||
      typeof new_password !== 'string'
    )
      return res.status(400).json({ error: 'Both fields are required' });
    if (new_password.length < 8 || !/[A-Z]/.test(new_password) || !/\d/.test(new_password))
      return res.status(400).json({
        error: 'Password must be at least 8 characters with 1 uppercase letter and 1 number',
      });

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id) as any;
    if (!user?.password || !(await bcrypt.compare(current_password, user.password)))
      return res.status(401).json({ error: 'Current password is incorrect' });

    const newVersion = (user.token_version ?? 1) + 1;
    db.prepare(
      'UPDATE users SET password = ?, failed_login_attempts = 0, locked_until = NULL, must_reset_password = 0, token_version = ? WHERE id = ?'
    ).run(await bcrypt.hash(new_password, BCRYPT_COST), newVersion, req.user.id);
    writeAuthLog('PASSWORD', 'Changed account password', req.user.id, req.user.store_id);
    // Re-issue JWT so the current session stays valid and the reset-required flag drops immediately.
    const sessionUser = buildAccountSessionUser(req.user.id);
    if (!sessionUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    issueJwt(req, res, sessionUser);
    res.json({ success: true });
  })
);
