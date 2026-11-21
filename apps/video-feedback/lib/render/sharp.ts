import sharp from 'sharp';

// Rendering only ever uses background capacity: one libvips thread, configured once here.
// Everything in lib/render imports sharp from this module.
sharp.concurrency(1);

export { sharp };
