import { Injectable } from '@nestjs/common';
import { toBuffer, toSVG } from 'bwip-js';
import { TraceabilityRuleException } from '../common/errors';
import {
  Symbology,
  SymbologyDimension,
  isSymbology,
  specFor,
} from './symbology';

export type LabelFormat = 'png' | 'svg';

export interface RenderRequest {
  symbology: Symbology;
  value: string;
  /** Module size multiplier. 3 is a good 300dpi label; 2 is a screen preview. */
  scale?: number;
  /** Bar height in millimetres, linear symbologies only. */
  height?: number;
  /** Print the value under the bars. Defaults to what the symbology expects. */
  showText?: boolean;
  format?: LabelFormat;
}

export interface RenderedLabel {
  format: LabelFormat;
  contentType: string;
  body: Buffer | string;
}

/**
 * Renders every symbology the platform prints, through one encoder.
 *
 * There used to be a separate QR renderer here. Two renderers is how a product
 * label and an item label end up disagreeing about margins, and neither of
 * them is the one the label printer was calibrated against - so QR now goes
 * through the same path as everything else, and QrCodeService is a thin call
 * into this.
 */
@Injectable()
export class BarcodeService {
  /** Sensible defaults for a label that will actually be printed and scanned. */
  private static readonly DEFAULT_SCALE = 3;
  private static readonly DEFAULT_BAR_HEIGHT_MM = 12;
  private static readonly DEFAULT_MATRIX_HEIGHT_MM = 24;

  /**
   * A hard ceiling on module size. Scale is caller-supplied and BWIPP will
   * happily allocate whatever is asked for, so an unbounded value is a way to
   * ask the API for a gigabyte-sized PNG.
   */
  private static readonly MAX_SCALE = 10;
  private static readonly MAX_HEIGHT_MM = 100;
  private static readonly MAX_VALUE_LENGTH = 2048;

  async render(request: RenderRequest): Promise<RenderedLabel> {
    const options = this.optionsFor(request);
    const format = request.format ?? 'png';

    try {
      if (format === 'svg') {
        return {
          format,
          contentType: 'image/svg+xml',
          body: toSVG(options),
        };
      }
      return {
        format,
        contentType: 'image/png',
        body: await toBuffer(options),
      };
    } catch (error) {
      // BWIPP reports failures as `bwipp.<rule>#<line>: <message>`. The message
      // is the useful half and the caller has no use for the rule name.
      const detail = (error as Error).message ?? String(error);
      throw new TraceabilityRuleException(
        `Could not render a ${specFor(request.symbology).label}: ${detail.replace(/^bwipp\.\S+:\s*/, '')}`,
      );
    }
  }

  /** PNG bytes, for the callers that only ever want an image. */
  async renderPng(
    symbology: Symbology,
    value: string,
    scale?: number,
  ): Promise<Buffer> {
    const label = await this.render({ symbology, value, scale, format: 'png' });
    return label.body as Buffer;
  }

  /**
   * Validates and normalises without drawing anything, so a form can tell an
   * operator their check digit is wrong while they are still typing.
   */
  check(symbology: Symbology, value: string): { value: string } | { problem: string } {
    const result = specFor(symbology).validate(value ?? '');
    return result.problem !== undefined
      ? { problem: result.problem }
      : { value: result.value! };
  }

  /** Reads a symbology name off the wire, rejecting anything unknown. */
  parseSymbology(raw: string | undefined, fallback: Symbology): Symbology {
    if (raw === undefined || raw === '') {
      return fallback;
    }
    const normalised = raw.trim().toUpperCase();
    if (!isSymbology(normalised)) {
      throw new TraceabilityRuleException(
        `Unknown code type: ${raw}. Ask GET /api/barcodes/symbologies for the list.`,
      );
    }
    return normalised;
  }

  /**
   * Turns a request into BWIPP options: validate the value, then size the
   * symbol for the kind of code it is. A matrix code is square and ignores
   * `height` as a bar length; a linear code needs one or it prints as a smear.
   */
  private optionsFor(request: RenderRequest) {
    const spec = specFor(request.symbology);

    if ((request.value?.length ?? 0) > BarcodeService.MAX_VALUE_LENGTH) {
      throw new TraceabilityRuleException(
        `That is too much data for one label (${request.value.length} characters). A code carries an identifier; the platform holds the detail.`,
      );
    }

    const validation = spec.validate(request.value ?? '');
    if (validation.problem !== undefined) {
      throw new TraceabilityRuleException(validation.problem);
    }

    const linear = spec.dimension === SymbologyDimension.LINEAR;

    return {
      bcid: validation.bcid ?? spec.bcid,
      text: validation.value!,
      scale: clamp(
        request.scale ?? BarcodeService.DEFAULT_SCALE,
        1,
        BarcodeService.MAX_SCALE,
      ),
      height: clamp(
        request.height ??
          (linear
            ? BarcodeService.DEFAULT_BAR_HEIGHT_MM
            : BarcodeService.DEFAULT_MATRIX_HEIGHT_MM),
        5,
        BarcodeService.MAX_HEIGHT_MM,
      ),
      includetext: request.showText ?? spec.printsText,
      ...(validation.alttext ? { alttext: validation.alttext } : {}),
      // Quiet zone. Every one of these standards specifies one, and a label
      // printed without it is the single most common reason a code that looks
      // perfect will not scan.
      paddingwidth: 10,
      paddingheight: 10,
      backgroundcolor: 'FFFFFF',
      textxalign: 'center' as const,
    };
  }
}

function clamp(value: number, low: number, high: number): number {
  if (!Number.isFinite(value)) return low;
  return Math.min(high, Math.max(low, value));
}
