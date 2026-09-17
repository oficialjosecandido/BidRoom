jest.mock('../src/models/Listing', () => ({
  findById: jest.fn(),
  findByIdAndUpdate: jest.fn(),
  updateOne: jest.fn(),
  find: jest.fn()
}));
jest.mock('../src/models/Transaction', () => ({ exists: jest.fn() }));
jest.mock('../src/services/azureStorage.service', () => ({
  uploadMultipleImages: jest.fn(),
  deleteImage: jest.fn(() => Promise.resolve()),
  getContainerBaseUrl: jest.fn(() => 'https://acct.blob.core.windows.net/listing-images/')
}));
jest.mock('../src/utils/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn()
}));

const BLOB = 'https://acct.blob.core.windows.net/listing-images/';
const PLACEHOLDER = 'https://via.placeholder.com/400x300?text=No+Image';
const JPEG = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0, 0, 0, 0, 0, 0, 0, 0]);

function load() {
  return {
    service: require('../src/services/adminListingEditService'),
    Listing: require('../src/models/Listing'),
    Transaction: require('../src/models/Transaction'),
    storage: require('../src/services/azureStorage.service')
  };
}

const query = doc => ({ select: () => ({ lean: async () => doc }) });

describe('adminListingEditService', () => {
  describe('updateListingText', () => {
    it('keeps a cleared language empty instead of refilling it from the old title', async () => {
      const { service, Listing } = load();
      Listing.findByIdAndUpdate.mockReturnValue(query({ _id: 'L1' }));

      await service.updateListingText('L1', {
        titlePt: '', descriptionPt: '',
        titleEn: '  Omega watch ', descriptionEn: 'Great condition.'
      });

      const { $set } = Listing.findByIdAndUpdate.mock.calls[0][1];
      expect($set).toMatchObject({
        title: 'Omega watch', description: 'Great condition.',
        titlePt: null, descriptionPt: null, titleEn: 'Omega watch', titleFr: null
      });
    });

    it('requires a title and a description in some language', async () => {
      const { service, Listing } = load();
      await expect(service.updateListingText('L1', { titlePt: 'Relógio' }))
        .rejects.toMatchObject({ statusCode: 400, code: 'description_required' });
      expect(Listing.findByIdAndUpdate).not.toHaveBeenCalled();
    });

    it('rejects a title over 80 characters', async () => {
      const { service } = load();
      await expect(service.updateListingText('L1', { titleFr: 'x'.repeat(81), descriptionPt: 'ok', titlePt: 'ok' }))
        .rejects.toMatchObject({ code: 'text_too_long' });
    });
  });

  describe('addListingImages', () => {
    it('uploads verified photos, appends them, and drops the placeholder', async () => {
      const { service, Listing, storage } = load();
      Listing.findById.mockReturnValue(query({ images: [PLACEHOLDER], imageManifest: [] }));
      storage.uploadMultipleImages.mockResolvedValue([{ url: `${BLOB}new.jpg` }]);
      Listing.updateOne.mockResolvedValue({});
      Listing.findByIdAndUpdate.mockReturnValue(query({ images: [`${BLOB}new.jpg`] }));

      const images = await service.addListingImages('L1', [{ buffer: JPEG, originalname: 'a.jpg', mimetype: 'image/jpeg' }]);

      expect(images).toEqual([`${BLOB}new.jpg`]);
      expect(Listing.updateOne.mock.calls[0][1]).toHaveProperty('$pull.images');
      expect(Listing.findByIdAndUpdate.mock.calls[0][1]).toEqual({ $push: { images: { $each: [`${BLOB}new.jpg`] } } });
    });

    it('refuses a file that is not an image without uploading anything', async () => {
      const { service, Listing, storage } = load();
      Listing.findById.mockReturnValue(query({ images: [`${BLOB}a.jpg`], imageManifest: [] }));

      await expect(service.addListingImages('L1', [{ buffer: Buffer.from('%PDF-1.7 not an image'), originalname: 'x.jpg' }]))
        .rejects.toMatchObject({ code: 'invalid_image' });
      expect(storage.uploadMultipleImages).not.toHaveBeenCalled();
    });

    it('deletes the uploaded files when the listing cannot be updated', async () => {
      const { service, Listing, storage } = load();
      Listing.findById.mockReturnValue(query({ images: [`${BLOB}a.jpg`], imageManifest: [] }));
      storage.uploadMultipleImages.mockResolvedValue([{ url: `${BLOB}new.jpg` }]);
      Listing.findByIdAndUpdate.mockReturnValue(query(null));

      await expect(service.addListingImages('L1', [{ buffer: JPEG, originalname: 'a.jpg' }]))
        .rejects.toMatchObject({ code: 'not_found' });
      expect(storage.deleteImage).toHaveBeenCalledWith(`${BLOB}new.jpg`);
    });
  });

  describe('setListingImages', () => {
    const current = [`${BLOB}a.jpg`, `${BLOB}b.jpg`, `${BLOB}c.jpg`];

    function setup({ sold = false, sharedWith = [] } = {}) {
      const loaded = load();
      loaded.Listing.findById.mockReturnValue(query({ images: current, imageManifest: [] }));
      loaded.Transaction.exists.mockResolvedValue(sold ? { _id: 'T1' } : null);
      loaded.Listing.find.mockReturnValue(query(sharedWith.map(url => ({ images: [url] }))));
      loaded.Listing.updateOne.mockResolvedValue({ matchedCount: 1 });
      return loaded;
    }

    it('reorders, removes, and deletes files no other listing uses', async () => {
      const { service, Listing, storage } = setup({ sharedWith: [`${BLOB}b.jpg`] });

      const result = await service.setListingImages('L1', [`${BLOB}c.jpg`], current);

      expect(Listing.updateOne).toHaveBeenCalledWith(
        { _id: 'L1', images: current },
        { $set: { images: [`${BLOB}c.jpg`] } }
      );
      expect(result.removed).toEqual([`${BLOB}a.jpg`, `${BLOB}b.jpg`]);
      expect(storage.deleteImage).toHaveBeenCalledTimes(1);
      expect(storage.deleteImage).toHaveBeenCalledWith(`${BLOB}a.jpg`);
    });

    it('keeps the files of a completed sale', async () => {
      const { service, storage } = setup({ sold: true });
      await service.setListingImages('L1', [`${BLOB}a.jpg`], current);
      expect(storage.deleteImage).not.toHaveBeenCalled();
    });

    it('refuses photos the listing does not have, and removing every photo', async () => {
      const { service } = setup();
      await expect(service.setListingImages('L1', [`${BLOB}a.jpg`, 'https://evil.example/x.jpg'], current))
        .rejects.toMatchObject({ code: 'unknown_images' });
      await expect(service.setListingImages('L1', [], current))
        .rejects.toMatchObject({ code: 'image_required' });
    });

    it('answers images_changed when the admin was looking at an older list', async () => {
      const { service, Listing } = setup();
      await expect(service.setListingImages('L1', [`${BLOB}a.jpg`], [`${BLOB}a.jpg`]))
        .rejects.toMatchObject({ statusCode: 409, code: 'images_changed' });
      expect(Listing.updateOne).not.toHaveBeenCalled();

      Listing.updateOne.mockResolvedValue({ matchedCount: 0 });
      await expect(service.setListingImages('L1', [`${BLOB}a.jpg`], current))
        .rejects.toMatchObject({ code: 'images_changed' });
    });
  });
});
