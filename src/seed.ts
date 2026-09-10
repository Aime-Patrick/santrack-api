import 'reflect-metadata';
import * as bcrypt from 'bcryptjs';
import { DataSource } from 'typeorm';
import { dataSourceOptions } from './config/data-source';

import { User } from './auth/entities/user.entity';
import { UserRole } from './auth/user-role.enum';
import { Organization } from './organization/entities/organization.entity';
import { OrganizationType } from './organization/organization-type.enum';
import { OnboardingStatus, IndustrySector } from './organization/onboarding-status.enum';
import { Product } from './product/entities/product.entity';
import { ProductCategory } from './product/entities/product-category.entity';
import { Location } from './location/entities/location.entity';
import { LocationType } from './location/location-type.enum';
import { Batch } from './batch/entities/batch.entity';
import { BatchStatus } from './batch/batch-status.enum';
import { Department } from './payroll/entities/department.entity';
import { JobPosition } from './payroll/entities/job-position.entity';
import { Employee } from './payroll/entities/employee.entity';
import { EmployeeStatus } from './payroll/payroll.enums';
import { LicenseCategory, License } from './licensing/entities/license.entity';
import { LicensedActivity, LicenseStatus } from './licensing/licensing.enums';
import { RegulatoryAuthority } from './licensing/entities/regulatory-authority.entity';

const ds = new DataSource(dataSourceOptions);

async function exists<T>(repo: any, where: Record<string, any>): Promise<boolean> {
  const count = await repo.count({ where });
  return count > 0;
}

async function seed() {
  await ds.initialize();
  console.log('Database connected.\n');

  const userRepo = ds.getRepository(User);
  const orgRepo = ds.getRepository(Organization);
  const productRepo = ds.getRepository(Product);
  const locationRepo = ds.getRepository(Location);
  const batchRepo = ds.getRepository(Batch);
  const departmentRepo = ds.getRepository(Department);
  const jobPositionRepo = ds.getRepository(JobPosition);
  const employeeRepo = ds.getRepository(Employee);
  const licenseCategoryRepo = ds.getRepository(LicenseCategory);
  const licenseRepo = ds.getRepository(License);
  const authorityRepo = ds.getRepository(RegulatoryAuthority);

  // ─── Organizations ───
  console.log('--- Organizations ---');
  const orgDefs: { name: string; type: OrganizationType; onboardingStatus: OnboardingStatus }[] = [
    { name: 'Rwanda Standards Board',           type: OrganizationType.REGULATOR,  onboardingStatus: OnboardingStatus.APPROVED },
    { name: 'Rwanda Food & Drugs Authority',    type: OrganizationType.REGULATOR,  onboardingStatus: OnboardingStatus.APPROVED },
    { name: 'Rwanda Inspectorate (RICA)',       type: OrganizationType.REGULATOR,  onboardingStatus: OnboardingStatus.APPROVED },
    { name: 'Rwanda Fresh Dairy Ltd',           type: OrganizationType.MANUFACTURER, onboardingStatus: OnboardingStatus.APPROVED },
    { name: 'Kigali Distribution Centre',       type: OrganizationType.WAREHOUSE,   onboardingStatus: OnboardingStatus.APPROVED },
    { name: 'Huye Logistics',                   type: OrganizationType.DISTRIBUTOR, onboardingStatus: OnboardingStatus.APPROVED },
    { name: 'Kimironko Supermarket',            type: OrganizationType.RETAILER,    onboardingStatus: OnboardingStatus.APPROVED },
    // ── Pending applicants — visible in the registration review queue ──
    { name: 'Kigali Beverages Co.',             type: OrganizationType.MANUFACTURER, onboardingStatus: OnboardingStatus.PENDING },
    { name: 'Great Lakes Import Ltd',           type: OrganizationType.DISTRIBUTOR,  onboardingStatus: OnboardingStatus.PENDING },
    { name: 'Rubavu Retail Chain',              type: OrganizationType.RETAILER,     onboardingStatus: OnboardingStatus.CHANGES_REQUESTED },
  ];

  const orgs: Record<string, Organization> = {};
  for (const def of orgDefs) {
    if (!(await exists(orgRepo, { name: def.name }))) {
      const org = orgRepo.create({
        name: def.name,
        type: def.type,
        onboardingStatus: def.onboardingStatus,
        ...(def.onboardingStatus === OnboardingStatus.CHANGES_REQUESTED
          ? { reviewNote: 'Please upload a valid RDB certificate and resubmit.' }
          : {}),
      });
      await orgRepo.save(org);
      console.log(`  Created org: ${def.name} (${def.onboardingStatus})`);
    }
    orgs[def.name] = (await orgRepo.findOne({ where: { name: def.name } }))!;
  }

  // ─── Users ───
  console.log('\n--- Users ---');
  const pw = await bcrypt.hash('admin123', 10);
  const userDefs: {
    email: string;
    passwordHash: string;
    fullName: string;
    role: UserRole;
    orgName: string | null;
  }[] = [
    {
      email: 'admin@santrack.rw',
      passwordHash: pw,
      fullName: 'System Administrator',
      role: UserRole.SYSTEM_ADMIN,
      orgName: null,
    },
    {
      email: 'regulator@rsb.gov.rw',
      passwordHash: await bcrypt.hash('rsb123', 10),
      fullName: 'RSB Standards Admin',
      role: UserRole.ORG_ADMIN,
      orgName: 'Rwanda Standards Board',
    },
    {
      email: 'admin@rfda.gov.rw',
      passwordHash: await bcrypt.hash('fda_admin123', 10),
      fullName: 'Rwanda FDA Admin',
      role: UserRole.ORG_ADMIN,
      orgName: 'Rwanda Food & Drugs Authority',
    },
    {
      email: 'regulator@rica.gov.rw',
      passwordHash: await bcrypt.hash('rica123', 10),
      fullName: 'RICA Inspectorate Admin',
      role: UserRole.ORG_ADMIN,
      orgName: 'Rwanda Inspectorate (RICA)',
    },
    {
      email: 'manufacturer@dairy.rw',
      passwordHash: await bcrypt.hash('mfg123', 10),
      fullName: 'Dairy Manufacturer',
      role: UserRole.ORG_ADMIN,
      orgName: 'Rwanda Fresh Dairy Ltd',
    },
    {
      email: 'warehouse@store.rw',
      passwordHash: await bcrypt.hash('wh123', 10),
      fullName: 'Warehouse Manager',
      role: UserRole.ORG_ADMIN,
      orgName: 'Kigali Distribution Centre',
    },
    {
      email: 'shop@retail.rw',
      passwordHash: await bcrypt.hash('shop123', 10),
      fullName: 'Retail Owner',
      role: UserRole.ORG_ADMIN,
      orgName: 'Kimironko Supermarket',
    },
  ];

  for (const def of userDefs) {
    if (!(await exists(userRepo, { email: def.email }))) {
      const user = userRepo.create({
        email: def.email,
        passwordHash: def.passwordHash,
        fullName: def.fullName,
        role: def.role,
        organization: def.orgName ? orgs[def.orgName] : null,
      });
      await userRepo.save(user);
      console.log(`  Created user: ${def.email} (${def.role})`);
    } else {
      console.log(`  Skipped user: ${def.email} (exists)`);
    }
  }

  // ─── Products ───
  console.log('\n--- Products ---');
  const dairyCategory = await ds.getRepository(ProductCategory).findOne({
    where: { code: 'DAIRY' },
  });
  if (!dairyCategory) {
    throw new Error('DAIRY category missing — run migrations before seeding.');
  }

  const productDefs: { name: string; sku: string }[] = [
    { name: 'Fresh Milk 1L', sku: 'DAI-MLK-001' },
    { name: 'Yogurt 500ml', sku: 'DAI-YGR-001' },
    { name: 'Butter 250g', sku: 'DAI-BTR-001' },
    { name: 'Cheese Block 200g', sku: 'DAI-CHS-001' },
    { name: 'Cream 200ml', sku: 'DAI-CRM-001' },
  ];

  const products: Product[] = [];
  for (const def of productDefs) {
    if (!(await exists(productRepo, { sku: def.sku }))) {
      const product = productRepo.create({
        name: def.name,
        sku: def.sku,
        categoryId: dairyCategory.id,
        category: null,
      });
      await productRepo.save(product);
      console.log(`  Created product: ${def.name}`);
    }
    products.push((await productRepo.findOne({ where: { sku: def.sku } }))!);
  }

  // Older seeds filed dairy SKUs as free-text only. Attach them to DAIRY so
  // every catalogue row used in the demo has a real category.
  await productRepo
    .createQueryBuilder()
    .update(Product)
    .set({ categoryId: dairyCategory.id })
    .where("sku LIKE :prefix", { prefix: 'DAI-%' })
    .andWhere('category_id IS NULL')
    .execute();

  // ─── Locations ───
  console.log('\n--- Locations ---');
  const mfgOrg = orgs['Rwanda Fresh Dairy Ltd'];
  const locationDefs: { name: string; type: LocationType }[] = [
    { name: 'Main Factory', type: LocationType.FACTORY },
    { name: 'Cold Store A', type: LocationType.WAREHOUSE },
    { name: 'Dispatch Bay', type: LocationType.WAREHOUSE },
  ];

  const locations: Location[] = [];
  for (const def of locationDefs) {
    if (!(await exists(locationRepo, { name: def.name, organization: { id: mfgOrg.id } }))) {
      const loc = locationRepo.create({
        name: def.name,
        type: def.type,
        organization: mfgOrg,
      });
      await locationRepo.save(loc);
      console.log(`  Created location: ${def.name}`);
    }
    locations.push(
      (await locationRepo.findOne({ where: { name: def.name, organization: { id: mfgOrg.id } } }))!,
    );
  }

  // ─── Departments ───
  console.log('\n--- Departments ---');
  const deptDefs: { code: string; name: string }[] = [
    { code: 'PRD', name: 'Production' },
    { code: 'QC', name: 'Quality Control' },
    { code: 'WHS', name: 'Warehouse' },
  ];

  const departments: Department[] = [];
  for (const def of deptDefs) {
    if (!(await exists(departmentRepo, { code: def.code, organization: { id: mfgOrg.id } }))) {
      const dept = departmentRepo.create({
        code: def.code,
        name: def.name,
        organization: mfgOrg,
      });
      await departmentRepo.save(dept);
      console.log(`  Created department: ${def.name}`);
    }
    departments.push(
      (await departmentRepo.findOne({ where: { code: def.code, organization: { id: mfgOrg.id } } }))!,
    );
  }

  // ─── Job Positions ───
  console.log('\n--- Job Positions ---');
  const posDefs: { code: string; title: string }[] = [
    { code: 'PM', title: 'Production Manager' },
    { code: 'QO', title: 'Quality Officer' },
    { code: 'WM', title: 'Warehouse Manager' },
  ];

  const positions: JobPosition[] = [];
  for (const def of posDefs) {
    if (!(await exists(jobPositionRepo, { code: def.code, organization: { id: mfgOrg.id } }))) {
      const pos = jobPositionRepo.create({
        code: def.code,
        title: def.title,
        organization: mfgOrg,
      });
      await jobPositionRepo.save(pos);
      console.log(`  Created position: ${def.title}`);
    }
    positions.push(
      (await jobPositionRepo.findOne({ where: { code: def.code, organization: { id: mfgOrg.id } } }))!,
    );
  }

  // ─── Employees ───
  console.log('\n--- Employees ---');
  const empDefs: {
    employeeNumber: string;
    name: string;
    deptIndex: number;
    posIndex: number;
    phone: string;
    salary: string;
  }[] = [
    { employeeNumber: 'EMP-001', name: 'John Mugabo', deptIndex: 0, posIndex: 0, phone: '+250788100001', salary: '350000' },
    { employeeNumber: 'EMP-002', name: 'Alice Nyiraneza', deptIndex: 1, posIndex: 1, phone: '+250788100002', salary: '300000' },
    { employeeNumber: 'EMP-003', name: 'Peter Habimana', deptIndex: 2, posIndex: 2, phone: '+250788100003', salary: '280000' },
  ];

  for (const def of empDefs) {
    if (!(await exists(employeeRepo, { employeeNumber: def.employeeNumber, organization: { id: mfgOrg.id } }))) {
      const emp = employeeRepo.create({
        employeeNumber: def.employeeNumber,
        name: def.name,
        organization: mfgOrg,
        department: departments[def.deptIndex],
        position: positions[def.posIndex],
        status: EmployeeStatus.ACTIVE,
        hireDate: '2024-01-15',
        phone: def.phone,
        baseSalary: def.salary,
      });
      await employeeRepo.save(emp);
      console.log(`  Created employee: ${def.name}`);
    } else {
      console.log(`  Skipped employee: ${def.name} (exists)`);
    }
  }

  // ─── Batches ───
  console.log('\n--- Batches ---');
  const batchDefs: { batchCode: string; productIndex: number; expiresOn: string }[] = [
    { batchCode: 'DAI-2026-001', productIndex: 0, expiresOn: '2026-08-25' },
    { batchCode: 'DAI-2026-002', productIndex: 1, expiresOn: '2026-09-15' },
    { batchCode: 'DAI-2026-003', productIndex: 2, expiresOn: '2026-12-01' },
  ];

  for (const def of batchDefs) {
    if (!(await exists(batchRepo, { batchCode: def.batchCode }))) {
      const batch = batchRepo.create({
        batchCode: def.batchCode,
        product: products[def.productIndex],
        manufacturer: mfgOrg,
        manufacturedOn: '2026-08-15',
        expiresOn: def.expiresOn,
        status: BatchStatus.ACTIVE,
      });
      await batchRepo.save(batch);
      console.log(`  Created batch: ${def.batchCode}`);
    } else {
      console.log(`  Skipped batch: ${def.batchCode} (exists)`);
    }
  }

  // ─── License Category & License ───
  console.log('\n--- Licenses ---');
  // Uses the category the licensing migration installed rather than creating a
  // second one. The seed previously inserted 'MFG-001' alongside the migration's
  // 'MFG', leaving two categories claiming MANUFACTURING and making provisional
  // licence resolution depend on row order. Development data should exercise the
  // real schema, not add to it.
  const mfgCategoryCode = 'MFG';
  const licCategory = await licenseCategoryRepo.findOne({
    where: { code: mfgCategoryCode },
  });
  if (!licCategory) {
    throw new Error(
      `Licence category ${mfgCategoryCode} is missing — run migrations before seeding.`,
    );
  }

  const licNumber = 'LIC-MFG-2026-001';
  if (!(await exists(licenseRepo, { licenseNumber: licNumber }))) {
    const license = licenseRepo.create({
      licenseNumber: licNumber,
      organization: mfgOrg,
      category: licCategory,
      status: LicenseStatus.ACTIVE,
      issuedBy: orgs['Rwanda Business Standards Agency'],
      issuedOn: '2026-01-01',
      expiresOn: '2027-12-31',
    });
    await licenseRepo.save(license);
    console.log(`  Created license: ${licNumber}`);
  } else {
    console.log(`  Skipped license: ${licNumber} (exists)`);
  }

  // ── Licence applications in the RBSA review queue ──────────────────────
  // Two SUBMITTED applications so the "Licence queue" card shows a non-zero
  // count when RBSA logs in. Kigali Beverages and Great Lakes Import applied
  // for manufacturing/distribution licences and are awaiting regulator review.
  const pendingLicDefs: { licenseNumber: string; orgName: string }[] = [
    { licenseNumber: 'LIC-MFG-APP-001', orgName: 'Kigali Beverages Co.' },
    { licenseNumber: 'LIC-DIST-APP-001', orgName: 'Great Lakes Import Ltd' },
  ];
  for (const def of pendingLicDefs) {
    if (!(await exists(licenseRepo, { licenseNumber: def.licenseNumber }))) {
      const applicant = orgs[def.orgName];
      if (applicant) {
        const lic = licenseRepo.create({
          licenseNumber: def.licenseNumber,
          organization: applicant,
          category: licCategory,
          status: LicenseStatus.SUBMITTED,
        });
        await licenseRepo.save(lic);
        console.log(`  Created submitted licence application: ${def.licenseNumber} for ${def.orgName}`);
      }
    } else {
      console.log(`  Skipped licence application: ${def.licenseNumber} (exists)`);
    }
  }

  // ─── Regulatory Authorities ───
  console.log('\n--- Regulatory Authorities ---');

  // RBSA — general-purpose standards authority. Its mandates list every sector
  // so it acts as the final fallback when no specialist authority matches.
  const rbsaOrg = orgs['Rwanda Business Standards Agency'];
  if (!(await exists(authorityRepo, { code: 'RBSA' }))) {
    await authorityRepo.save(authorityRepo.create({
      code: 'RBSA',
      name: 'Rwanda Business Standards Agency',
      operatingOrganization: rbsaOrg,
      isActive: true,
      mandates: Object.values(IndustrySector),
      caseCategories: ['REGISTRATION', 'LICENCE', 'INSPECTION', 'RECALL', 'COMPLAINT'],
      teams: ['Registration', 'Licensing', 'Enforcement', 'Inspections'],
      referralResponseDays: 14,
    }));
    console.log('  Created authority: RBSA (Rwanda Business Standards Agency)');
  } else {
    console.log('  Skipped authority: RBSA (exists)');
  }

  // Rwanda FDA — specialist authority for pharmaceuticals, food/beverage and
  // cosmetics. Sector routing sends applications in those three sectors here
  // instead of to RBSA.
  const fdaOrg = orgs['Rwanda Food & Drugs Authority'];
  if (!(await exists(authorityRepo, { code: 'RFDA' }))) {
    await authorityRepo.save(authorityRepo.create({
      code: 'RFDA',
      name: 'Rwanda Food & Drugs Authority',
      operatingOrganization: fdaOrg,
      isActive: true,
      mandates: [
        IndustrySector.PHARMACEUTICALS,
        IndustrySector.FOOD_AND_BEVERAGE,
        IndustrySector.COSMETICS,
      ],
      caseCategories: ['DRUG_SAFETY', 'FOOD_RECALL', 'LABELLING', 'ADVERSE_EVENT', 'INSPECTION'],
      teams: ['Drug Regulation', 'Food Safety', 'Cosmetics', 'Pharmacovigilance'],
      referralResponseDays: 10,
    }));
    console.log('  Created authority: RFDA (Rwanda Food & Drugs Authority)');
  } else {
    console.log('  Skipped authority: RFDA (exists)');
  }

  // ── Print FDA credentials so developers can log in immediately ──
  console.log('\n--- Rwanda FDA Credentials ---');
  console.log('  Organization : Rwanda Food & Drugs Authority');
  console.log('  Authority code: RFDA');
  console.log('  Login email  : admin@rda.gov.rw');
  console.log('  Password     : fda_admin123');
  console.log('  Sectors      : PHARMACEUTICALS, FOOD_AND_BEVERAGE, COSMETICS');

  console.log('\nSeed complete.');
  await ds.destroy();
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
