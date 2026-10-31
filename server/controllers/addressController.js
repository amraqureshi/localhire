const prisma = require('../config/prisma');

const validLatitude = (value) => {
  const num = Number(value);
  return Number.isFinite(num) && num >= -90 && num <= 90;
};

const validLongitude = (value) => {
  const num = Number(value);
  return Number.isFinite(num) && num >= -180 && num <= 180;
};

exports.getCurrentLocation = async (req, res) => {
  try {
    const location = await prisma.customerLocation.findUnique({ where: { userId: req.user.id } });
    return res.json({ success: true, location });
  } catch (error) {
    console.error('[Address Controller] getCurrentLocation error:', error);
    return res.status(500).json({ success: false, message: 'Could not retrieve your selected location.' });
  }
};

exports.saveCurrentLocation = async (req, res) => {
  try {
    const { latitude, longitude, addressLabel } = req.body || {};
    if (!validLatitude(latitude) || !validLongitude(longitude)) {
      return res.status(400).json({ success: false, message: 'Valid latitude and longitude are required.' });
    }
    if (addressLabel !== undefined && (typeof addressLabel !== 'string' || addressLabel.length > 500)) {
      return res.status(400).json({ success: false, message: 'Address label must be text no longer than 500 characters.' });
    }

    const location = await prisma.customerLocation.upsert({
      where: { userId: req.user.id },
      create: {
        userId: req.user.id,
        latitude: Number(latitude),
        longitude: Number(longitude),
        addressLabel: addressLabel?.trim() || null,
        lastLocationUpdate: new Date()
      },
      update: {
        latitude: Number(latitude),
        longitude: Number(longitude),
        addressLabel: addressLabel?.trim() || null,
        lastLocationUpdate: new Date()
      }
    });

    return res.json({ success: true, location });
  } catch (error) {
    console.error('[Address Controller] saveCurrentLocation error:', error);
    return res.status(500).json({ success: false, message: 'Could not save your selected location.' });
  }
};

const normalizeAddressInput = (reqBody = {}) => {
  const {
    label,
    flatNumber,
    street,
    landmark,
    city,
    state,
    postalCode,
    latitude,
    longitude,
    isDefault
  } = reqBody;

  return {
    label: typeof label === 'string' && label.trim() ? label.trim() : 'Home',
    flatNumber: flatNumber === undefined || flatNumber === null || flatNumber === '' ? null : String(flatNumber).trim(),
    street: typeof street === 'string' ? street.trim() : '',
    landmark: landmark === undefined || landmark === null || landmark === '' ? null : String(landmark).trim(),
    city: typeof city === 'string' ? city.trim() : '',
    state: state === undefined || state === null || state === '' ? null : String(state).trim(),
    postalCode: typeof postalCode === 'string' ? postalCode.trim() : '',
    latitude: latitude === undefined || latitude === null || latitude === '' ? null : Number(latitude),
    longitude: longitude === undefined || longitude === null || longitude === '' ? null : Number(longitude),
    isDefault: Boolean(isDefault)
  };
};

const ensureSingleDefaultAddress = async (tx, customerId, addressId) => {
  await tx.customerAddress.updateMany({
    where: { customerId, isDefault: true, id: { not: addressId } },
    data: { isDefault: false }
  });

  await tx.customerAddress.update({
    where: { id: addressId },
    data: { isDefault: true }
  });
};

exports.getMyAddresses = async (req, res) => {
  try {
    const addresses = await prisma.customerAddress.findMany({
      where: { customerId: req.user.id },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }]
    });

    return res.json({ success: true, count: addresses.length, addresses });
  } catch (error) {
    console.error('[Address Controller] getMyAddresses error:', error);
    return res.status(500).json({ success: false, message: 'Server error retrieving addresses', error: error.message });
  }
};

exports.createAddress = async (req, res) => {
  try {
    const customerId = req.user.id;
    const normalized = normalizeAddressInput(req.body);

    if (!normalized.street || !normalized.city || !normalized.postalCode) {
      return res.status(400).json({
        success: false,
        message: 'Street, city, and postal code are required for a customer address.'
      });
    }

    if (normalized.latitude !== null && !validLatitude(normalized.latitude)) {
      return res.status(400).json({
        success: false,
        message: 'Latitude must be a valid value between -90 and 90 degrees.'
      });
    }

    if (normalized.longitude !== null && !validLongitude(normalized.longitude)) {
      return res.status(400).json({
        success: false,
        message: 'Longitude must be a valid value between -180 and 180 degrees.'
      });
    }

    const existingDefault = await prisma.customerAddress.findFirst({
      where: { customerId, isDefault: true }
    });

    const address = await prisma.$transaction(async (tx) => {
      const created = await tx.customerAddress.create({
        data: {
          customerId,
          label: normalized.label,
          flatNumber: normalized.flatNumber,
          street: normalized.street,
          landmark: normalized.landmark,
          city: normalized.city,
          state: normalized.state,
          postalCode: normalized.postalCode,
          latitude: normalized.latitude,
          longitude: normalized.longitude,
          isDefault: normalized.isDefault || !existingDefault
        }
      });

      if (normalized.isDefault || !existingDefault) {
        await ensureSingleDefaultAddress(tx, customerId, created.id);
      }

      return created;
    });

    return res.status(201).json({ success: true, message: 'Address saved successfully.', address });
  } catch (error) {
    console.error('[Address Controller] createAddress error:', error);
    return res.status(500).json({ success: false, message: 'Server error creating address', error: error.message });
  }
};

exports.updateAddress = async (req, res) => {
  try {
    const { id } = req.params;
    const customerId = req.user.id;
    const existing = await prisma.customerAddress.findFirst({
      where: { id, customerId }
    });

    if (!existing) {
      return res.status(404).json({ success: false, message: 'Address not found.' });
    }

    const normalized = normalizeAddressInput({
      ...existing,
      ...req.body
    });

    if (normalized.street === '' || normalized.city === '' || normalized.postalCode === '') {
      return res.status(400).json({
        success: false,
        message: 'Street, city, and postal code are required for a customer address.'
      });
    }

    if (normalized.latitude !== null && !validLatitude(normalized.latitude)) {
      return res.status(400).json({
        success: false,
        message: 'Latitude must be a valid value between -90 and 90 degrees.'
      });
    }

    if (normalized.longitude !== null && !validLongitude(normalized.longitude)) {
      return res.status(400).json({
        success: false,
        message: 'Longitude must be a valid value between -180 and 180 degrees.'
      });
    }

    let updated;
    if (normalized.isDefault) {
      updated = await prisma.$transaction(async (tx) => {
        await tx.customerAddress.updateMany({
          where: { customerId, isDefault: true, id: { not: id } },
          data: { isDefault: false }
        });

        return tx.customerAddress.update({
          where: { id },
          data: {
            label: normalized.label,
            flatNumber: normalized.flatNumber,
            street: normalized.street,
            landmark: normalized.landmark,
            city: normalized.city,
            state: normalized.state,
            postalCode: normalized.postalCode,
            latitude: normalized.latitude,
            longitude: normalized.longitude,
            isDefault: true
          }
        });
      });
    } else {
      updated = await prisma.customerAddress.update({
        where: { id },
        data: {
          label: normalized.label,
          flatNumber: normalized.flatNumber,
          street: normalized.street,
          landmark: normalized.landmark,
          city: normalized.city,
          state: normalized.state,
          postalCode: normalized.postalCode,
          latitude: normalized.latitude,
          longitude: normalized.longitude,
          isDefault: existing.isDefault
        }
      });
    }

    return res.json({ success: true, message: 'Address updated successfully.', address: updated });
  } catch (error) {
    console.error('[Address Controller] updateAddress error:', error);
    return res.status(500).json({ success: false, message: 'Server error updating address', error: error.message });
  }
};

exports.setDefaultAddress = async (req, res) => {
  try {
    const { id } = req.params;
    const customerId = req.user.id;
    const existing = await prisma.customerAddress.findFirst({ where: { id, customerId } });

    if (!existing) {
      return res.status(404).json({ success: false, message: 'Address not found.' });
    }

    const updated = await prisma.$transaction(async (tx) => {
      await tx.customerAddress.updateMany({
        where: { customerId, isDefault: true, id: { not: id } },
        data: { isDefault: false }
      });

      return tx.customerAddress.update({
        where: { id },
        data: { isDefault: true }
      });
    });

    return res.json({ success: true, message: 'Default address updated.', address: updated });
  } catch (error) {
    console.error('[Address Controller] setDefaultAddress error:', error);
    return res.status(500).json({ success: false, message: 'Server error updating default address', error: error.message });
  }
};

exports.deleteAddress = async (req, res) => {
  try {
    const { id } = req.params;
    const customerId = req.user.id;
    const existing = await prisma.customerAddress.findFirst({ where: { id, customerId } });

    if (!existing) {
      return res.status(404).json({ success: false, message: 'Address not found.' });
    }

    const fallbackAddress = await prisma.customerAddress.findFirst({
      where: { customerId, id: { not: id } },
      orderBy: { createdAt: 'desc' }
    });

    await prisma.$transaction(async (tx) => {
      await tx.customerAddress.delete({ where: { id } });

      if (fallbackAddress && existing.isDefault) {
        await tx.customerAddress.update({
          where: { id: fallbackAddress.id },
          data: { isDefault: true }
        });
      }
    });

    return res.json({ success: true, message: 'Address deleted successfully.' });
  } catch (error) {
    console.error('[Address Controller] deleteAddress error:', error);
    return res.status(500).json({ success: false, message: 'Server error deleting address', error: error.message });
  }
};
