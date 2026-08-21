/**
 * Logistics module vocabulary (technical proposal section 5, and the
 * "Dispatch -> Shipment -> Tracking -> Proof of Delivery" flow). The existing
 * transfer module moves custody between parties; the shipment is how the
 * goods physically travel - which transporter, vehicle and driver carried
 * them, over which route, and when they were confirmed delivered.
 *
 * The transition guards below are the tracking workflow in one table, so the
 * service can state what it allows and the tests can pin the rules down
 * without a database.
 */

/** Where a shipment sits in the tracking lifecycle. */
export enum ShipmentStatus {
  /** Booked and assigned a transporter, but not on the road yet. */
  PENDING = 'PENDING',
  /** Left the source location and is being tracked. */
  IN_TRANSIT = 'IN_TRANSIT',
  /** Confirmed delivered, with proof of delivery recorded. */
  DELIVERED = 'DELIVERED',
  /** Abandoned before delivery; the goods never travelled under it. */
  CANCELLED = 'CANCELLED',
}

/** Steps in a shipment's own tracking history. Append-only, like events. */
export enum ShipmentEventType {
  CREATED = 'CREATED',
  DEPARTED = 'DEPARTED',
  DELIVERED = 'DELIVERED',
  CANCELLED = 'CANCELLED',
}

export enum VehicleType {
  TRUCK = 'TRUCK',
  VAN = 'VAN',
  TRAILER = 'TRAILER',
  PICKUP = 'PICKUP',
  MOTORCYCLE = 'MOTORCYCLE',
  OTHER = 'OTHER',
}

// ------------------------------------------------------- transition guards

export function canDepart(status: ShipmentStatus): boolean {
  return status === ShipmentStatus.PENDING;
}

export function canDeliver(status: ShipmentStatus): boolean {
  return status === ShipmentStatus.IN_TRANSIT;
}

export function canCancel(status: ShipmentStatus): boolean {
  return (
    status === ShipmentStatus.PENDING ||
    status === ShipmentStatus.IN_TRANSIT
  );
}