import 'dotenv/config';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import pkgPrisma from '@prisma/client';
import bcrypt from 'bcrypt';
import { passwordSchema } from '../schemas/authSchema.js';

const { PrismaClient } = pkgPrisma;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const isProd = process.env.NODE_ENV === 'production';

/**
 * SECURITY: this script used to run on EVERY build (`npm run build`) and always created
 * admin@moderntech.com with the hard-coded password "Admin@2026" - in production too.
 *
 *  - Demo company/users/employees are seeded ONLY outside production (or with SEED_DEMO_DATA=true,
 *    in which case SEED_ADMIN_PASSWORD is mandatory).
 *  - Statutory TaxConfig rows are always created if missing, but NEVER overwritten (a deploy must
 *    not clobber edits) unless SEED_FORCE_TAX_CONFIG=true.
 *  - A SUPER_ADMIN is bootstrapped only from SUPER_ADMIN_EMAIL / SUPER_ADMIN_PASSWORD.
 *    (The old seed created none, so no SUPER_ADMIN could exist.)
 */
const seedDemo = process.env.SEED_DEMO_DATA ? process.env.SEED_DEMO_DATA === 'true' : !isProd;
const forceTax = process.env.SEED_FORCE_TAX_CONFIG === 'true';

const SSNIT_CONFIG = {
  employeeRate: 5.5,   // % employee (percentage POINTS, as ssnitCalculator.js expects)
  employerRate: 13,    // % employer
  tier1Rate: 13.5,     // % of base remitted to Tier 1
  tier2Rate: 5,        // % of base remitted to Tier 2
  maxEarnings: 69000,
  minContributionBase: 587.8,
};

// `limit` = bracket WIDTH, not a cumulative threshold (payeCalculator.js).
const PAYE_CONFIG = {
  bands: [
    { limit: 490, rate: 0.0 },
    { limit: 110, rate: 0.05 },
    { limit: 130, rate: 0.1 },
    { limit: 3170, rate: 0.175 },
    { limit: 12100, rate: 0.25 },
    { limit: 14520, rate: 0.3 },
    { limit: null, rate: 0.35 },
  ],
  reliefs: { marriage: 1200, child: 600, oldAge: 1500, agedDependent: 1000, disabilityRate: 0.25 },
};

const upsertTaxConfig = (id, type, config, effectiveFrom = null, year = 2026) =>
  prisma.taxConfig.upsert({
    where: { id },
    update: forceTax ? { config } : {},
    create: { id, companyId: null, year, type, config, effectiveFrom: new Date(effectiveFrom || `${year}-01-01T00:00:00.000Z`) },
  });

const requireStrongPassword = (name, value) => {
  const result = passwordSchema.safeParse(value);
  if (!result.success) throw new Error(`${name} is missing or too weak: ${result.error.issues[0].message}`);
  return value;
};

async function main() {
  console.log('Seeding...');

  await upsertTaxConfig('global-ssnit-2026', 'SSNIT', SSNIT_CONFIG);
  await upsertTaxConfig('global-paye-2026', 'PAYE', PAYE_CONFIG);
  await upsertTaxConfig('global-paye-2026-sep', 'PAYE', {
    bands: [
      { limit: 588, rate: 0.0 },
      { limit: 80, rate: 0.05 },
      { limit: 100, rate: 0.1 },
      { limit: 2900, rate: 0.175 },
      { limit: 16000, rate: 0.25 },
      { limit: 30332, rate: 0.3 },
      { limit: null, rate: 0.35 },
    ],
    reliefs: { marriage: 1200, child: 600, oldAge: 1500, agedDependent: 1000, disabilityRate: 0.25 },
  }, '2026-09-01T00:00:00.000Z');
  console.log(`Tax configs ensured (${forceTax ? 'overwritten' : 'existing rows preserved'}).`);

  if (process.env.SUPER_ADMIN_EMAIL) {
    const password = requireStrongPassword('SUPER_ADMIN_PASSWORD', process.env.SUPER_ADMIN_PASSWORD);
    // User.companyId is NOT NULL, so the platform operator belongs to a platform company.
    let platform = await prisma.company.findFirst({ where: { name: 'Paylio Platform' } });
    if (!platform) platform = await prisma.company.create({ data: { name: 'Paylio Platform' } });
    await prisma.user.upsert({
      where: { email: process.env.SUPER_ADMIN_EMAIL.toLowerCase().trim() },
      update: {},
      create: {
        email: process.env.SUPER_ADMIN_EMAIL.toLowerCase().trim(),
        password: await bcrypt.hash(password, 12),
        name: 'Platform Admin',
        role: 'SUPER_ADMIN',
        companyId: platform.id,
      },
    });
    console.log('SUPER_ADMIN ensured.');
  }

  if (seedDemo) {
    const adminPassword = isProd
      ? requireStrongPassword('SEED_ADMIN_PASSWORD', process.env.SEED_ADMIN_PASSWORD)
      : process.env.SEED_ADMIN_PASSWORD || 'Admin@2026';

    const company = await prisma.company.upsert({
      where: { tin: 'P001234567' },
      update: {},
      create: { name: 'Modern Tech Ghana Ltd', tin: 'P001234567', address: '12th Floor, Heritage Tower, Accra' },
    });

    await prisma.user.upsert({
      where: { email: 'admin@moderntech.com' },
      update: {},
      create: {
        email: 'admin@moderntech.com',
        password: await bcrypt.hash(adminPassword, 12),
        name: 'Richie Stylish',
        role: 'ADMIN',
        companyId: company.id,
      },
    });

    const employees = [
      { name: 'Abena Selorm', email: 'abena@example.com', position: 'Analyst', basicSalary: 2500.0, housingAllowance: 500.0, ssnitNumber: 'S123456789012', ghanaCardPin: 'GHA-721000000-1', isMarried: true, childrenCount: 2 },
      { name: 'Kwame Boateng', email: 'kwame@example.com', position: 'Engineer', basicSalary: 8500.0, housingAllowance: 1200.0, transportAllowance: 800.0, ssnitNumber: 'S123456789013', ghanaCardPin: 'GHA-721000000-2', hasResponsibility: true },
      { name: 'Dr. Akua Addo', email: 'akua@example.com', position: 'Director', basicSalary: 45000.0, ssnitNumber: 'S123456789014', ghanaCardPin: 'GHA-721000000-3', agedDependentsCount: 2 },
    ];
    for (const emp of employees) {
      await prisma.employee.upsert({
        where: { ghanaCardPin: emp.ghanaCardPin },
        update: {},
        create: { ...emp, companyId: company.id, isActive: true },
      });
    }
    console.log('Demo data seeded.');
  } else {
    console.log('Demo data skipped (production).');
  }

  console.log('Seeding completed.');
}

main()
  .catch((e) => { console.error('Seeding failed:', e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); await pool.end(); });
