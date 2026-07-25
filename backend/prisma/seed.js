import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import 'dotenv/config';

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log('🌱 Starting database seeding...');

  // 1. Create a Test Company
  const company = await prisma.company.upsert({
    where: { tin: 'P001234567' },
    update: {},
    create: {
      name: 'Modern Tech Ghana Ltd',
      tin: 'P001234567',
      address: '12th Floor, Heritage Tower, Accra',
    },
  });

  // 2. Create an Admin User
  const hashedPassword = await bcrypt.hash('Admin@2026', 12);
  await prisma.user.upsert({
    where: { email: 'admin@moderntech.com' },
    update: { name: 'Richie Stylish' },
    create: {
      email: 'admin@moderntech.com',
      password: hashedPassword,
      name: 'Richie Stylish',
      role: 'ADMIN',
      companyId: company.id,
    },
  });

  // 3. Create Demo Employees
  const employees = [
    {
      name: 'Abena Selorm',
      email: 'abena@example.com',
      basicSalary: 2500.0,
      housingAllowance: 500.0,
      ssnitNumber: 'S123456789012',
      ghanaCardPin: 'GHA-721000000-1',
      isMarried: true,
      childrenCount: 2,
    },
    {
      name: 'Kwame Boateng',
      email: 'kwame@example.com',
      basicSalary: 8500.0,
      housingAllowance: 1200.0,
      transportAllowance: 800.0,
      ssnitNumber: 'S123456789013',
      ghanaCardPin: 'GHA-721000000-2',
      hasResponsibility: true,
    },
    {
      name: 'Dr. Akua Addo',
      email: 'akua@example.com',
      basicSalary: 45000.0,
      ssnitNumber: 'S123456789014',
      ghanaCardPin: 'GHA-721000000-3',
      agedDependentsCount: 2,
    },
  ];

  for (const emp of employees) {
    await prisma.employee.upsert({
      where: { ghanaCardPin: emp.ghanaCardPin },
      update: {},
      create: {
        ...emp,
        companyId: company.id,
        isActive: true,
      },
    });
  }

  // 4. Seed 2026 Global Tax Configurations (Fixes the runPayroll Fallback)
  console.log('📊 Seeding global tax configurations for 2026...');

  // Global SSNIT Config
  //
  // FIXED (critical): ssnitCalculator.js's DEFAULT_CONFIG and calcRate()
  // both expect employeeRate/employerRate/tier1Rate/tier2Rate expressed as
  // PERCENTAGE POINTS (e.g. 5.5 meaning 5.5%), because calcRate() does
  // `BigInt(Math.round(rate * 100)) / 10000n`. This previously seeded
  // 0.055 / 0.13 (fractional form), which calcRate() then treated as
  // 0.055% and 0.13% - i.e. every SSNIT deduction computed against this
  // seeded config was ~100x too small the moment it was written to the DB
  // (dbConfig is preferred over DEFAULT_CONFIG whenever it exists). Also
  // added the tier1Rate/tier2Rate/maxEarnings/minContributionBase keys
  // that ssnitCalculator.js's remittance breakdown and cap/floor logic
  // read, so the seeded config is now a complete, self-consistent override
  // rather than one that silently depends on DEFAULT_CONFIG for half its
  // fields.
  await prisma.taxConfig.upsert({
    where: { id: 'global-ssnit-2026' },
    update: {
      config: {
        employeeRate: 5.5, // 5.5% Employee (Tier 1)
        employerRate: 13, // 13% Employer (Tier 1 + Tier 2 combined remittance)
        tier1Rate: 13.5, // % of base remitted to Tier 1 (SSNIT)
        tier2Rate: 5, // % of base remitted to Tier 2 (private trustee)
        maxEarnings: 69000, // GHS 69,000 monthly insurable earnings cap (2026)
        minContributionBase: 490, // 2026 minimum wage floor
      },
    },
    create: {
      id: 'global-ssnit-2026',
      companyId: null, // Global default tenant-less fallback
      year: 2026,
      type: 'SSNIT',
      config: {
        employeeRate: 5.5,
        employerRate: 13,
        tier1Rate: 13.5,
        tier2Rate: 5,
        maxEarnings: 69000,
        minContributionBase: 490,
      },
    },
  });

  // Global GRA PAYE Tax Bands (Ghana Income Tax Amendment)
  //
  // FIXED (critical): payeCalculator.js's band-walking loop reads
  // `band.limit` (each entry represents the WIDTH of that bracket, not a
  // cumulative threshold - see the comment in payeCalculator.js's
  // DEFAULT_BANDS). This previously seeded the key as `upTo`, so every
  // `band.limit` resolved to `undefined` once this config was loaded from
  // the DB (which payeCalculator.js prefers over its own DEFAULT_BANDS).
  // `BigInt(Math.round(undefined * 100))` throws
  // `RangeError: The number NaN cannot be converted to a BigInt`,
  // meaning the FIRST payroll run against a freshly seeded database always
  // crashed. Renamed to `limit` and switched values to bracket WIDTHS
  // (matching DEFAULT_BANDS exactly) rather than cumulative thresholds -
  // the old `upTo` values were cumulative (3166.67, 16103.33, 30000.00),
  // which is a different (and also incompatible) shape from what the
  // calculator expects.
  await prisma.taxConfig.upsert({
    where: { id: 'global-paye-2026' },
    update: {
      config: {
        bands: [
          { limit: 490, rate: 0.0 },
          { limit: 110, rate: 0.05 },
          { limit: 130, rate: 0.1 },
          { limit: 3170, rate: 0.175 }, // width for 730 -> 3,900
          { limit: 12100, rate: 0.25 }, // width for 3,900 -> 16,000
          { limit: 14520, rate: 0.3 }, // width for 16,000 -> 30,520
          { limit: null, rate: 0.35 }, // remainder above 30,520
        ],
        reliefs: {
          marriage: 1200,
          child: 600,
          oldAge: 1500,
          agedDependent: 1000,
          disabilityRate: 0.25,
        },
      },
    },
    create: {
      id: 'global-paye-2026',
      companyId: null, // Global default tenant-less fallback
      year: 2026,
      type: 'PAYE',
      config: {
        bands: [
          { limit: 490, rate: 0.0 },
          { limit: 110, rate: 0.05 },
          { limit: 130, rate: 0.1 },
          { limit: 3170, rate: 0.175 },
          { limit: 12100, rate: 0.25 },
          { limit: 14520, rate: 0.3 },
          { limit: null, rate: 0.35 },
        ],
        reliefs: {
          marriage: 1200,
          child: 600,
          oldAge: 1500,
          agedDependent: 1000,
          disabilityRate: 0.25,
        },
      },
    },
  });

  console.log('✅ Seeding completed successfully.');
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
