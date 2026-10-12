// What a test imports where the app imports @op-engineering/op-sqlite (jest.config.js). The
// library installs its native half as it is imported and throws where there is none, so under
// Jest nothing that imports the replica's library, a screen among it, could be loaded at all.
// With this in its place the library loads, and a database is still never opened in a test: a
// replica's behaviour is the conformance suite's to hold, on a real SQLite (ADR 0013), and a
// screen's test hands its screen a replica of its own making.
function absent(): never {
  throw new Error('no SQLite under Jest: a test hands its screen a replica, and opens none')
}

export const open = absent
export const getDylibPath = absent
