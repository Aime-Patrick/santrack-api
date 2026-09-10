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
import { RespondToInfoRequestDto } from '../dto/organization.dto';
import {
  OrganizationService,
  UploadedFile as DocUpload,
} from '../services/organization.service';

/**
 * Public endpoints for the applicant response flow.
 *
 * These routes are explicitly unauthenticated — the token in the URL is the
 * auth mechanism. All other organization routes require a JWT.
 */
@ApiTags('Registration Info Requests (Public)')
@Controller('api/public/registration-response')
export class PublicRegistrationResponseController {
  constructor(private readonly organizations: OrganizationService) {}

  /**
   * Validates the token and returns the request metadata needed to render
   * the dynamic response form on the frontend.
   */
  @Get(':token')
  @Public()
  async getRequest(@Param('token') token: string) {
    const req = await this.organizations.getInfoRequestByToken(token);
    return {
      id: req.id,
      organizationName: req.organizationName,
      requestMessage: req.requestMessage,
      requestedFields: req.requestedFields,
      expiresAt: req.expiresAt,
      status: req.status,
      readOnly: req.readOnly,
      responseData: req.responseData ?? null,
      responseAttachmentFilename: req.responseAttachmentFilename ?? null,
      respondedAt: req.respondedAt ?? null,
    };
  }

  /**
   * Accepts the applicant's response. The token is consumed (marked RESPONDED)
   * after this call — subsequent calls with the same token are rejected.
   *
   * Accepts a multipart/form-data body so an optional file can accompany the
   * text fields. Plain JSON also works when no file is attached.
   */
  @Post(':token')
  @HttpCode(200)
  @Public()
  @UseInterceptors(FileInterceptor('file'))
  async respond(
    @Param('token') token: string,
    @Body() body: RespondToInfoRequestDto,
    @UploadedFile() file?: DocUpload,
  ) {
    // responseData may arrive as a JSON string from multipart form
    let responseData: Record<string, string> | null = null;
    const raw = body.responseData;
    if (typeof raw === 'string') {
      try {
        responseData = JSON.parse(raw) as Record<string, string>;
      } catch {
        responseData = null;
      }
    } else if (raw && typeof raw === 'object') {
      responseData = raw as Record<string, string>;
    }

    await this.organizations.respondToInfoRequest(token, responseData, file);
    return { success: true };
  }
}
