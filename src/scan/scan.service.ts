import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Batch } from '../batch/entities/batch.entity';
import { TraceableItem } from '../item/entities/traceable-item.entity';
import { Location } from '../location/entities/location.entity';
import { ItemService } from '../item/services/item.service';
import { Organization } from '../organization/entities/organization.entity';
import { Product } from '../product/entities/product.entity';
import { Transfer } from '../transfer/entities/transfer.entity';
import { batchFromGs1, expiryFromGs1, normaliseGtin } from './gtin';

export enum ScanKind {
  /** One of our own QR identities - a unit or a container. */
  ITEM = 'ITEM',
  /** A catalogue product, matched by its manufacturer barcode or SKU. */
  PRODUCT = 'PRODUCT',
  /** A production lot. */
  BATCH = 'BATCH',
  /** A bay, dock or shelf - anywhere stock can sit. */
  LOCATION = 'LOCATION',
  /** A dispatch note. */
  TRANSFER = 'TRANSFER',
  /** Read cleanly, but nothing on this platform answers to it. */
  UNKNOWN = 'UNKNOWN',
}

export interface ScanResult {
  kind: ScanKind;
  /** What the scanner actually read, unchanged. */
  scanned: string;
  itemQrCode?: string;
  productId?: number;
  batchId?: number;
  locationId?: number;
  facilityId?: number;
  transferId?: number;
  /**
   * Whose place this is, when a location was scanned.
   *
   * A location knows its organization, so scanning a destination bay answers
   * "where to?" and "which business?" in one action - the two things a
   * dispatch form otherwise asks for separately.
   */
  organizationId?: number;
  /** Details the code itself carried, beyond the identifier. */
  carried?: {
    gtin?: string;
    batchCode?: string;
    expiresOn?: string;
  };
  /** What this is, in a sentence, for the screen that did the scanning. */
  describes: string;
}

/**
 * Working out what was just scanned.
 *
 * Every scanning screen used to assume the code in front of it was one of our
 * QR identities, which made the platform blind to the barcodes already printed
 * on the goods it handles. A supplier's pallet arrives covered in perfectly
 * good GS1 codes and an operator was still picking the product out of a
 * dropdown.
 *
 * So a scan is resolved rather than assumed: our own identity first, then the
 * manufacturer barcode of a product we stock, then a batch, then a dispatch
 * note. The caller gets told which it was and can react - the same scan box
 * opens an item's history, or starts a goods receipt, or pulls up a delivery.
 *
 * Everything is scoped to what the caller may see. A scan is a question about
 * the platform's data, and answering "that GTIN belongs to Acme's product"
 * would leak another business's catalogue to anyone with a scanner.
 */
@Injectable()
export class ScanService {
  constructor(
    @InjectRepository(Product)
    private readonly products: Repository<Product>,
    @InjectRepository(Batch)
    private readonly batches: Repository<Batch>,
    @InjectRepository(Transfer)
    private readonly transfers: Repository<Transfer>,
    @InjectRepository(Location)
    private readonly locations: Repository<Location>,
    private readonly items: ItemService,
  ) {}

  async resolve(code: string, organization: Organization): Promise<ScanResult> {
    const scanned = code.trim();
    const carried = this.carriedBy(scanned);

    if (!scanned) {
      return { kind: ScanKind.UNKNOWN, scanned, describes: 'Nothing was scanned' };
    }

    const item = await this.findItem(scanned, organization);
    if (item) {
      return {
        kind: ScanKind.ITEM,
        scanned,
        itemQrCode: item.qrCode,
        productId: item.product?.id,
        batchId: item.batch?.id,
        ...(carried ? { carried } : {}),
        describes:
          item.kind === 'PACKAGE'
            ? `${item.code} — a ${(item.packageType ?? 'container').toLowerCase()}`
            : `${item.code} — ${item.product?.name ?? 'a unit'}`,
      };
    }

    const product = await this.findProduct(scanned, organization);
    if (product) {
      return {
        kind: ScanKind.PRODUCT,
        scanned,
        productId: product.id,
        ...(carried ? { carried } : {}),
        describes: `${product.name} (${product.sku}) — a product, not one specific unit`,
      };
    }

    const batch = await this.findBatch(scanned, organization);
    if (batch) {
      return {
        kind: ScanKind.BATCH,
        scanned,
        batchId: batch.id,
        productId: batch.product?.id,
        ...(carried ? { carried } : {}),
        describes: `Batch ${batch.batchCode} of ${batch.product?.name ?? 'a product'}`,
      };
    }

    // Deliberately not scoped to the caller's own organization. Scanning a
    // customer's inbound dock to address a dispatch to it is the point; a
    // location's name and type are not commercially sensitive, and nothing
    // about its contents is returned.
    const location = await this.locations.findOne({
      where: { code: scanned },
      relations: { organization: true },
    });
    if (location) {
      const theirs = location.organization?.id !== organization.id;
      return {
        kind: ScanKind.LOCATION,
        scanned,
        locationId: location.id,
        facilityId: location.facility?.id,
        organizationId: location.organization?.id,
        describes: theirs
          ? `${location.name} at ${location.organization?.name ?? 'another business'}`
          : `${location.name} — one of your own places`,
      };
    }

    const transfer = await this.findTransfer(scanned, organization);
    if (transfer) {
      return {
        kind: ScanKind.TRANSFER,
        scanned,
        transferId: transfer.id,
        describes: `Dispatch ${transfer.reference} to ${transfer.destinationOrganization?.name ?? 'another party'}`,
      };
    }

    return {
      kind: ScanKind.UNKNOWN,
      scanned,
      ...(carried ? { carried } : {}),
      // A GTIN that reads cleanly but matches nothing is the common case at a
      // goods-in bay, and it has an obvious next step - so say it, rather than
      // leaving the operator staring at "not found".
      describes: carried?.gtin
        ? 'A valid product barcode, but no product in your catalogue carries it yet'
        : 'Nothing on the platform answers to this code',
    };
  }

  /** Anything the code carried in its own right, beyond identifying something. */
  private carriedBy(scanned: string) {
    const gtin = normaliseGtin(scanned);
    const batchCode = batchFromGs1(scanned);
    const expiresOn = expiryFromGs1(scanned);

    if (!gtin && !batchCode && !expiresOn) {
      return undefined;
    }
    return {
      ...(gtin ? { gtin } : {}),
      ...(batchCode ? { batchCode } : {}),
      ...(expiresOn ? { expiresOn } : {}),
    };
  }

  /**
   * One of our identities, matched exactly.
   *
   * Exactly, because this resolver's whole job is telling codes apart. The
   * general item lookup falls back to a product's GTIN and returns the first
   * unit of that product - useful when a caller has already decided they are
   * acting on an item, and actively wrong here: a pack's barcode names a kind
   * of thing, and answering it with an arbitrary unit would put the wrong one
   * on a dispatch. A product barcode belongs to the PRODUCT branch below.
   */
  private async findItem(
    scanned: string,
    organization: Organization,
  ): Promise<TraceableItem | null> {
    const item = await this.items.findByIdentity(scanned);
    if (!item) {
      return null;
    }
    // Held by someone else and no part of this caller's history: reported as
    // unknown rather than refused, so a scan never confirms that a code exists
    // in another organization's hands.
    return (await this.items.maySee(item, organization)) ? item : null;
  }

  /**
   * A product of the caller's own catalogue, by manufacturer barcode or SKU.
   *
   * GTINs are compared in canonical form, so the EAN on the pack, the UPC on
   * the North American variant and the ITF-14 on the case all find the same
   * product.
   */
  private async findProduct(
    scanned: string,
    organization: Organization,
  ): Promise<Product | null> {
    const bySku = await this.products.findOne({
      where: { organizationId: organization.id, sku: scanned },
    });
    if (bySku) {
      return bySku;
    }

    const gtin = normaliseGtin(scanned);
    if (!gtin) {
      return null;
    }

    // Compared in memory because the stored value is whatever the operator
    // typed - 12, 13 or 14 digits - and only the normalised forms are
    // comparable. Catalogues are per-organization and small enough for this.
    const candidates = await this.products.find({
      where: { organizationId: organization.id },
    });
    return (
      candidates.find((product) => normaliseGtin(product.gtin ?? '') === gtin) ??
      null
    );
  }

  private async findBatch(
    scanned: string,
    organization: Organization,
  ): Promise<Batch | null> {
    const batch = await this.batches.findOne({
      where: { batchCode: scanned },
      relations: { product: true, manufacturer: true },
    });
    if (!batch) {
      return null;
    }

    // A batch is visible to the business that made it. Everyone else reaches
    // it through an item they hold, which carries its own visibility check.
    return batch.manufacturer?.id === organization.id ? batch : null;
  }

  private async findTransfer(
    scanned: string,
    organization: Organization,
  ): Promise<Transfer | null> {
    const transfer = await this.transfers.findOne({
      where: { reference: scanned },
      relations: { sourceOrganization: true, destinationOrganization: true },
    });
    if (!transfer) {
      return null;
    }

    // Both ends of a dispatch may look it up; nobody else.
    const involved =
      transfer.sourceOrganization?.id === organization.id ||
      transfer.destinationOrganization?.id === organization.id;
    return involved ? transfer : null;
  }
}
