import { Controller, Get, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { Capability } from '../auth/capabilities';
import { RequireCapability } from '../common/decorators';
import { BarcodeService, LabelFormat } from './barcode.service';
import { RenderBarcodeDto } from './dto/render-barcode.dto';
import { DEFAULT_SYMBOLOGY, catalogue } from './symbology';

/**
 * Printing labels, in whichever symbology the destination reads.
 *
 * Separate from the product and item controllers because a code is not a
 * product: the same catalogue entry legitimately prints as an EAN-13 on the
 * pack, an ITF-14 on the carton and an SSCC on the pallet, and the label
 * printer needs one endpoint rather than three.
 */
@ApiTags('Barcodes')
@ApiBearerAuth()
@Controller('api/barcodes')
export class BarcodeController {
  constructor(private readonly barcodes: BarcodeService) {}

  /**
   * What the platform can print and what each type is for.
   *
   * This is what the code picker renders, so the descriptions here are the
   * ones an operator reads when deciding between a Data Matrix and a QR.
   */
  @Get('symbologies')
  @RequireCapability(Capability.VIEW_OPERATIONS)
  symbologies() {
    return {
      symbologies: catalogue().map((spec) => ({
        symbology: spec.symbology,
        label: spec.label,
        dimension: spec.dimension,
        use: spec.use,
        purpose: spec.purpose,
        accepts: spec.accepts,
        example: spec.example,
        printsText: spec.printsText,
      })),
      defaults: DEFAULT_SYMBOLOGY,
    };
  }

  /**
   * Checks a value without drawing it, so a form can say "that check digit is
   * wrong" while the operator is still typing rather than after they have
   * printed a thousand labels.
   */
  @Get('check')
  @RequireCapability(Capability.VIEW_OPERATIONS)
  check(@Query('symbology') symbology: string, @Query('value') value: string) {
    const parsed = this.barcodes.parseSymbology(symbology, DEFAULT_SYMBOLOGY.IDENTITY);
    const result = this.barcodes.check(parsed, value ?? '');
    return 'problem' in result
      ? { valid: false, problem: result.problem }
      : { valid: true, encodes: result.value };
  }

  /**
   * Renders one label. PNG for printing and preview, SVG where the label needs
   * to scale without going soft - a pallet placard, or a PDF pack.
   */
  @Get('render')
  @RequireCapability(Capability.VIEW_OPERATIONS)
  async render(
    @Query() query: RenderBarcodeDto,
    @Res() response: Response,
  ): Promise<void> {
    const symbology = this.barcodes.parseSymbology(
      query.symbology,
      DEFAULT_SYMBOLOGY.IDENTITY,
    );
    const format: LabelFormat = query.format === 'svg' ? 'svg' : 'png';

    const label = await this.barcodes.render({
      symbology,
      value: query.value,
      scale: query.scale,
      height: query.height,
      showText: query.showText,
      format,
    });

    response
      .type(label.contentType)
      // Labels are deterministic: the same value in the same symbology is
      // always the same image, so the browser may keep it.
      .setHeader('Cache-Control', 'private, max-age=3600')
      .send(label.body);
  }
}
