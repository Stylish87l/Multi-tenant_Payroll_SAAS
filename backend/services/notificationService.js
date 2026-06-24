import nodemailer from 'nodemailer';
import twilio from 'twilio'; 
import Handlebars from 'handlebars';
import { Queue } from 'bullmq';
import { trace } from '@opentelemetry/api';
import pRetry from 'p-retry';
import { z } from 'zod';
import logger from '../config/logger.js';
import prisma from '../config/db.js';

// 1. Env Validation
const envSchema = z.object({
  EMAIL_HOST: z.string(),
  EMAIL_PORT: z.coerce.number(),
  EMAIL_USER: z.string(),
  EMAIL_PASS: z.string(),
  EMAIL_FROM: z.string().email(),
  TWILIO_SID: z.string().optional(),
  TWILIO_TOKEN: z.string().optional(),
  TWILIO_FROM: z.string().optional(),
});

const config = envSchema.parse(process.env);

// 2. Transporters & Clients
const emailTransporter = nodemailer.createTransport({
  host: config.EMAIL_HOST,
  port: config.EMAIL_PORT,
  secure: config.EMAIL_PORT === 465,
  auth: { user: config.EMAIL_USER, pass: config.EMAIL_PASS },
});

const smsClient = config.TWILIO_SID ? twilio(config.TWILIO_SID, config.TWILIO_TOKEN) : null;

// 3. Template Registry
const TEMPLATES = {
  invite: {
    email: Handlebars.compile(
      `<h2>Welcome to Payroll!</h2>
       <p>Hi {{name}}, you've been invited. 
       <a href="{{link}}">Accept Invitation</a></p>`
    ),
    sms: Handlebars.compile(`Hello {{name}}, welcome to Payroll. Accept invite here: {{link}}`),
    subject: 'Organization Invitation'
  },
  payslip: {
    email: Handlebars.compile(
      `<h2>Payslip Ready</h2>
       <p>Hi {{name}}, your payslip for {{month}} is available for download.</p>`
    ),
    sms: Handlebars.compile(`Hi {{name}}, your payslip for {{month}} is ready. Log in to view.`),
    subject: 'Monthly Payslip Alert'
  }
};

/**
 * Core Notification Engine
 */
export const sendNotification = async (userId, type, data, channel = 'email') => {
  const tracer = trace.getTracer('notification-service');
  return await tracer.startActiveSpan('sendNotification', async (span) => {
    try {
      // 1. Opt-in Check (NDPC Compliance)
      const prefs = await prisma.notificationPreference.findUnique({ where: { userId } });
      
      // 2. Fallback logic: if SMS requested but not opted in or client missing, use email
      let activeChannel = channel;
      if (activeChannel === 'sms' && (!prefs?.smsOptIn || !smsClient)) {
        logger.warn(`SMS unavailable or opted-out for user ${userId}. Falling back to Email.`);
        activeChannel = 'email';
      }

      const template = TEMPLATES[type];
      if (!template) throw new Error(`Template type ${type} not found`);

      // 3. Delivery Logic with retry
      const result = await pRetry(async () => {
        if (activeChannel === 'email') {
          return await emailTransporter.sendMail({
            from: config.EMAIL_FROM,
            to: data.to,
            subject: template.subject,
            html: template.email(data),
          });
        } else if (activeChannel === 'sms') {
          return await smsClient.messages.create({
            from: config.TWILIO_FROM,
            to: data.to,
            body: template.sms(data),
          });
        }
      }, { 
        retries: 3, 
        onFailedAttempt: error => {
          logger.warn(`Attempt ${error.attemptNumber} failed. ${error.retriesLeft} retries left.`, { userId, type, channel: activeChannel });
        }
      });

      // 4. Telemetry & Logging
      span.setAttributes({
        "notification.userId": userId,
        "notification.type": type,
        "notification.channel": activeChannel,
      });

      logger.info(`Notification Delivered`, { userId, type, channel: activeChannel });
      return result;

    } catch (error) {
      logger.error('Notification Service Error', { message: error.message, userId, stack: error.stack });
      throw error;
    } finally {
      span.end();
    }
  });
};

// --- HELPER WRAPPERS ---
export const sendInvite = async (to, name, link, userId) => {
  return sendNotification(userId, 'invite', { to, name, link });
};

export const sendPayslipAlert = async (to, name, month, userId) => {
  return sendNotification(userId, 'payslip', { to, name, month });
};
