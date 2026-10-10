// What Jest runs before each test file (jest.config.js): the engine made Hermes's, then the
// polyfills, in the order a device has them. A test then formats and counts through FormatJS,
// as a device does, and never through Node's own ICU.
import './hermes.ts'
import '../polyfills/index.ts'
