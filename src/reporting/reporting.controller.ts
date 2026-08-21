import { Controller, Get, Param, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { Capability } from '../auth/capabilities';
import { ActingOrg, RequireCapability } from '../common/decorators';
import { Organization } from '../organization/entities/organization.entity';
import { ReportingService } from './reporting.service';

/**
 * Reporting endpoints (proposal section 22). The JSON form serves the screen
 * in-app; the CSV form serves the same rows for download, so the exported
 * report can never contradict what the user just saw.
 */
@ApiTags('Reporting')
@ApiBearerAuth()
@Controller('api/reporting')
export class ReportingController {
  constructor(private readonly reporting: ReportingService) {}

  @Get()
  @RequireCapability(Capability.VIEW_OPERATIONS)
  async list() {
    return { reports: this.reporting.list() };
  }

  @Get(':name')
  @RequireCapability(Capability.VIEW_OPERATIONS)
  async report(@Param('name') name: string, @ActingOrg() organization: Organization) {
    return this.reporting.rows(name, organization);
  }

  @Get(':name/export')
  @RequireCapability(Capability.VIEW_OPERATIONS)
  async export(@Param('name') name: string, @ActingOrg() organization: Organization, @Res() res: Response) {
    const report = await this.reporting.export(name, organization);
    res.setHeader('Content-Type', report.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${report.filename}"`);
    res.send(report.body);
  }
}