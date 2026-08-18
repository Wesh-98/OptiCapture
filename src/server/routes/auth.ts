import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomBytes, randomUUID } from 'node:crypto';
import { db } from '../db.js';
import { authenticateToken, authLimiter, googleClient, requireOwner } from '../middleware.js';
import { revokeToken, pendingOAuth, pendingOAuthSet, DUMMY_HASH } from '../cache.js';
import { saveBase64Image, generateStoreCode, UnsupportedImageTypeError } from '../helpers.js';
import type { AuthRequest } from '../types.js';

export const authRouter = express.Router();

function normalizeUsername(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function incrementFailedLoginAttempts(users: any[]) {
  const uniqueUsers = new Map<number, any>();
  for (const user of users) {
    if (user?.id != null) uniqueUsers.set(user.id, user);
  }

  const updateUser = db.prepare(
    'UPDATE users SET failed_login_attempts = ?, locked_until = ? WHERE id = ?'
  );

  for (const user of uniqueUsers.values()) {
    const newAttempts = (user.failed_login_attempts || 0) + 1;
    const lockedUntil =
      newAttempts >= 5 ? new Date(Date.now() + 15 * 60 * 1000).toISOString() : null;
    updateUser.run(newAttempts, lockedUntil, user.id);
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

authRouter.post('/login', authLimiter, async (req, res) => {
  const { username, password, store_code } = req.body;
  const normalizedUsername = normalizeUsername(username);

  if (!normalizedUsername || !password || typeof password !== 'string') {
    return res.status(400).json({ error: 'Username and password are required' });
  }
  if (!store_code && normalizedUsername !== 'superadmin') {
    return res.status(400).json({ error: 'Store Code Required' });
  }

  let user: any;
  let passwordMatch: boolean;
  let loginRole: string | null = null;
  let loginStoreId: number | null = null;
  let loginStoreName: string | null = null;

  if (store_code) {
    const store = db
      .prepare('SELECT id, name, status FROM stores WHERE store_code = ?')
      .get(store_code) as any;
    if (!store) return res.status(401).json({ error: 'Invalid store code' });
    if (store.status === 'suspended') {
      return res.status(403).json({ error: 'Store account suspended' });
    }

    const matchingUsers = db
      .prepare(
        `
        SELECT u.*, us.role AS access_role
        FROM user_stores us
        JOIN users u ON u.id = us.user_id
        WHERE u.username = ? AND us.store_id = ?
        ORDER BY CASE WHEN u.store_id = us.store_id THEN 0 ELSE 1 END, u.id ASC
      `
      )
      .all(normalizedUsername, store.id) as any[];

    if (matchingUsers.length > 1) {
      const matchedUsers: any[] = [];
      for (const candidate of matchingUsers) {
        const matchesPassword = await bcrypt.compare(password, candidate.password ?? DUMMY_HASH);
        if (!matchesPassword) continue;
        matchedUsers.push(candidate);
      }

      if (matchedUsers.length > 1) {
        return res.status(409).json({
          error: 'Multiple accounts match this username for the selected store. Contact support.',
        });
      }

      if (matchedUsers.length === 1) {
        user = matchedUsers[0];
        passwordMatch = true;
      } else {
        // When multiple accessible accounts share the same username for a store,
        // a bad password attempt cannot be attributed safely to a single user.
        return res.status(401).json({ error: 'Invalid credentials' });
      }
    } else {
      user = matchingUsers[0] ?? null;
      passwordMatch = await bcrypt.compare(password, user?.password ?? DUMMY_HASH);
    }

    if (user) {
      loginRole = user.access_role ?? user.role;
      loginStoreId = store.id;
      loginStoreName = store.name;
    }
  } else {
    // No store code — superadmin only
    user = db
      .prepare("SELECT * FROM users WHERE username = ? AND role = 'superadmin'")
      .get(normalizedUsername);
    passwordMatch = await bcrypt.compare(password, user?.password ?? DUMMY_HASH);
    if (user) {
      loginRole = user.role;
      loginStoreId = user.store_id;
      loginStoreName = user.store_name;
    }
  }

  if (!user) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  // Check if account is locked. Use Date.parse so a malformed locked_until string (which
  // produces NaN) never silently bypasses the lockout check.
  const lockedUntilMs = user.locked_until ? Date.parse(user.locked_until) : NaN;
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
  res.json({
    id: sessionUser.id,
    username: sessionUser.username,
    role: sessionUser.role,
    store_name: sessionUser.store_name,
    store_id: sessionUser.store_id,
    must_reset_password: Boolean(sessionUser.must_reset_password),
  });
});

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
authRouter.get('/google/callback', async (req, res) => {
  const { code, state } = req.query as { code: string; state: string };

  // H-1: Validate CSRF state nonce
  const storedState = req.cookies?.oauth_state as string | undefined;
  res.clearCookie('oauth_state');
  if (!storedState || !state || !storedState.startsWith(state + ':')) {
    return res.redirect('/login?error=oauth_failed');
  }

  try {
    const { tokens } = await googleClient.getToken(code);
    googleClient.setCredentials(tokens);
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
      const store = db.prepare('SELECT status FROM stores WHERE id = ?').get(user.store_id) as any;
      if (store?.status === 'suspended') return res.redirect('/login?error=suspended');
      const accountSession = buildAccountSessionUser(user.id);
      if (!accountSession) return res.redirect('/login?error=oauth_failed');
      issueJwt(req, res, accountSession);
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
});

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
authRouter.post('/register', authLimiter, async (req, res) => {
  const { store_name, street, city, zipcode, state, phone, email, username, password, oauth_key } =
    req.body;
  const normalizedUsername = normalizeUsername(username);
  if (!store_name || !normalizedUsername)
    return res.status(400).json({ error: 'Store name and username are required' });
  if (store_name.length > 100)
    return res.status(400).json({ error: 'Store name must be 100 characters or fewer' });
  if (normalizedUsername.length > 50)
    return res.status(400).json({ error: 'Username must be 50 characters or fewer' });
  if (street && street.length > 200)
    return res.status(400).json({ error: 'Street address must be 200 characters or fewer' });
  if (city && city.length > 100)
    return res.status(400).json({ error: 'City/Town must be 100 characters or fewer' });
  if (email && email.length > 200)
    return res.status(400).json({ error: 'Email must be 200 characters or fewer' });
  if (!password && !oauth_key) return res.status(400).json({ error: 'Password is required' });
  if (password && (password.length < 8 || !/[A-Z]/.test(password) || !/\d/.test(password)))
    return res.status(400).json({
      error: 'Password must be at least 8 characters with 1 uppercase letter and 1 number',
    });
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return res.status(400).json({ error: 'Invalid email address' });
  if (phone && !/^\d{10}$/.test(phone.replaceAll(/\D/g, '')))
    return res.status(400).json({ error: 'Phone must be 10 digits' });
  if (zipcode && !/^\d{5}(-\d{4})?$/.test(zipcode))
    return res.status(400).json({ error: 'Zipcode format: 12345 or 12345-6789' });

  // Username uniqueness is now store-scoped (UNIQUE(username, store_id)); new stores always get a fresh store_id so no pre-check needed

  // Validate OAuth key if provided
  const oauthEntry = oauth_key ? pendingOAuth.get(oauth_key) : null;
  if (oauth_key && (!oauthEntry || oauthEntry.expiresAt < Date.now())) {
    pendingOAuth.delete(oauth_key);
    return res
      .status(400)
      .json({ error: 'Google session expired. Please sign in with Google again.' });
  }

  const hashed = password ? await bcrypt.hash(password, 12) : null;

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
    db.prepare('INSERT OR IGNORE INTO user_stores (user_id, store_id, role) VALUES (?, ?, ?)').run(
      userId,
      storeId,
      'owner'
    );

    // Seed 4 default categories for the new store
    const catInsert = db.prepare('INSERT INTO categories (name, icon, store_id) VALUES (?, ?, ?)');
    const defaults: [string, string][] = [
      ['Snacks', '/icons/snack.png'],
      ['Beverages', '/icons/soft-drinks.png'],
      ['Candy', '/icons/candy.png'],
      ['Grocery', '/icons/grocery.png'],
    ];
    for (const [name, icon] of defaults) catInsert.run(name, icon, storeId);

    return { storeId, storeCode };
  });

  try {
    const { storeId, storeCode } = register();
    if (oauthEntry) {
      pendingOAuth.delete(oauth_key);
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
    res
      .status(201)
      .json({ message: 'Store registered successfully', store_id: storeId, store_code: storeCode });
  } catch (err: any) {
    console.error('[auth:register]', err);
    res.status(500).json({ error: 'An internal error occurred' });
  }
});

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

  const { name, street, city, zipcode, state, phone, email, logo } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Store name is required' });
  if (name.length > 100)
    return res.status(400).json({ error: 'Store name must be 100 characters or fewer' });
  if (street && street.length > 200)
    return res.status(400).json({ error: 'Street address must be 200 characters or fewer' });
  if (city && city.length > 100)
    return res.status(400).json({ error: 'City/Town must be 100 characters or fewer' });
  if (email && email.length > 200)
    return res.status(400).json({ error: 'Email must be 200 characters or fewer' });
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return res.status(400).json({ error: 'Invalid email address' });
  if (phone && !/^\d{10}$/.test(phone.replaceAll(/\D/g, '')))
    return res.status(400).json({ error: 'Phone must be 10 digits' });
  if (zipcode && !/^\d{5}(-\d{4})?$/.test(zipcode))
    return res.status(400).json({ error: 'Zipcode format: 12345 or 12345-6789' });
  try {
    const savedLogo = logo ? saveBase64Image(logo) : null;
    db.prepare(
      'UPDATE stores SET name = ?, street = ?, city = ?, zipcode = ?, state = ?, phone = ?, email = ?, logo = ? WHERE id = ?'
    ).run(
      name.trim(),
      street || null,
      city || null,
      zipcode || null,
      state || null,
      phone || null,
      email || null,
      savedLogo,
      req.user.store_id
    );
    db.prepare('UPDATE users SET store_name = ? WHERE store_id = ?').run(
      name.trim(),
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

    console.error('[auth:store-settings]', error);
    return res.status(500).json({ error: 'An internal error occurred' });
  }
});

// Store Settings — change password
authRouter.put('/store/password', authenticateToken, async (req: AuthRequest, res) => {
  const { current_password, new_password } = req.body;
  if (!current_password || !new_password)
    return res.status(400).json({ error: 'Both fields are required' });
  if (new_password.length < 8 || !/[A-Z]/.test(new_password) || !/\d/.test(new_password))
    return res.status(400).json({
      error: 'Password must be at least 8 characters with 1 uppercase letter and 1 number',
    });

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id) as any;
  if (!user || !(await bcrypt.compare(current_password, user.password)))
    return res.status(401).json({ error: 'Current password is incorrect' });

  const newVersion = (user.token_version ?? 1) + 1;
  db.prepare(
    'UPDATE users SET password = ?, failed_login_attempts = 0, locked_until = NULL, must_reset_password = 0, token_version = ? WHERE id = ?'
  ).run(await bcrypt.hash(new_password, 12), newVersion, req.user.id);
  // Re-issue JWT so the current session stays valid and the reset-required flag drops immediately.
  const sessionUser = buildAccountSessionUser(req.user.id);
  if (!sessionUser) {
    return res.status(404).json({ error: 'User not found' });
  }

  issueJwt(req, res, sessionUser);
  res.json({ success: true });
});
