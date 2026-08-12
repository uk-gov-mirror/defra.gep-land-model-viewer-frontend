// geostyler-lyrx-parser pulls jimp in solely to resize base64 picture symbols.
// None of our datasets author those, and the parser catches a failed read and
// falls back to the unresized image, so throwing here is safe.
export const Jimp = {
  read () {
    throw new Error('jimp is not bundled')
  }
}
