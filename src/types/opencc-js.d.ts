declare module 'opencc-js' {
  interface ConverterOptions {
    from: string;
    to: string;
  }

  export function Converter(
    options: ConverterOptions,
  ): (text: string) => string;
}
