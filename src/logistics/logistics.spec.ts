import {
  ShipmentEventType,
  ShipmentStatus,
  VehicleType,
  canCancel,
  canDeliver,
  canDepart,
} from './logistics.enums';

describe('shipment transitions (proposal section 5 tracking workflow)', () => {
  it('departs only from PENDING', () => {
    expect(canDepart(ShipmentStatus.PENDING)).toBe(true);
    for (const status of [
      ShipmentStatus.IN_TRANSIT,
      ShipmentStatus.DELIVERED,
      ShipmentStatus.CANCELLED,
    ]) {
      expect(canDepart(status)).toBe(false);
    }
  });

  it('delivers only while IN_TRANSIT', () => {
    expect(canDeliver(ShipmentStatus.IN_TRANSIT)).toBe(true);
    expect(canDeliver(ShipmentStatus.PENDING)).toBe(false);
    expect(canDeliver(ShipmentStatus.DELIVERED)).toBe(false);
    expect(canDeliver(ShipmentStatus.CANCELLED)).toBe(false);
  });

  it('cancels only work that has not been delivered', () => {
    expect(canCancel(ShipmentStatus.PENDING)).toBe(true);
    expect(canCancel(ShipmentStatus.IN_TRANSIT)).toBe(true);
    expect(canCancel(ShipmentStatus.DELIVERED)).toBe(false);
    expect(canCancel(ShipmentStatus.CANCELLED)).toBe(false);
  });
});

describe('logistics vocabulary', () => {
  it('covers the tracking workflow steps', () => {
    expect(ShipmentEventType.CREATED).toBeDefined();
    expect(ShipmentEventType.DEPARTED).toBeDefined();
    expect(ShipmentEventType.DELIVERED).toBeDefined();
    expect(ShipmentEventType.CANCELLED).toBeDefined();
  });

  it('covers the vehicle kinds a transporter may hold', () => {
    expect(VehicleType.TRUCK).toBe('TRUCK');
    expect(VehicleType.VAN).toBe('VAN');
    expect(VehicleType.MOTORCYCLE).toBe('MOTORCYCLE');
  });
});