import { Body, Controller, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators';
import { TraceabilityRuleException } from '../../common/errors';
import { RateLimit } from '../../security/rate-limit.guard';
import { SubmitPublicComplaintDto } from '../dto/public-complaint.dto';
import { UploadedFile as ComplaintPhoto } from '../services/license.service';
import { PublicComplaintService } from '../services/public-complaint.service';

@ApiTags('Public Verification')
@Controller('api/public/complaints')
export class PublicComplaintController {
  constructor(private readonly complaints: PublicComplaintService) {}

  @Post()
  @Public()
  @RateLimit('public-complaint', 5, 60 * 60_000)
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('photo'))
  async submit(@Body() dto: SubmitPublicComplaintDto, @UploadedFile() photo?: ComplaintPhoto) {
    if (!dto.token?.trim()) throw new TraceabilityRuleException('Scan a product before reporting an issue');
    return this.complaints.submit(dto, photo);
  }
}
