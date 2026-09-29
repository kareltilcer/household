// The network between a client and the API (PRD 10 §4): partitions scripted as requests refused
// before they leave and responses lost after the server answered. The other partition, a client
// cut off from PowerSync, is the client's disconnect (Client.offline).

import type { Rng } from './rng.ts'

/** What happens to one request: it goes through, is refused, or reaches the server and its answer is lost. */
export type Fault = 'deliver' | 'refuse' | 'lose'

/** The error a faulted request fails with, as fetch fails on a network error. */
export class NetworkFault extends TypeError {
  readonly fault: Exclude<Fault, 'deliver'>
  constructor(fault: Exclude<Fault, 'deliver'>, url: string) {
    super(fault === 'refuse' ? `network: ${url} refused` : `network: the response from ${url} was lost`)
    this.fault = fault
  }
}

/** One request the network carried, and what it did to it. */
export interface Carried {
  readonly method: string
  readonly url: string
  readonly fault: Fault
  /** The status the server answered with, when the request reached it. */
  readonly status: number | null
}

/**
 * A client's network. By default it delivers everything. A partition refuses every request until
 * it heals; faults scripted with next() apply to the requests that follow and match, one each, in
 * order; and a seeded rate applies faults at random. Every request is recorded.
 */
/** Whether url is the push's, which most scripted faults are aimed at. */
export const push = (url: string): boolean => url.includes('/sync/mutations')

export class Network {
  private partitioned = false
  private readonly scripted: { readonly fault: Fault; readonly on: (url: string) => boolean }[] = []
  private rates: { refuse: number; lose: number; rng: Rng } | null = null
  readonly carried: Carried[] = []
  private readonly transport: typeof fetch

  constructor(transport: typeof fetch = fetch) {
    this.transport = transport
  }

  /** Refuses every request until heal(). */
  partition(): void {
    this.partitioned = true
  }

  /** Ends a partition, the scripted faults not yet used, and any rate. */
  heal(): void {
    this.partitioned = false
    this.scripted.length = 0
    this.rates = null
  }

  /** Scripts the faults of the next requests on (every request by default), one each, in order. */
  next(faults: Fault | readonly Fault[], on: (url: string) => boolean = () => true): void {
    for (const fault of typeof faults === 'string' ? [faults] : faults) this.scripted.push({ fault, on })
  }

  /** Refuses and loses requests at random, at the given rates, drawn from rng. */
  flaky(rng: Rng, refuse: number, lose: number): void {
    this.rates = { refuse, lose, rng }
  }

  get isPartitioned(): boolean {
    return this.partitioned
  }

  private faultFor(url: string): Fault {
    if (this.partitioned) return 'refuse'
    const i = this.scripted.findIndex((s) => s.on(url))
    const scripted = this.scripted[i]
    if (scripted !== undefined) {
      this.scripted.splice(i, 1)
      return scripted.fault
    }
    if (this.rates !== null) {
      const { refuse, lose, rng } = this.rates
      const roll = rng.float()
      if (roll < refuse) return 'refuse'
      if (roll < refuse + lose) return 'lose'
    }
    return 'deliver'
  }

  /** fetch, through this network. */
  readonly fetch: typeof fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input)
    const method = init?.method ?? 'GET'
    const fault = this.faultFor(url)
    if (fault === 'refuse') {
      this.carried.push({ method, url, fault, status: null })
      throw new NetworkFault('refuse', url)
    }
    const response = await this.transport(input, init)
    if (fault === 'lose') {
      // The server has answered; read the answer to its end, so that the request is finished
      // on the server, and drop it.
      await response.arrayBuffer()
      this.carried.push({ method, url, fault, status: response.status })
      throw new NetworkFault('lose', url)
    }
    this.carried.push({ method, url, fault, status: response.status })
    return response
  }
}
