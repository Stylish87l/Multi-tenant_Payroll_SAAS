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

  // 2. Create an Admin User (Renamed to Richie Stylish)
  const hashedPassword = await bcrypt.hash('Admin@2026', 12);
  const admin = await prisma.user.upsert({
    where: { email: 'admin@moderntech.com' },
    update: { name: 'Richie Stylish' }, // Ensuring the name stays consistent
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

  console.log('✅ Seeding completed successfully.');
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end(); // Cleanly close the pg pool
  });