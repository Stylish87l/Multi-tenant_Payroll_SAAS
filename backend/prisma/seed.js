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
  await prisma.taxConfig.upsert({
    where: { id: 'global-ssnit-2026' },
    update: {},
    create: {
      id: 'global-ssnit-2026',
      companyId: null, // Global default tenant-less fallback
      year: 2026,
      type: 'SSNIT',
      config: {
        employeeRate: 0.055,  // 5.5% Employee tier 1
        employerRate: 0.13,   // 13% Employer tier 1 & 2
        totalRate: 0.185,
      },
    },
  });

  // Global GRA PAYE Tax Bands (Ghana Income Tax Amendment)
  await prisma.taxConfig.upsert({
    where: { id: 'global-paye-2026' },
    update: {},
    create: {
      id: 'global-paye-2026',
      companyId: null, // Global default tenant-less fallback
      year: 2026,
      type: 'PAYE',
      config: {
        bands: [
          { upTo: 490, rate: 0.0 },
          { upTo: 110, rate: 0.05 },
          { upTo: 130, rate: 0.10 },
          { upTo: 3166.67, rate: 0.175 },
          { upTo: 16103.33, rate: 0.25 },
          { upTo: 30000.00, rate: 0.30 },
          { upTo: null, rate: 0.35 }, // Exceeding amount taxed at 35%
        ],
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