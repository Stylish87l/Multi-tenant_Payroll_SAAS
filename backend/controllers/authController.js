import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import prisma from '../config/db.js';
import userSchema from '../schemas/userSchema.js';
import logger from '../config/logger.js';

const SALT_ROUNDS = 12;
const ACCESS_TOKEN_EXPIRY = '15m'; 
const REFRESH_TOKEN_EXPIRY = '7d';

/**
 * Helper: Generate JWT
 * Uses the specific secret passed (Access or Refresh)
 */
const generateToken = (payload, secret, expiry) => {
  if (!secret) {
    logger.error('JWT Secret is missing in generateToken call');
    throw new Error('Secret not configured');
  }
  return jwt.sign(payload, secret, { expiresIn: expiry });
};

/**
 * Register a new User and Company (Tenant)
 */
export const register = async (req, res, next) => {
  try {
    const validatedData = await userSchema.parseAsync(req.body);
    const { email, password, name, role, companyName } = validatedData;

    const existingUser = await prisma.user.findFirst({ where: { email } });
    if (existingUser) {
      return res.status(409).json({ error: 'User with this email already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

    const result = await prisma.$transaction(async (tx) => {
      const company = await tx.company.create({
        data: {
          name: companyName || `${name}'s Org`,
          tin: req.body.tin || null,
        },
      });

      const user = await tx.user.create({
        data: {
          email: email.toLowerCase().trim(),
          name,
          password: hashedPassword,
          role: role || 'ADMIN',
          companyId: company.id,
          status: 'ACTIVE',
        },
      });

      return { user, company };
    });

    const payload = { 
      userId: result.user.id, 
      companyId: result.company.id, 
      role: result.user.role 
    };

    // Generate specific tokens
    const accessToken = generateToken(payload, process.env.JWT_ACCESS_SECRET, ACCESS_TOKEN_EXPIRY);
    const refreshToken = generateToken(payload, process.env.JWT_REFRESH_SECRET, REFRESH_TOKEN_EXPIRY);

    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production', 
      sameSite: 'lax',
      path: '/', 
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    logger.info('New Registration successful', { email: result.user.email });

    return res.status(201).json({
      message: 'Registration successful',
      token: accessToken,
      user: { id: result.user.id, email: result.user.email, role: result.user.role },
    });
  } catch (error) {
    logger.error('Registration Error', { message: error.message });
    next(error);
  }
};

/**
 * Login User
 */
export const login = async (req, res, next) => {
  const { email, password } = req.body;

  try {
    const normalizedEmail = email?.toLowerCase().trim();
    if (!normalizedEmail || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const user = await prisma.user.findFirst({
      where: { email: normalizedEmail },
      include: { company: true },
    });

    if (!user || !(await bcrypt.compare(password, user.password))) {
      logger.warn('Failed login attempt', { email: normalizedEmail });
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    if (user.status !== 'ACTIVE') {
      return res.status(403).json({ error: 'Account is suspended or pending activation' });
    }

    const payload = { 
      userId: user.id, 
      companyId: user.companyId, 
      role: user.role 
    };

    // Correctly using separate secrets
    const accessToken = generateToken(payload, process.env.JWT_ACCESS_SECRET, ACCESS_TOKEN_EXPIRY);
    const refreshToken = generateToken(payload, process.env.JWT_REFRESH_SECRET, REFRESH_TOKEN_EXPIRY);

    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/', 
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
    
    logger.info('User Logged In', { email: user.email, companyId: user.companyId });

    return res.status(200).json({
      token: accessToken,
      user: { 
        id: user.id, 
        name: user.name, 
        role: user.role, 
        companyId: user.companyId 
      },
    });
  } catch (error) {
    logger.error('Login Error', { message: error.message });
    next(error);
  }
};

/**
 * Refresh Token Route
 */
export const refresh = async (req, res) => {
  const refreshToken = req.cookies?.refreshToken;

  if (!refreshToken) {
    logger.warn('Refresh attempt blocked: No token in cookies');
    return res.status(401).json({ error: 'Refresh token missing' });
  }

  try {
    // 1. Verify using the REFRESH secret
    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    
    const payload = { 
      userId: decoded.userId, 
      companyId: decoded.companyId, 
      role: decoded.role 
    };

    // 2. Issue new Access Token using ACCESS secret
    const newAccessToken = generateToken(payload, process.env.JWT_ACCESS_SECRET, ACCESS_TOKEN_EXPIRY);

    return res.status(200).json({
      token: newAccessToken,
      companyId: decoded.companyId
    });
  } catch (error) {
    logger.error('Token Refresh Error', { message: error.message });
    // Clear invalid cookie to prevent infinite 401 loops
    res.clearCookie('refreshToken', { path: '/' });
    return res.status(401).json({ error: 'Invalid or expired refresh token' });
  }
};

/**
 * Logout User
 */
export const logout = (req, res) => {
  res.clearCookie('refreshToken', {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
  });
  return res.status(200).json({ message: 'Logged out successfully' });
};