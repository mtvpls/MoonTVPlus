declare module 'sharp' {
  interface ResizeOptions {
    width?: number;
    height?: number;
    withoutEnlargement?: boolean;
  }

  interface PngOptions {
    compressionLevel?: number;
    palette?: boolean;
    quality?: number;
    effort?: number;
  }

  interface JpegOptions {
    quality?: number;
    mozjpeg?: boolean;
  }

  interface Metadata {
    hasAlpha?: boolean;
  }

  interface Sharp {
    rotate(): Sharp;
    resize(options?: ResizeOptions): Sharp;
    png(options?: PngOptions): Sharp;
    jpeg(options?: JpegOptions): Sharp;
    metadata(): Promise<Metadata>;
    toBuffer(): Promise<Buffer>;
  }

  interface SharpOptions {
    failOn?: string;
  }

  interface SharpConstructor {
    (input?: Buffer, options?: SharpOptions): Sharp;
  }

  const sharp: SharpConstructor;
  export default sharp;
}
