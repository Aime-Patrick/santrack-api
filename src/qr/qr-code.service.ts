import { Injectable } from '@nestjs/common';
import { BarcodeService } from '../barcode/barcode.service';
import { Symbology } from '../barcode/symbology';

/**
 * Renders the printable identity label.
 *
 * The payload is the opaque identity token and nothing else. A QR that carried
 * product or manufacturing detail would publish that detail to anyone with a
 * phone camera; instead the code says only "ask the platform about this", and
 * the platform decides what the scanner is allowed to see (proposal section 16).
 *
 * QR is the default, not the only option: an ampoule too small for a QR takes a
 * Data Matrix, and a carton takes an ITF-14. Those come from BarcodeService,
 * which is also what this now calls - one encoder, so every label the platform
 * prints has the same quiet zone and the same module ratio.
 */
@Injectable()
export class QrCodeService {
  constructor(private readonly barcodes: BarcodeService) {}

  /** The identity label. Pass a symbology when the packaging demands one. */
  async generatePng(
    payload: string,
    symbology: Symbology = Symbology.QR,
  ): Promise<Buffer> {
    return this.barcodes.renderPng(symbology, payload);
  }
}
