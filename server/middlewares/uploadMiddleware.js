const multer = require('multer');

// Configure multer for memory storage so images are streamed directly to Supabase Storage
const storage = multer.memoryStorage();

const allowedMimeTypes = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp'
]);

const fileFilter = (req, file, cb) => {
  if (!file || !file.mimetype) {
    return cb(new Error('No file provided or invalid file data.'));
  }

  const mime = file.mimetype.toLowerCase();
  if (allowedMimeTypes.has(mime)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Supported formats are JPG, JPEG, PNG, and WebP.'));
  }
};

const upload = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5 MB limit
  },
  fileFilter
});

const handleMulterError = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        message: 'File size limit exceeded. Profile photo must be 5 MB or less.'
      });
    }
    return res.status(400).json({
      success: false,
      message: `File upload error: ${err.message}`
    });
  }

  if (err) {
    return res.status(400).json({
      success: false,
      message: err.message || 'Error processing uploaded file.'
    });
  }

  next();
};

module.exports = {
  upload,
  handleMulterError
};

