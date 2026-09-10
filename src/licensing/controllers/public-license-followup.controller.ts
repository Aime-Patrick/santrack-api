import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators';
import { PublicFollowUpResponseDto } from '../dto/license.dto';
import { LicenseService, UploadedFile as Upload } from '../services/license.service';

/**
 * Public endpoints for license follow-up condition response flow.
 *
 * Unauthenticated — the token in the URL is the credential.
 * One GET to load the condition, one POST to submit the response.
 */
@ApiTags('License Follow-up (Public)')
@Controller('api/public/license-followup')
export class PublicLicenseFollowUpController {
  constructor(private readonly licenses: LicenseService) {}

  /**
   * Returns the condition details needed to render the response form.
   * If already responded, returns the submission in read-only mode.
   */
  @Get(':token')
  @Public()
  async getCondition(@Param('token') token: string) {
    const f = await this.licenses.getFollowUpByToken(token);
    return {
      id: f.id,
      licenseNumber: f.licenseNumber,
      organizationName: f.organizationName,
      title: f.title,
      description: f.description,
      priority: f.priority,
      dueDate: f.dueDate,
      status: f.status,
      readOnly: f.readOnly,
      // Previous response (populated when readOnly = true)
      businessResponse: f.businessResponse ?? null,
      evidenceFilename: f.evidenceFilename ?? null,
      actionedAt: f.actionedAt ?? null,
      responseTokenExpiresAt: f.responseTokenExpiresAt ?? null,
    };
  }

  /**
   * Accepts the business response through the public token.
   * Consumes the token on success.
   */
  @Post(':token')
  @HttpCode(200)
  @Public()
  @UseInterceptors(FileInterceptor('file'))
  async respond(
    @Param('token') token: string,
    @Body() body: PublicFollowUpResponseDto,
    @UploadedFile() file?: Upload,
  ) {
    // businessResponse may arrive as plain text or JSON string from multipart
    const rawResponse = typeof body.businessResponse === 'string'
      ? body.businessResponse
      : undefined;

    await this.licenses.actionFollowUpByToken(
      token,
      { businessResponse: rawResponse },
      file,
    );
    return { success: true };
  }
}
