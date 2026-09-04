import { MigrationInterface, QueryRunner } from 'typeorm';

/** Referral response targets are chosen by each authority, never hard-coded. */
export class RegulatoryReferralResponseTarget1760300000000 implements MigrationInterface {
  name = 'RegulatoryReferralResponseTarget1760300000000';
  public async up(queryRunner: QueryRunner): Promise<void> { await queryRunner.query(`ALTER TABLE "regulatory_authorities" ADD "referral_response_days" integer`); }
  public async down(queryRunner: QueryRunner): Promise<void> { await queryRunner.query(`ALTER TABLE "regulatory_authorities" DROP COLUMN "referral_response_days"`); }
}
